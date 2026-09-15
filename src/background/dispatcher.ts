import { actionsSchema, isSafeUrl, type ChromeAction } from '../common/schema';
import { bestMatch } from './fuzzy';
import { literalTabMatch, resolveTab } from './tab-matching';
import { ChoiceRequired, ReviewRequired, checkCancelled, tabRef } from '../common/conversation';
import { executeFeature } from './features';
import { contextFor, contextTabs, markIrreversible, recordUndo, rememberTargets, resolveTabs, undoSnapshot, type ExecutionEnvironment } from './execution';
import { macroSchema, type Macro } from '../common/macros';
import { CommandFailure } from '../common/recovery';

export interface DispatchContext { tabId: number; windowId: number; tabIds?: number[]; }
export interface DispatchResult { text: string; context: DispatchContext; }
export async function dispatchMacro(input: Macro, context: DispatchContext, env?: ExecutionEnvironment): Promise<DispatchResult> {
  const macro = macroSchema.parse(input); // Validate every URL before opening the first site.
  let opened = 0;
  let first = context;
  try {
    for (const url of macro.urls) {
      checkCancelled(env?.signal);
      await env?.onProgress?.({ index: opened, status: 'running', context });
      const tab = await chrome.tabs.create({ url, windowId: context.windowId, active: opened === 0 });
      await env?.onProgress?.({ index: opened, status: 'completed', context, result: `Opened ${url}` });
      if (opened === 0 && tab.id !== undefined) first = { tabId: tab.id, windowId: tab.windowId };
      if (env) { rememberTargets(env, [tab]); markIrreversible(env); }
      opened++;
    }
  } catch (error) {
    throw new Error(`${macro.name}: opened ${opened} of ${macro.urls.length} sites. Stopped: ${error instanceof Error ? error.message : 'Chrome could not open the next site.'}`);
  }
  return { text: `${macro.name} · Opened ${opened} site${opened === 1 ? '' : 's'}`, context: first };
}
export function requiresReview(actions: ChromeAction[], source: 'grammar' | 'model', reviewAllAi = false): boolean {
  return (source === 'model' && (reviewAllAi || actions.some(a => a.action === 'close_tab'))) || actions.some(a => a.action === 'close_tab' && a.params.target !== undefined && a.params.target !== 'current');
}
function flattenBookmarks(nodes: chrome.bookmarks.BookmarkTreeNode[]): chrome.bookmarks.BookmarkTreeNode[] {
  return nodes.flatMap(n => [n, ...flattenBookmarks(n.children ?? [])]);
}
async function verifyTab(tabId: number, expected: { active?: boolean; pinned?: boolean; muted?: boolean; index?: number }, signal?: AbortSignal): Promise<void> {
  checkCancelled(signal);
  const actual = await chrome.tabs.get(tabId).catch(() => undefined);
  checkCancelled(signal);
  if (!actual || (expected.active !== undefined && actual.active !== expected.active) || (expected.pinned !== undefined && actual.pinned !== expected.pinned) || (expected.muted !== undefined && !!actual.mutedInfo?.muted !== expected.muted) || (expected.index !== undefined && actual.index !== expected.index)) throw new CommandFailure('unknown-outcome', 'Chrome did not confirm the requested tab change. Check the tab before trying again; the action may have partly completed.');
}
export async function dispatchActions(input: unknown, initial: DispatchContext, env?: ExecutionEnvironment): Promise<DispatchResult> {
  const actions = actionsSchema.parse(input);
  let context = { ...initial }; const messages: string[] = [];
  const opened = new Map<number, chrome.tabs.Tab>();
  if (env && !env.state.targets.length) rememberTargets(env, [await chrome.tabs.get(initial.tabId)]);
  for (let index = 0; index < actions.length; index++) {
    const action = actions[index]!;
    try {
      checkCancelled(env?.signal);
      await env?.onProgress?.({ index, status: 'running', context });
      checkCancelled(env?.signal);
      if (env && action.action === 'reference_tabs' && action.params.reference === 'them' && opened.size > 1) rememberTargets(env, [...opened.values()]);
      const ids = context.tabIds ?? [context.tabId];
      if (env && action.action === 'close_tab' && (action.params.target ?? 'current') === 'current' && (ids.length > 1 || context.tabIds !== undefined)) {
        const tabs = await contextTabs(context);
        if (!env.reviewed) throw new ReviewRequired(`Close these ${tabs.length} tabs?`, tabs.map(tabRef), 'close');
        rememberTargets(env, tabs); checkCancelled(env.signal); await chrome.tabs.remove(ids); markIrreversible(env);
        messages.push(`Closed ${ids.length} tabs`); await env.onProgress?.({ index, status: 'completed', context, result: `Closed ${ids.length} tabs` }); continue;
      }
      const multiple = ids.length > 1 && ['mute_tab', 'pin_tab', 'zoom', 'move_tab', 'reload_tab', 'duplicate_tab', 'bookmark_page'].includes(action.action);
      const targets = multiple ? ids : [context.tabId]; const results: DispatchResult[] = [];
      for (const id of targets) {
        checkCancelled(env?.signal);
        const singleContext = multiple ? { tabId: id, windowId: (await chrome.tabs.get(id)).windowId } : context;
        const before = env ? await undoSnapshot(action, id) : null;
        if (env && action.action === 'close_tab') rememberTargets(env, await contextTabs(singleContext));
        const result = await dispatchOne(action, singleContext, env);
        results.push(result);
        if (multiple) { const title = (await chrome.tabs.get(id).catch(() => undefined))?.title ?? `Tab ${id}`; await env?.onProgress?.({ index, status: 'target', context: singleContext, result: `${title}: ${result.text}` }); }
        if (env && before) {
          const after = await undoSnapshot(action, id);
          if (after) recordUndo(env, action.action === 'mute_tab' ? 'mute' : action.action === 'pin_tab' ? 'pin' : action.action === 'zoom' ? 'zoom' : 'move', { tabId: id, before, after });
        } else if (env && ['create_tab', 'close_tab', 'duplicate_tab', 'reload_tab', 'bookmark_page', 'open_bookmark', 'navigate_history', 'window_state', 'reopen_tab', 'create_window'].includes(action.action)) markIrreversible(env);
      }
      const result = results[results.length - 1]!;
      context = multiple ? contextFor(await Promise.all(results.map(result => chrome.tabs.get(result.context.tabId))), context) : result.context;
      if (env && action.action !== 'close_tab' && !['undo_action', 'audio_action', 'duplicates_action'].includes(action.action)) {
        const tabs = await Promise.all((context.tabIds ?? [context.tabId]).map(id => chrome.tabs.get(id).catch(() => undefined)));
        rememberTargets(env, tabs.filter((tab): tab is chrome.tabs.Tab => !!tab));
      }
      if (env && ['create_tab', 'open_site', 'search_site'].includes(action.action)) { const tab = await chrome.tabs.get(context.tabId); if (tab.id !== undefined) opened.set(tab.id, tab); }
      else if (action.action !== 'reference_tabs') opened.clear();
      messages.push(multiple ? `${result.text} · ${targets.length} tabs` : result.text);
      await env?.onProgress?.({ index, status: 'completed', context, result: messages[messages.length - 1] });
    } catch (error) {
      if (error instanceof ChoiceRequired) { error.remaining = actions.slice(index); error.context = context; throw error; }
      if (error instanceof ReviewRequired) { error.remaining = actions.slice(index + 1); error.context = context; throw error; }
      if (error instanceof CommandFailure) {
        error.context = context;
        if (error.beforeEffects && ['find_tab', 'page_action', 'wait_for_field'].includes(action.action)) error.remaining = actions.slice(index);
        if (messages.length) error.message = `${messages.join(' · ')}. Stopped: ${error.message}`.slice(0, 500);
        throw error;
      }
      const why = error instanceof Error ? error.message : 'Chrome could not complete this action';
      throw new Error(messages.length ? `${messages.join(' · ')}. Stopped: ${why}` : why);
    }
  }
  if (env && opened.size > 1) rememberTargets(env, [...opened.values()]);
  return { text: messages.join(' · ').slice(0, 500), context };
}
async function dispatchOne(item: ChromeAction, context: DispatchContext, env?: ExecutionEnvironment): Promise<DispatchResult> {
  const done = (text: string, next = context): DispatchResult => ({ text, context: next });
  const adopt = (tab: chrome.tabs.Tab): DispatchContext => ({ tabId: tab.id ?? context.tabId, windowId: tab.windowId });
  if (item.action === 'create_tab') {
    const tab = await chrome.tabs.create({ url: item.params.url, active: item.params.active ?? true, windowId: context.windowId });
    if (tab.id === undefined) throw new CommandFailure('unknown-outcome', 'Chrome did not identify the new tab. Check open tabs before trying again.');
    return done('Opened a new tab', adopt(tab));
  }
  if (item.action === 'find_tab') {
    const match = env ? (await resolveTabs(item.params.query, context, env))[0]! : resolveTab(await chrome.tabs.query({}), item.params.query);
    if (match.id === undefined) throw new Error('That tab is no longer available.');
    if (item.params.auto_switch !== false) {
      await chrome.windows.update(match.windowId, { focused: true });
      await chrome.tabs.update(match.id, { active: true });
      await verifyTab(match.id, { active: true }, env?.signal);
    }
    return done(`Found ${match.title ?? 'matching tab'}`, adopt(match));
  }
  if (item.action === 'select_tab') {
    const tabs = (await chrome.tabs.query({ windowId: context.windowId })).sort((a, b) => a.index - b.index);
    if (!tabs.length) throw new Error('This window has no available tabs.');
    const position = item.params.position;
    const current = tabs.findIndex(tab => tab.id === context.tabId);
    if ((position === 'next' || position === 'previous') && current < 0) throw new Error('The original tab is no longer available. Try again.');
    const index = position === 'first' ? 0 : position === 'last' ? tabs.length - 1 : position === 'index' ? (item.params.from_end ? tabs.length - (item.params.index ?? 1) : (item.params.index ?? 1) - 1) : ((current + (position === 'next' ? 1 : -1) * (item.params.offset ?? 1)) % tabs.length + tabs.length) % tabs.length;
    const tab = tabs[index];
    if (tab?.id === undefined) throw new Error(`Tab ${index + 1} does not exist in this window. There are ${tabs.length} tabs.`);
    if (item.params.activate !== false) {
      await chrome.windows.update(tab.windowId, { focused: true });
      await chrome.tabs.update(tab.id, { active: true });
      await verifyTab(tab.id, { active: true }, env?.signal);
    }
    return done(`Selected tab ${index + 1}${tab.title ? ` · ${tab.title}` : ''}`, adopt(tab));
  }
  if (item.action === 'reopen_tab') {
    const recent = (await chrome.sessions.getRecentlyClosed({ maxResults: 25 })).find(session => session.tab?.sessionId);
    if (!recent?.tab?.sessionId) throw new Error('No recently closed tab is available to reopen.');
    const restored = await chrome.sessions.restore(recent.tab.sessionId);
    if (restored.tab?.id === undefined) throw new Error('Chrome could not restore that tab.');
    await chrome.windows.update(restored.tab.windowId, { focused: true });
    await chrome.tabs.update(restored.tab.id, { active: true });
    return done('Reopened the last closed tab', adopt(restored.tab));
  }
  if (item.action === 'create_window') {
    const created = await chrome.windows.create({ focused: true, type: 'normal', ...(item.params.with_current_tab ? { tabId: context.tabId } : {}) });
    if (created?.id === undefined) throw new Error('Chrome could not create a window.');
    const tabs = created.tabs ?? await chrome.tabs.query({ active: true, windowId: created.id });
    const tab = tabs.find(tab => tab.active) ?? tabs[0];
    if (tab?.id === undefined) throw new Error('The new window has no available tab.');
    if (item.params.with_current_tab && context.tabIds && context.tabIds.length > 1) {
      for (const id of context.tabIds.filter(id => id !== context.tabId)) { checkCancelled(env?.signal); await chrome.tabs.move(id, { windowId: created.id, index: -1 }); }
      return done('Moved tabs to a new window', { tabId: tab.id, windowId: created.id, tabIds: context.tabIds });
    }
    return done(item.params.with_current_tab ? 'Moved tab to a new window' : 'Opened a new window', adopt(tab));
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
  const nativeTabActions = new Set(['close_tab', 'duplicate_tab', 'reload_tab', 'mute_tab', 'pin_tab', 'move_tab', 'zoom', 'bookmark_page', 'navigate_history']);
  if (!nativeTabActions.has(item.action)) {
    if (!env) throw new Error('This command needs the conversation engine.');
    return executeFeature(item, context, env);
  }
  // Use the tab that received the command, even if the user switches during inference.
  const tab = await chrome.tabs.get(context.tabId);
  switch (item.action) {
    case 'close_tab': {
      const target = item.params.target ?? 'current';
      const tabs = target === 'current' ? [tab] : (await chrome.tabs.query({ windowId: tab.windowId })).filter(t => {
        if (target === 'all') return true;
        if (target === 'matching') return literalTabMatch(t, item.params.query ?? '');
        return t.id !== tab.id && (target === 'all_others' || (target === 'left' ? t.index < tab.index : t.index > tab.index));
      });
      const ids = tabs.flatMap(t => t.id === undefined ? [] : [t.id]);
      if (env && !env.reviewed && target !== 'current' && tabs.length) throw new ReviewRequired(`Close these ${tabs.length} tabs?`, tabs.map(tabRef), 'close');
      if (ids.length) await chrome.tabs.remove(ids);
      const [active] = await chrome.tabs.query({ active: true, windowId: tab.windowId }).catch(() => [] as chrome.tabs.Tab[]);
      return done(ids.length ? `Closed ${ids.length} tab${ids.length === 1 ? '' : 's'}${target === 'matching' ? ` matching “${item.params.query}”` : ''}` : target === 'matching' ? `No tabs matching “${item.params.query}” in this window` : 'No tabs to close', active ? adopt(active) : context);
    }
    case 'move_tab': {
      const tabs = (await chrome.tabs.query({ windowId: tab.windowId })).sort((a, b) => a.index - b.index);
      const pinnedCount = tabs.filter(t => t.pinned).length;
      const min = tab.pinned ? 0 : pinnedCount;
      const max = tab.pinned ? pinnedCount - 1 : tabs.length - 1;
      const position = item.params.position;
      const index = position === 'index' ? (item.params.index ?? 1) - 1 : position === 'first' ? min : position === 'last' ? max : Math.max(min, Math.min(max, tab.index + (position === 'left' ? -1 : 1) * (item.params.steps ?? 1)));
      if (index < 0 || index >= tabs.length) throw new Error(`This window has ${tabs.length} tabs. Choose a position between 1 and ${tabs.length}.`);
      if (index < min || index > max) throw new Error('Pinned tabs must stay before unpinned tabs. Change the tab’s pin state first.');
      if (index === tab.index) return done(`Tab is already in position ${index + 1}`);
      const result = await chrome.tabs.move(context.tabId, { index });
      const moved = Array.isArray(result) ? result[0] : result;
      await verifyTab(context.tabId, { index }, env?.signal);
      return done(`Moved tab to position ${index + 1}`, moved ? adopt(moved) : context);
    }
    case 'duplicate_tab': {
      const duplicate = await chrome.tabs.duplicate(context.tabId);
      if (!duplicate) throw new Error('Chrome could not duplicate this tab');
      return done('Duplicated tab', adopt(duplicate));
    }
    case 'reload_tab': await chrome.tabs.reload(context.tabId, { bypassCache: item.params.bypass_cache ?? false }); return done('Reloaded tab');
    case 'mute_tab': {
      const muted = item.params.toggle ? !tab.mutedInfo?.muted : item.params.mute ?? true;
      await chrome.tabs.update(context.tabId, { muted }); await verifyTab(context.tabId, { muted }, env?.signal); return done(muted ? 'Muted tab' : 'Unmuted tab');
    }
    case 'pin_tab': {
      const pinned = item.params.toggle ? !tab.pinned : item.params.pin ?? true;
      await chrome.tabs.update(context.tabId, { pinned }); await verifyTab(context.tabId, { pinned }, env?.signal); return done(pinned ? 'Pinned tab' : 'Unpinned tab');
    }
    case 'zoom': {
      const steps = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
      const current = await chrome.tabs.getZoom(context.tabId);
      const factor = item.params.mode === 'reset' ? 1 : item.params.mode === 'set' ? item.params.factor ?? 1 : item.params.mode === 'in' ? steps.find(x => x > current + 0.01) ?? 5 : [...steps].reverse().find(x => x < current - 0.01) ?? 0.25;
      await chrome.tabs.setZoom(context.tabId, factor); checkCancelled(env?.signal);
      if (Math.abs(await chrome.tabs.getZoom(context.tabId) - factor) > 0.001) throw new CommandFailure('unknown-outcome', 'Chrome did not confirm the zoom level. Check the page before trying again.');
      return done(`Zoom ${Math.round(factor * 100)}%`);
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
  throw new Error('Unsupported tab action.');
}
