import { actionsSchema, isSafeUrl, type ChromeAction } from '../common/schema';
import { bestMatch } from './fuzzy';

export interface DispatchContext { tabId: number; windowId: number; }
export interface DispatchResult { text: string; context: DispatchContext; }
export function requiresReview(actions: ChromeAction[], source: 'grammar' | 'model'): boolean {
  return source === 'model' || actions.some(a => a.action === 'close_tab' && a.params.target !== undefined && a.params.target !== 'current');
}
function flattenBookmarks(nodes: chrome.bookmarks.BookmarkTreeNode[]): chrome.bookmarks.BookmarkTreeNode[] {
  return nodes.flatMap(n => [n, ...flattenBookmarks(n.children ?? [])]);
}
export async function dispatchActions(input: unknown, initial: DispatchContext): Promise<DispatchResult> {
  const actions = actionsSchema.parse(input); // Validate the ENTIRE plan before the first side effect.
  let context = { ...initial };
  const messages: string[] = [];
  for (const action of actions) {
    try {
      const result = await dispatchOne(action, context);
      context = result.context;
      messages.push(result.text);
    } catch (error) {
      const why = error instanceof Error ? error.message : 'Chrome could not complete this action';
      throw new Error(messages.length ? `${messages.join(' · ')}. Stopped: ${why}` : why);
    }
  }
  return { text: messages.join(' · ').slice(0, 500), context };
}
async function dispatchOne(item: ChromeAction, context: DispatchContext): Promise<DispatchResult> {
  const done = (text: string, next = context): DispatchResult => ({ text, context: next });
  const adopt = (tab: chrome.tabs.Tab): DispatchContext => ({ tabId: tab.id ?? context.tabId, windowId: tab.windowId });
  if (item.action === 'create_tab') {
    const tab = await chrome.tabs.create({ url: item.params.url, active: item.params.active ?? true, windowId: context.windowId });
    return done('Opened a new tab', adopt(tab));
  }
  if (item.action === 'find_tab') {
    const match = bestMatch(await chrome.tabs.query({}), item.params.query);
    if (match?.id === undefined) throw new Error(`No tab matching '${item.params.query}' found`);
    if (item.params.auto_switch !== false) {
      await chrome.windows.update(match.windowId, { focused: true });
      await chrome.tabs.update(match.id, { active: true });
    }
    return done(`Found ${match.title ?? 'matching tab'}`, adopt(match));
  }
  if (item.action === 'window_state') {
    await chrome.windows.update(context.windowId, { state: item.params.state });
    return done(`Window ${item.params.state}`);
  }
  if (item.action === 'open_bookmark') {
    const bookmarks = flattenBookmarks(await chrome.bookmarks.getTree()).filter(n => n.url);
    const match = item.params.query ? bestMatch(bookmarks, item.params.query) : bookmarks[(item.params.index ?? 1) - 1];
    if (!match?.url) throw new Error('No matching bookmark found');
    if (!isSafeUrl(match.url)) throw new Error('This bookmark uses an unsupported URL');
    const tab = await chrome.tabs.create({ url: match.url, windowId: context.windowId });
    return done(`Opened ${match.title}`, adopt(tab));
  }
  // Use the tab that received the command, even if the user switches during inference.
  const tab = await chrome.tabs.get(context.tabId);
  switch (item.action) {
    case 'close_tab': {
      const target = item.params.target ?? 'current';
      const tabs = target === 'current' ? [tab] : (await chrome.tabs.query({ windowId: tab.windowId })).filter(t => t.id !== tab.id && (target === 'all_others' || (target === 'left' ? t.index < tab.index : t.index > tab.index)));
      const ids = tabs.flatMap(t => t.id === undefined ? [] : [t.id]);
      if (ids.length) await chrome.tabs.remove(ids);
      const [active] = await chrome.tabs.query({ active: true, windowId: tab.windowId }).catch(() => [] as chrome.tabs.Tab[]);
      return done(ids.length ? `Closed ${ids.length} tab${ids.length === 1 ? '' : 's'}` : 'No tabs to close', active ? adopt(active) : context);
    }
    case 'duplicate_tab': {
      const duplicate = await chrome.tabs.duplicate(context.tabId);
      if (!duplicate) throw new Error('Chrome could not duplicate this tab');
      return done('Duplicated tab', adopt(duplicate));
    }
    case 'reload_tab': await chrome.tabs.reload(context.tabId, { bypassCache: item.params.bypass_cache ?? false }); return done('Reloaded tab');
    case 'mute_tab': {
      const muted = item.params.toggle ? !tab.mutedInfo?.muted : item.params.mute ?? true;
      await chrome.tabs.update(context.tabId, { muted }); return done(muted ? 'Muted tab' : 'Unmuted tab');
    }
    case 'pin_tab': {
      const pinned = item.params.toggle ? !tab.pinned : item.params.pin ?? true;
      await chrome.tabs.update(context.tabId, { pinned }); return done(pinned ? 'Pinned tab' : 'Unpinned tab');
    }
    case 'zoom': {
      const steps = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
      const current = await chrome.tabs.getZoom(context.tabId);
      const factor = item.params.mode === 'reset' ? 1 : item.params.mode === 'set' ? item.params.factor ?? 1 : item.params.mode === 'in' ? steps.find(x => x > current + 0.01) ?? 5 : [...steps].reverse().find(x => x < current - 0.01) ?? 0.25;
      await chrome.tabs.setZoom(context.tabId, factor); return done(`Zoom ${Math.round(factor * 100)}%`);
    }
    case 'bookmark_page': {
      if (!tab.url || !isSafeUrl(tab.url) || tab.url === 'chrome://newtab/') throw new Error('Open a web page to bookmark it');
      let parentId: string | undefined;
      if (item.params.folder) {
        const folder = flattenBookmarks(await chrome.bookmarks.getTree()).find(n => !n.url && n.id !== '0' && n.title.toLowerCase() === item.params.folder?.toLowerCase());
        parentId = folder?.id ?? (await chrome.bookmarks.create({ title: item.params.folder })).id;
      }
      await chrome.bookmarks.create({ url: tab.url, title: item.params.title ?? tab.title ?? tab.url, ...(parentId ? { parentId } : {}) });
      return done('Bookmarked page');
    }
    case 'navigate_history': {
      if (item.params.direction === 'back') await chrome.tabs.goBack(context.tabId);
      else await chrome.tabs.goForward(context.tabId);
      return done(item.params.direction === 'back' ? 'Went back' : 'Went forward');
    }
  }
}
