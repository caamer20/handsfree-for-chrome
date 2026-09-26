import type { ChromeAction } from '../common/schema';
import { aliasSchema, normalizeName, siteMatchesUrl, type Workspace } from '../common/library';
import { ChoiceRequired, ReviewRequired, checkCancelled, tabRef, type TargetContext, type PageRef } from '../common/conversation';
import { isSafeUrl } from '../common/urls';
import { getLibrary, saveAlias, saveWorkspace } from './library-store';
import { saveMacro } from './store';
import { applyUndo, contextFor, contextTabs, markIrreversible, matchTabs, recordUndo, rememberTargets, resolveSite, resolveTabs, sites, type ExecutionEnvironment } from './execution';
import { cancelPage, pageCommand } from './page-bridge';
import { CommandFailure } from '../common/recovery';

export interface FeatureResult { text: string; context: TargetContext; }
const usable = (url?: string): url is string => !!url && isSafeUrl(url) && url !== 'chrome://newtab/';
function named<T extends { id: string; name: string }>(items: T[], name: string, kind: 'workspace' | 'macro', env: ExecutionEnvironment): T {
  const query = normalizeName(name).replace(/^(?:my|the) /, '').replace(/ (?:routine|macro|workspace)$/, '');
  const key = `${kind}:${query}`; const override = env.overrides[key]?.value;
  const exact = items.filter(item => item.id === override || item.id === name || normalizeName(item.name) === query);
  const matches = exact.length ? exact : items.filter(item => query.split(' ').every(word => normalizeName(item.name).split(' ').includes(word)));
  if (!matches.length) throw new Error(`No ${kind} named “${name}” found. Create one in Library first.`);
  if (matches.length > 1) throw new ChoiceRequired(`Which ${kind} did you mean?`, matches.map(item => ({ id: item.id, label: item.name, value: item.id })), kind, key);
  return matches[0]!;
}
async function groupNamed(name: string, env: ExecutionEnvironment): Promise<chrome.tabGroups.TabGroup> {
  const key = `group:${normalizeName(name)}`; const chosen = env.overrides[key]?.value;
  if (chosen) return chrome.tabGroups.get(Number(chosen));
  const groups = await chrome.tabGroups.query({});
  const exact = groups.filter(group => normalizeName(group.title ?? '') === normalizeName(name));
  const matches = exact.length ? exact : groups.filter(group => normalizeName(group.title ?? '').includes(normalizeName(name)));
  if (!matches.length) throw new Error(`No group named “${name}” found. Say “group these tabs as ${name}” to create it.`);
  if (matches.length > 1) throw new ChoiceRequired(`Which “${name}” group?`, matches.map(group => ({ id: String(group.id), label: group.title ?? 'Unnamed group', detail: `Window ${group.windowId}`, value: String(group.id) })), 'group', key);
  return matches[0]!;
}
function duplicateExtras(tabs: chrome.tabs.Tab[]): chrome.tabs.Tab[] {
  const groups = new Map<string, chrome.tabs.Tab[]>();
  for (const tab of tabs) { if (!usable(tab.url)) continue; const url = new URL(tab.url).href; groups.set(url, [...groups.get(url) ?? [], tab]); }
  const extras: chrome.tabs.Tab[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const protectedTabs = group.filter(tab => tab.active || tab.pinned);
    const keeper = protectedTabs[0] ?? group[0];
    extras.push(...group.filter(tab => tab !== keeper && !tab.active && !tab.pinned));
  }
  return extras;
}
export { duplicateExtras };
export async function executeFeature(action: ChromeAction, context: TargetContext, env: ExecutionEnvironment): Promise<FeatureResult> {
  checkCancelled(env.signal);
  const done = (text: string, next = context): FeatureResult => ({ text, context: next });
  switch (action.action) {
    case 'browser_page': {
      const url = `chrome://${action.params.page}/`;
      const existing = (await chrome.tabs.query({ windowId: context.windowId })).find(tab => tab.url === url);
      const tab = existing?.id !== undefined ? await chrome.tabs.update(existing.id, { active: true }) : await chrome.tabs.create({ url, windowId: context.windowId, active: true });
      if (!tab) throw new Error('Chrome could not open that page.');
      await chrome.windows.update(tab.windowId, { focused: true }); rememberTargets(env, [tab]); markIrreversible(env);
      return done(`Opened Chrome ${action.params.page}`, contextFor([tab], context));
    }
    case 'wait_for_field':
    case 'wait_for_page': {
      let fieldRef: PageRef | undefined;
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        checkCancelled(env.signal);
        if (action.action === 'wait_for_field') {
          const response = await pageCommand(context.tabId, { operation: 'field_ready', query: action.params.query }, fieldRef, env.signal); fieldRef = response.ref;
          if (response.result.editable) return done(`Field “${action.params.query}” is ready`);
          if (response.result.text.startsWith('Several')) throw new Error(response.result.text);
        } else {
          const tab = await chrome.tabs.get(context.tabId);
          if (tab.status === 'complete' && !tab.pendingUrl) return done('Page finished loading');
        }
        await new Promise<void>((resolve, reject) => {
          const cancel = (): void => { clearTimeout(timer); env.signal?.removeEventListener('abort', cancel); reject(new Error('Command cancelled.')); };
          const timer = setTimeout(() => { env.signal?.removeEventListener('abort', cancel); resolve(); }, 250);
          env.signal?.addEventListener('abort', cancel, { once: true });
          if (env.signal?.aborted) cancel();
        });
      }
      throw new Error(action.action === 'wait_for_field' ? `The field “${action.params.query}” was not ready after 15 seconds. The remaining steps were stopped.` : 'The page has not finished loading after 15 seconds. The remaining steps were stopped.');
    }
    case 'organize_tabs': {
      if (action.params.operation === 'ungroup') {
        const tabs = await contextTabs(context); checkCancelled(env.signal);
        await chrome.tabs.ungroup(tabs.map(tab => tab.id!)); markIrreversible(env);
        return done(`Removed ${tabs.length} tab${tabs.length === 1 ? '' : 's'} from groups`);
      }
      const tabs = (await chrome.tabs.query({ windowId: context.windowId })).filter(tab => !tab.pinned && (tab.groupId ?? -1) === -1);
      const sortKey = (tab: chrome.tabs.Tab): string => {
        if (action.params.operation === 'sort_title') return tab.title ?? '';
        try { return new URL(tab.url ?? '').hostname.replace(/^www\./, ''); } catch { return ''; }
      };
      tabs.sort((a, b) => sortKey(a).localeCompare(sortKey(b), undefined, { sensitivity: 'base', numeric: true }) || a.index - b.index);
      // Move only ungrouped, unpinned tabs to the end, so existing groups stay together.
      for (const tab of tabs) {
        checkCancelled(env.signal); await chrome.tabs.move(tab.id!, { index: -1 }); markIrreversible(env);
        const current = await chrome.tabs.get(tab.id!); const remaining = await chrome.tabs.query({ windowId: context.windowId });
        if (current.windowId !== context.windowId || current.index !== remaining.length - 1) throw new CommandFailure('unknown-outcome', 'Chrome did not confirm a tab’s sorted position. Check the tabs before trying again; earlier moves remain in place.');
        await env.onTarget?.(contextFor([current], context), `Moved ${tab.title ?? 'tab'} to position ${current.index + 1}`);
      }
      return done(`Sorted ${tabs.length} ungrouped tabs by ${action.params.operation === 'sort_title' ? 'title' : 'site'} after existing groups. Pinned tabs kept first.`);
    }
    case 'open_site': {
      let site;
      try { site = resolveSite(action.params.site, env); }
      catch (error) {
        if (error instanceof ChoiceRequired || action.params.new_tab) throw error;
        const [existing] = await resolveTabs(action.params.site, context, env);
        if (!existing?.id) throw error;
        checkCancelled(env.signal); await chrome.windows.update(existing.windowId, { focused: true }); await chrome.tabs.update(existing.id, { active: true });
        rememberTargets(env, [existing]); return done(`Switched to ${existing.title ?? 'matching tab'}`, contextFor([existing], context));
      }
      if (env.settings.reuseTabs && !action.params.new_tab) {
        const matches = (await chrome.tabs.query({})).filter(tab => siteMatchesUrl(site, tab.url ?? tab.pendingUrl ?? ''));
        const key = `tabs:open:${site.id}`; const chosen = env.overrides[key]?.tabs?.[0];
        const current = matches.find(tab => tab.id === context.tabId);
        if (matches.length > 1 && !current && !chosen) {
          env.state.candidates = matches.map(tabRef);
          throw new ChoiceRequired(`Which ${site.name} tab should I open?`, matches.slice(0, 50).map(tab => ({ id: String(tab.id), label: tab.title ?? site.name, detail: tab.windowId === context.windowId ? 'This window' : 'Another window', tabs: [tabRef(tab)] })), 'tabs', key);
        }
        const existing = chosen ? matches.find(tab => tab.id === chosen.id) : current ?? matches[0];
        if (chosen && !existing) throw new Error('The selected site tab changed or closed. Try the command again.');
        if (existing?.id !== undefined) { await chrome.windows.update(existing.windowId, { focused: true }); await chrome.tabs.update(existing.id, { active: true }); rememberTargets(env, [existing]); return done(`Switched to ${site.name}`, contextFor([existing], context)); }
      }
      checkCancelled(env.signal); const tab = await chrome.tabs.create({ url: site.url, active: true, windowId: context.windowId });
      rememberTargets(env, [tab]); markIrreversible(env); return done(`Opened ${site.name}`, contextFor([tab], context));
    }
    case 'search_site': {
      const key = `text:search:${normalizeName(action.params.site)}`;
      const query = action.params.query ?? env.overrides[key]?.value;
      if (!query) throw new ChoiceRequired(`What should I search for on ${action.params.site === 'search' ? 'the web' : action.params.site}?`, [], 'text', key);
      let site;
      if (/^(?:this|this site|this website|the site|the website)$/i.test(action.params.site)) {
        const tab = await chrome.tabs.get(context.tabId);
        if (!usable(tab.url)) throw new Error('Open a web page before searching this site.');
        site = sites(env).find(site => siteMatchesUrl(site, tab.url!));
        if (!site) site = { id: 'current', name: new URL(tab.url).hostname, url: tab.url, aliases: [] };
      } else site = resolveSite(action.params.site, env);
      const url = site.searchUrl ? site.searchUrl.replace('{query}', encodeURIComponent(query)) : `https://www.google.com/search?q=${encodeURIComponent(`site:${new URL(site.url).hostname} ${query}`)}`;
      if (!usable(url)) throw new Error('That site has an invalid search address. Edit it in Library.');
      checkCancelled(env.signal); const tab = await chrome.tabs.create({ url, active: true, windowId: context.windowId }); rememberTargets(env, [tab]); markIrreversible(env);
      delete env.overrides[key]; return done(`Searched ${site.name}`, contextFor([tab], context));
    }
    case 'site_alias': {
      const tab = await chrome.tabs.get(context.tabId); if (!usable(tab.url)) throw new Error('Open a web page before creating a site nickname.');
      const existing = env.library.aliases.find(alias => normalizeName(alias.name) === normalizeName(action.params.name));
      const alias = aliasSchema.parse({ id: existing?.id ?? crypto.randomUUID(), name: action.params.name, url: tab.url, searchUrl: existing?.searchUrl ?? '' });
      await saveAlias(alias); env.library = await getLibrary(); markIrreversible(env); return done(`Saved “${alias.name}”. Say “open ${alias.name}” to return.`);
    }
    case 'macro_add_site': {
      const macro = named(env.macros, action.params.name, 'macro', env); const tab = await chrome.tabs.get(context.tabId);
      if (!usable(tab.url)) throw new Error('Open a web page before adding it to a routine.');
      if (macro.urls.includes(tab.url)) return done(`${macro.name} already includes this site`);
      await saveMacro({ ...macro, urls: [...macro.urls, tab.url] }); macro.urls.push(tab.url); markIrreversible(env); return done(`Added this site to ${macro.name}`);
    }
    case 'reference_tabs': {
      const p = action.params; let refs = env.state.targets;
      if (Date.now() - env.state.at > 5 * 60_000) refs = [];
      if (p.reference === 'previous') refs = env.state.previousTargets;
      if (p.reference === 'these') {
        const highlighted = await chrome.tabs.query({ windowId: context.windowId, highlighted: true });
        if (highlighted.length > 1) refs = highlighted.map(tabRef);
        else if (refs.length < 2) {
          const all = await chrome.tabs.query({ windowId: context.windowId }); const key = 'tabs:these'; const override = env.overrides[key];
          if (override?.tabs) refs = override.tabs;
          else if (all.length > 1) throw new ChoiceRequired('Do you mean the current tab or all tabs in this window?', [{ id: 'current', label: 'The current tab', tabs: [tabRef(await chrome.tabs.get(context.tabId))] }, { id: 'window', label: `All ${all.length} tabs in this window`, tabs: all.map(tabRef) }], 'tabs', key);
        }
      }
      if (p.reference === 'other') {
        const choices = p.query ? matchTabs(await chrome.tabs.query({}), p.query, env) : await Promise.all(env.state.candidates.map(tab => chrome.tabs.get(tab.id).catch(() => undefined))).then(items => items.filter((tab): tab is chrome.tabs.Tab => !!tab));
        const remaining = choices.filter(tab => !refs.some(ref => ref.id === tab.id));
        const key = `tabs:other:${p.query ?? ''}`; const override = env.overrides[key];
        if (override?.tabs) refs = override.tabs;
        else if (remaining.length === 1) refs = remaining.map(tabRef);
        else if (remaining.length > 1) throw new ChoiceRequired('Which other tab?', remaining.map(tab => ({ id: String(tab.id), label: tab.title ?? 'Untitled tab', tabs: [tabRef(tab)] })), 'tabs', key);
        else throw new Error('There is no other matching tab. Say its title or website name.');
      }
      if (!refs.length && p.reference === 'it') refs = [tabRef(await chrome.tabs.get(context.tabId))];
      if (!refs.length) throw new Error('Name the tabs first, or select them in Chrome. Then say “those tabs”.');
      if (((p.reference === 'it' || p.activate) && refs.length !== 1) || (p.count !== undefined && refs.length !== p.count)) {
        const key = 'tabs:reference'; const chosen = env.overrides[key]?.tabs;
        if (chosen) refs = chosen;
        else throw new ChoiceRequired('Which tab did you mean? You can also name several tabs in one command.', refs.slice(0, 50).map(ref => ({ id: String(ref.id), label: ref.title, tabs: [ref] })), 'tabs', key);
      }
      const tabs = await Promise.all(refs.map(ref => chrome.tabs.get(ref.id)));
      if (p.activate && tabs[0]?.id !== undefined) { checkCancelled(env.signal); await chrome.windows.update(tabs[0].windowId, { focused: true }); await chrome.tabs.update(tabs[0].id, { active: true }); }
      rememberTargets(env, tabs); return done('Using the referenced tab' + (tabs.length === 1 ? '' : 's'), contextFor(tabs, context));
    }
    case 'tab_set': {
      const p = action.params;
      let tabs = (await chrome.tabs.query(p.scope === 'all' ? {} : { windowId: context.windowId })).filter(tab => tab.id !== undefined).sort((a, b) => a.windowId - b.windowId || a.index - b.index);
      if (p.indices) {
        const selected = p.indices.map(index => tabs[index - 1]);
        if (selected.some(tab => !tab)) throw new Error(`A requested tab number does not exist. This window has ${tabs.length} tabs.`);
        tabs = selected as chrome.tabs.Tab[];
      } else tabs = tabs.filter(tab => p.filter === 'all' || (p.filter === 'pinned' ? tab.pinned : p.filter === 'unpinned' ? !tab.pinned : p.filter === 'muted' ? !!tab.mutedInfo?.muted : p.filter === 'unmuted' ? !tab.mutedInfo?.muted : !!tab.audible && !tab.mutedInfo?.muted));
      if (p.exclude_query) {
        const keep = /^(?:this|current|active|this one)(?: tab)?$/i.test(p.exclude_query) ? await contextTabs(context) : await resolveTabs(p.exclude_query, context, env);
        if (!keep.some(target => tabs.some(tab => tab.id === target.id))) throw new Error('The tab to keep is outside this set. Choose a tab in this window or specify all windows.');
        const ids = new Set(keep.map(tab => tab.id)); tabs = tabs.filter(tab => !ids.has(tab.id));
      }
      tabs = [...new Map(tabs.map(tab => [tab.id, tab])).values()];
      if (!tabs.length) throw new Error(`No ${p.filter === 'all' ? 'matching' : p.filter} tabs found in ${p.scope === 'all' ? 'the open windows' : 'this window'}.`);
      const key = `tab-set:${JSON.stringify(p)}`;
      if (p.operation === 'list') {
        env.state.candidates = tabs.map(tabRef);
        const selected = env.overrides[key]?.tabs?.[0];
        if (!selected) throw new ChoiceRequired(`${tabs.length} ${p.filter === 'all' ? 'open' : p.filter} tabs. Choose one to switch to.`, tabs.slice(0, 50).map(tab => ({ id: String(tab.id), label: tab.title ?? 'Untitled tab', detail: `Tab ${tab.index + 1} · ${tab.windowId === context.windowId ? 'This window' : 'Another window'}`, tabs: [tabRef(tab)] })), 'tabs', key);
        const tab = tabs.find(tab => tab.id === selected.id); if (!tab) throw new Error('That tab is no longer in this set. Ask to list tabs again.');
        checkCancelled(env.signal); await chrome.windows.update(tab.windowId, { focused: true }); await chrome.tabs.update(tab.id!, { active: true }); rememberTargets(env, [tab]);
        return done(`Switched to ${tab.title ?? 'selected tab'}`, contextFor([tab], context));
      }
      rememberTargets(env, tabs);
      return done(`Targeted ${tabs.length} tabs`, { ...contextFor(tabs, context), tabIds: tabs.map(tab => tab.id!) });
    }
    case 'select_tabs': {
      const selected: chrome.tabs.Tab[] = [];
      for (const query of action.params.queries) { checkCancelled(env.signal); selected.push(...await resolveTabs(query, context, env, !!action.params.all_matches)); }
      const unique = [...new Map(selected.map(tab => [tab.id, tab])).values()];
      rememberTargets(env, unique); return done(`Selected ${unique.length} tab${unique.length === 1 ? '' : 's'}`, contextFor(unique, context));
    }
    case 'undo_action': return done(await applyUndo(env, action.params.kind));
    case 'move_beside': {
      const [anchor] = await resolveTabs(action.params.query, context, env); if (anchor?.id === undefined) throw new Error('The destination tab is unavailable.');
      const moving = (await contextTabs(context)).sort((a, b) => a.windowId - b.windowId || a.index - b.index);
      if (moving.some(tab => tab.id === anchor.id)) throw new Error('The destination tab is also selected to move. Choose a destination outside the selected tabs.');
      if (moving.some(tab => !!tab.pinned !== !!anchor.pinned)) throw new Error('All selected tabs and the destination need the same pin state before placing them next to each other.');
      let cursor = anchor.id;
      for (const source of moving) {
        checkCancelled(env.signal);
        const tab = await chrome.tabs.get(source.id!); const currentAnchor = await chrome.tabs.get(cursor);
        if (!!tab.pinned !== !!currentAnchor.pinned) throw new Error('A tab’s pin state changed while moving the selection. The remaining tabs were kept in place.');
        const before = { index: tab.index, windowId: tab.windowId };
        let index = currentAnchor.index + (action.params.side === 'before' ? 0 : 1);
        if (tab.windowId === currentAnchor.windowId && tab.index < index) index--;
        await chrome.tabs.move(tab.id!, { windowId: currentAnchor.windowId, index });
        const after = await chrome.tabs.get(tab.id!);
        if (after.windowId !== currentAnchor.windowId || after.index !== index) throw new CommandFailure('unknown-outcome', 'Chrome did not confirm the tab’s new position. Check the tabs before trying again; the move may have partly completed.');
        recordUndo(env, 'move', { tabId: tab.id!, before, after: { index: after.index, windowId: after.windowId } });
        if (action.params.side !== 'before') cursor = tab.id!;
      }
      const tabs = await Promise.all(moving.map(tab => chrome.tabs.get(tab.id!))); rememberTargets(env, tabs);
      return done(`Moved ${moving.length} tab${moving.length === 1 ? '' : 's'} next to ${anchor.title ?? action.params.query}`, contextFor(tabs, context));
    }
    case 'audio_action': {
      if (action.params.operation === 'mute_others') {
        const keep = action.params.query && !/^(?:this|this tab|this meeting|it|that one)$/i.test(action.params.query) ? await resolveTabs(action.params.query.replace(/\s+tab$/, ''), context, env) : await contextTabs(context);
        const keepIds = new Set(keep.map(tab => tab.id)); const others = (await chrome.tabs.query({})).filter(tab => tab.id !== undefined && !keepIds.has(tab.id) && !tab.mutedInfo?.muted);
        for (const tab of others) {
          checkCancelled(env.signal); await chrome.tabs.update(tab.id!, { muted: true });
          const current = await chrome.tabs.get(tab.id!);
          if (!current.mutedInfo?.muted) throw new CommandFailure('unknown-outcome', 'Chrome did not confirm that a tab was muted. Check the tabs before trying again; earlier mute changes remain in place.');
          recordUndo(env, 'mute', { tabId: tab.id!, before: { muted: false }, after: { muted: true } });
          await env.onTarget?.(contextFor([current], context), `Muted ${tab.title ?? 'tab'}`);
        }
        rememberTargets(env, keep); return done(`Muted ${others.length} other tab${others.length === 1 ? '' : 's'}`, contextFor(keep, context));
      }
      const audible = (await chrome.tabs.query({ audible: true })).filter(tab => !tab.mutedInfo?.muted);
      if (!audible.length) return done('No tabs are currently playing audible sound');
      env.state.candidates = audible.map(tabRef); rememberTargets(env, audible);
      const key = 'tabs:audible'; const chosen = env.overrides[key]?.tabs;
      if (audible.length > 1 && !chosen) throw new ChoiceRequired('These tabs are playing audio. Which one?', audible.map(tab => ({ id: String(tab.id), label: tab.title ?? 'Untitled tab', tabs: [tabRef(tab)] })), 'tabs', key);
      const tab = chosen?.[0] ? await chrome.tabs.get(chosen[0].id) : audible[0]!;
      if (action.params.operation === 'focus' || chosen) { await chrome.windows.update(tab.windowId, { focused: true }); await chrome.tabs.update(tab.id!, { active: true }); }
      rememberTargets(env, [tab]); return done(`${tab.title ?? 'This tab'} is playing audio`, contextFor([tab], context));
    }
    case 'duplicates_action': {
      const extras = duplicateExtras(await chrome.tabs.query({ windowId: context.windowId }));
      if (!extras.length) return done('No unpinned, inactive duplicate tabs to close in this window');
      rememberTargets(env, extras);
      throw new ReviewRequired(`Found ${extras.length} duplicate ${extras.length === 1 ? 'copy' : 'copies'}. Keep active and pinned tabs; close these extras?`, extras.map(tabRef), 'close');
    }
    case 'page_action': {
      const p = action.params; const key = `page:${context.tabId}:${p.operation}:${p.query ?? ''}`;
      if (p.operation === 'dictate_stop') {
        await cancelPage(env.state.dictation); env.state.dictation = null;
        return done('Dictation stopped');
      }
      let preferred = env.state.page?.tabId === context.tabId && (p.index !== undefined || ['find_next', 'find_previous', 'next_heading', 'previous_heading', 'next_landmark', 'previous_landmark'].includes(p.operation) || env.overrides[key]) ? env.state.page : undefined;
      const chosen = env.overrides[key]?.value;
      if (chosen && (p.operation === 'activate' || p.operation.startsWith('media_'))) {
        const selection = await pageCommand(context.tabId, { operation: 'activate', index: Number(chosen), ...(p.new_tab ? { new_tab: true } : {}) }, preferred, env.signal);
        env.state.page = selection.ref;
        if (p.operation === 'activate') {
          delete env.overrides[key];
          if (selection.result.url) { const tab = await chrome.tabs.create({ url: selection.result.url, active: !p.background, windowId: context.windowId }); rememberTargets(env, [tab]); markIrreversible(env); return done(selection.result.text, contextFor([tab], context)); }
          markIrreversible(env); return done(selection.result.text);
        }
        preferred = undefined;
      }
      const { result, ref } = await pageCommand(context.tabId, { ...p, ...(chosen ? p.operation.startsWith('media_') ? { query: undefined } : { index: Number(chosen) } : {}) }, preferred, env.signal);
      if (p.operation !== 'dictate_start') env.state.page = ref;
      if (result.dictating !== undefined) env.state.dictation = result.dictating ? ref : null;
      if (result.choices?.length && !['show_links', 'show_fields'].includes(p.operation)) throw new ChoiceRequired(result.text, result.choices.slice(0, 50).map(item => ({ id: String(item.id), label: item.label, value: String(item.id) })), 'page', key);
      if (result.url) { const tab = await chrome.tabs.create({ url: result.url, active: !p.background, windowId: context.windowId }); rememberTargets(env, [tab]); markIrreversible(env); return done(result.text, contextFor([tab], context)); }
      if (chosen) delete env.overrides[key];
      if (['activate', 'type', 'fill', 'clear', 'delete_selection', 'replace_text', 'select_option', 'check', 'uncheck', 'media_play', 'media_pause', 'media_toggle', 'media_seek', 'media_volume'].includes(p.operation)) markIrreversible(env);
      return done(result.text);
    }
    case 'group_action': {
      const p = action.params;
      if (p.operation === 'create' || p.operation === 'add') {
        const tabs = await contextTabs(context);
        const existing = p.operation === 'add' ? await groupNamed(p.name, env) : undefined;
        const windowId = existing?.windowId ?? context.windowId;
        for (const tab of tabs) { checkCancelled(env.signal); if (tab.windowId !== windowId) await chrome.tabs.move(tab.id!, { windowId, index: -1 }); }
        checkCancelled(env.signal);
        if (existing) await chrome.tabs.group({ tabIds: tabs.map(tab => tab.id!), groupId: existing.id });
        else {
          const id = await chrome.tabs.group({ tabIds: tabs.map(tab => tab.id!), createProperties: { windowId } });
          await chrome.tabGroups.update(id, { title: p.name, ...(p.color ? { color: p.color } : {}) });
        }
        const current = await Promise.all(tabs.map(tab => chrome.tabs.get(tab.id!))); rememberTargets(env, current); markIrreversible(env);
        return done(`Added ${tabs.length} tab${tabs.length === 1 ? '' : 's'} to ${p.name}`, contextFor(current, context));
      }
      const group = await groupNamed(p.name, env);
      if (p.operation === 'ungroup') {
        const tabs = (await chrome.tabs.query({ windowId: group.windowId })).filter(tab => tab.groupId === group.id);
        if (!tabs.length) throw new Error('That group is now empty.');
        checkCancelled(env.signal); await chrome.tabs.ungroup(tabs.map(tab => tab.id!)); markIrreversible(env); return done(`Ungrouped ${p.name}`);
      }
      if (p.operation === 'color') { checkCancelled(env.signal); await chrome.tabGroups.update(group.id, { color: p.color! }); markIrreversible(env); return done(`Changed ${p.name} to ${p.color}`); }
      if (p.operation === 'collapse' || p.operation === 'expand') await chrome.tabGroups.update(group.id, { collapsed: p.operation === 'collapse' });
      else if (p.operation === 'rename') await chrome.tabGroups.update(group.id, { title: p.new_name! });
      else {
        const created = await chrome.windows.create({ focused: true }); if (created?.id === undefined) throw new Error('Chrome could not open a destination window.');
        await chrome.tabGroups.move(group.id, { windowId: created.id, index: 0 });
        const blank = created.tabs?.filter(tab => tab.url === 'chrome://newtab/' || tab.pendingUrl === 'chrome://newtab/').flatMap(tab => tab.id === undefined ? [] : [tab.id]) ?? [];
        if (blank.length) await chrome.tabs.remove(blank);
      }
      markIrreversible(env); return done(p.operation === 'rename' ? `Renamed group to ${p.new_name}` : p.operation === 'move_window' ? `Moved ${p.name} to a new window` : `${p.operation === 'collapse' ? 'Collapsed' : 'Expanded'} ${p.name}`);
    }
    case 'workspace_action': {
      if (action.params.operation === 'list') return done(env.library.workspaces.length ? `Saved workspaces: ${env.library.workspaces.map(item => item.name).join(', ')}. Say “restore Research workspace”.` : 'No workspaces saved yet. Say “save this workspace as Research”.');
      if (action.params.operation === 'save') {
        const name = action.params.name ?? env.overrides['name:workspace']?.value;
        if (!name) throw new ChoiceRequired('What should this workspace be called?', [], 'name', 'name:workspace');
        const tabs = context.tabIds ? await contextTabs(context) : await chrome.tabs.query({ windowId: context.windowId });
        const groups = await chrome.tabGroups.query({}); const saved = tabs.filter(tab => usable(tab.url));
        if (!saved.length) throw new Error('There are no web pages to save in this workspace.');
        const savedGroups = groups.filter(group => saved.some(tab => !tab.pinned && tab.groupId === group.id));
        const activeTabIndex = saved.findIndex(tab => tab.active && tab.windowId === context.windowId);
        const workspace: Workspace = {
          id: crypto.randomUUID(), name, createdAt: Date.now(), ...(activeTabIndex >= 0 ? { activeTabIndex } : {}),
          groups: savedGroups.map(group => ({ id: `group-${group.id}`, title: (group.title ?? '').slice(0, 100), color: group.color, collapsed: group.collapsed })),
          tabs: saved.map(tab => {
            const group = savedGroups.find(group => group.id === tab.groupId);
            return { url: tab.url!, title: (tab.title ?? '').slice(0, 300), pinned: tab.pinned, ...(group ? { groupId: `group-${group.id}`, group: (group.title ?? '').slice(0, 100), color: group.color } : {}) };
          }),
        };
        await saveWorkspace(workspace); env.library = await getLibrary(); markIrreversible(env); return done(`Saved ${saved.length} tabs as ${name}`);
      }
      const workspace = named(env.library.workspaces, action.params.name ?? '', 'workspace', env);
      const opened: chrome.tabs.Tab[] = [];
      try {
        const first = workspace.tabs[0]!; const created = await chrome.windows.create({ url: first.url, focused: true });
        if (created?.id === undefined) throw new Error('Chrome could not create a workspace window.');
        const firstTab = created.tabs?.[0] ?? (await chrome.tabs.query({ windowId: created.id }))[0]; if (firstTab?.id === undefined) throw new Error('Chrome did not identify the first workspace tab. Check the new window before trying again.');
        opened.push(firstTab); rememberTargets(env, opened);
        await env.onTarget?.(contextFor([firstTab], context), `Opened ${first.title || first.url}`);
        for (const entry of workspace.tabs.slice(1)) {
          checkCancelled(env.signal); const tab = await chrome.tabs.create({ url: entry.url, active: false, windowId: created.id });
          if (tab.id === undefined) throw new Error('Chrome did not identify a workspace tab. Check the new window before trying again.');
          opened.push(tab); rememberTargets(env, opened);
          await env.onTarget?.(contextFor([tab], context), `Opened ${entry.title || entry.url}`);
        }
        for (let index = 0; index < opened.length; index++) {
          checkCancelled(env.signal); const entry = workspace.tabs[index]!; if (!entry.pinned) continue;
          await chrome.tabs.update(opened[index]!.id!, { pinned: true });
          const tab = await chrome.tabs.get(opened[index]!.id!);
          if (!tab.pinned) throw new CommandFailure('unknown-outcome', 'Chrome did not confirm a restored tab’s pin state.');
          await env.onTarget?.(contextFor([tab], context), `Pinned ${entry.title || entry.url}`);
        }
        const grouping = (workspace.groups ?? []).map(group => ({ ...group, indexes: workspace.tabs.flatMap((entry, index) => entry.groupId === group.id ? [index] : []) }));
        // Older workspaces identify groups by title. Preserve that behavior only
        // for tabs without the newer group identity field.
        for (const title of new Set(workspace.tabs.flatMap(entry => !entry.groupId && entry.group ? [entry.group] : []))) {
          const indexes = workspace.tabs.flatMap((entry, index) => !entry.groupId && entry.group === title && !entry.pinned ? [index] : []);
          if (indexes.length) grouping.push({ id: `legacy-${grouping.length}`, title, color: workspace.tabs[indexes[0]!]!.color ?? 'grey', collapsed: false, indexes });
        }
        for (const savedGroup of grouping) {
          checkCancelled(env.signal); const { indexes, title, color, collapsed } = savedGroup;
          const id = await chrome.tabs.group({ tabIds: indexes.map(index => opened[index]!.id!), createProperties: { windowId: created.id } });
          const members = await Promise.all(indexes.map(index => chrome.tabs.get(opened[index]!.id!)));
          if (members.some(tab => tab.groupId !== id)) throw new CommandFailure('unknown-outcome', 'Chrome did not confirm a restored tab group.');
          for (const [memberIndex, tab] of members.entries()) {
            const entry = workspace.tabs[indexes[memberIndex]!]!;
            await env.onTarget?.(contextFor([tab], context), `Grouped ${entry.title || entry.url}`);
          }
          checkCancelled(env.signal);
          await chrome.tabGroups.update(id, { title, color, collapsed });
          const group = await chrome.tabGroups.get(id);
          if ((group.title ?? '') !== title || group.color !== color || group.collapsed !== collapsed) throw new CommandFailure('unknown-outcome', 'Chrome did not confirm the restored group’s name, color, and collapsed state.');
          await env.onTarget?.(contextFor(members, context), `Restored group ${title || 'Untitled group'} · ${color}${collapsed ? ' · collapsed' : ''}`);
        }
        checkCancelled(env.signal);
        const activeIndex = workspace.activeTabIndex ?? 0; const active = opened[activeIndex]!;
        await chrome.tabs.update(active.id!, { active: true });
        const restoredActive = await chrome.tabs.get(active.id!);
        if (!restoredActive.active || restoredActive.windowId !== created.id) throw new CommandFailure('unknown-outcome', 'Chrome did not confirm the workspace’s active tab.');
        await env.onTarget?.(contextFor([restoredActive], context), `Activated ${workspace.tabs[activeIndex]!.title || workspace.tabs[activeIndex]!.url}`);
        markIrreversible(env); return done(`Restored ${workspace.name} · ${opened.length} tabs`, contextFor([restoredActive], context));
      } catch (error) { markIrreversible(env); throw new Error(`Opened ${opened.length} of ${workspace.tabs.length} workspace tabs before restoration stopped. ${error instanceof Error ? error.message : 'Chrome could not finish the restore.'}`); }
    }
    case 'reading_action': {
      const p = action.params;
      if (p.operation === 'list' || p.operation === 'open_unread') {
        const items = (await chrome.readingList.query({ hasBeenRead: false })).filter(item => usable(item.url)).sort((a, b) => b.creationTime - a.creationTime);
        if (!items.length) return done('Your reading list has no unread articles');
        if (p.operation === 'open_unread') {
          if (items.length > 100) throw new Error('There are more than 100 unread articles. Open a smaller selection from Library.');
          throw new ReviewRequired(`Open ${items.length} unread article${items.length === 1 ? '' : 's'} in new tabs?`, [], 'open_reading', items.map(item => item.url));
        }
        const key = 'reading:list'; const chosen = env.overrides[key]?.value;
        if (!chosen) throw new ChoiceRequired(`${items.length} unread articles. Which would you like to open?`, items.slice(0, 50).map((item, index) => ({ id: String(index + 1), label: item.title, value: item.url })), 'reading', key);
        if (!items.some(item => item.url === chosen)) throw new Error('That unread article is no longer in the list.');
        const tab = await chrome.tabs.create({ url: chosen, windowId: context.windowId }); rememberTargets(env, [tab]); return done('Opened the selected article', contextFor([tab], context));
      }
      const tab = await chrome.tabs.get(context.tabId); if (!usable(tab.url)) throw new Error('Open a web article first.');
      if (p.operation === 'save') await chrome.readingList.addEntry({ url: tab.url, title: tab.title ?? tab.url, hasBeenRead: false });
      else {
        if (!(await chrome.readingList.query({ url: tab.url })).length) throw new Error('This page is not in your reading list yet. Say “save this for later”.');
        await chrome.readingList.updateEntry({ url: tab.url, hasBeenRead: p.operation === 'mark_read' });
      }
      markIrreversible(env); return done(p.operation === 'save' ? 'Saved to your reading list' : p.operation === 'mark_read' ? 'Marked as read' : 'Marked as unread');
    }
    case 'help': {
      try { const { result, ref } = await pageCommand(context.tabId, { operation: 'help' }, undefined, env.signal); env.state.page = ref; return done(result.text); }
      catch { return done('Try “open Gmail”, “close the YouTube tab”, “next tab”, “undo that move”, or “save this workspace as Research”. Page controls are available after allowing site access in Settings.'); }
    }
    default: throw new Error('This action is not handled by the extended command engine.');
  }
}
