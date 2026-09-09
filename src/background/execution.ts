import type { ProgressEvent } from '../common/progress';
import { BUILTIN_SITES, aliasAsSite, categoryForName, normalizeName, siteMatchesUrl, type Library, type Site } from '../common/library';
import { ChoiceRequired, checkCancelled, tabRef, type ChoiceOverrides, type Conversation, type TargetContext, type UndoPatch, type UndoRecord, type UndoValues } from '../common/conversation';
import type { ChromeAction, Settings } from '../common/schema';
import { literalTabMatch } from './tab-matching';
import { fuzzyScore } from './fuzzy';
import type { Macro } from '../common/macros';

export interface ExecutionEnvironment { settings: Settings; library: Library; macros: Macro[]; state: Conversation; overrides: ChoiceOverrides; operationId: string; transcript: string; signal?: AbortSignal; reviewed?: boolean; onProgress?: (event: ProgressEvent) => Promise<void>; }
export function sites(env: ExecutionEnvironment): Site[] { return [...BUILTIN_SITES, ...env.library.aliases.map(aliasAsSite)]; }
export function resolveSite(name: string, env: ExecutionEnvironment): Site {
  const all = sites(env); const normalized = normalizeName(name).replace(/^(?:my|the) /, '');
  const override = env.overrides[`site:${normalized}`];
  if (override?.value) { const chosen = all.find(site => site.id === override.value); if (chosen) return chosen; throw new Error('That saved site is no longer available.'); }
  const alias = env.library.aliases.find(alias => normalizeName(alias.name) === normalized);
  if (alias) return aliasAsSite(alias);
  const category = categoryForName(normalized);
  if (category) {
    const id = env.settings.siteDefaults[category] || (category === 'search' ? 'google' : undefined);
    const saved = id ? all.find(site => site.id === id) : undefined;
    if (saved) return saved;
    const candidates = all.filter(site => site.category === category);
    throw new ChoiceRequired(`Which app should “${name}” use? You can set a default in Settings.`, candidates.map(site => ({ id: site.id, label: site.name, value: site.id })), 'site', `site:${normalized}`);
  }
  const match = all.find(site => site.id === name || site.aliases.some(alias => normalizeName(alias) === normalized));
  if (match) return match;
  throw new Error(`I don’t know a site called “${name}”. Add a nickname in Library, or say its website address.`);
}
export function trySite(name: string, env: ExecutionEnvironment): Site | undefined {
  try { return resolveSite(name, env); } catch (error) { if (error instanceof ChoiceRequired) throw error; return undefined; }
}
export function matchTabs(tabs: chrome.tabs.Tab[], query: string, env?: ExecutionEnvironment): chrome.tabs.Tab[] {
  const site = env ? trySite(query, env) : undefined;
  const literal = tabs.filter(tab => tab.id !== undefined && (site ? siteMatchesUrl(site, tab.url ?? tab.pendingUrl ?? '') : literalTabMatch(tab, query)));
  if (literal.length) return literal;
  return site ? [] : tabs.filter(tab => tab.id !== undefined && fuzzyScore(query, tab.title ?? '', tab.url ?? tab.pendingUrl ?? '') >= 0.7);
}
function safeHost(url?: string): string { try { return new URL(url ?? '').hostname; } catch { return 'Chrome page'; } }
export async function resolveTabs(query: string, context: TargetContext, env: ExecutionEnvironment, multiple = false): Promise<chrome.tabs.Tab[]> {
  const key = `tabs:${normalizeName(query)}`; const override = env.overrides[key];
  if (override?.tabs?.length) return Promise.all(override.tabs.map(tab => chrome.tabs.get(tab.id)));
  const tabs = await chrome.tabs.query({}); checkCancelled(env.signal);
  const matches = matchTabs(tabs, query, env);
  if (!matches.length) throw new Error(`No tab matching “${query}” found. Try a title word, a site nickname, or “open ${query}”.`);
  if (matches.length > 1 && !multiple) {
    env.state.candidates = matches.map(tabRef); env.state.at = Date.now();
    throw new ChoiceRequired(`${matches.length} tabs match “${query}”. Which one?`, matches.slice(0, 50).map(tab => ({ id: String(tab.id), label: tab.title ?? 'Untitled tab', detail: `${tab.windowId === context.windowId ? 'This window' : 'Another window'} · ${safeHost(tab.url)}`, tabs: [tabRef(tab)] })), 'tabs', key);
  }
  return matches;
}
export function rememberTargets(env: ExecutionEnvironment, tabs: chrome.tabs.Tab[]): void {
  const refs = tabs.filter(tab => tab.id !== undefined).map(tabRef);
  if (!refs.length) return;
  const old = env.state.targets.map(tab => tab.id).join(','); const next = refs.map(tab => tab.id).join(',');
  if (old !== next) env.state.previousTargets = env.state.targets;
  env.state.targets = refs; env.state.at = Date.now();
}
export async function contextTabs(context: TargetContext): Promise<chrome.tabs.Tab[]> { return Promise.all((context.tabIds ?? [context.tabId]).map(id => chrome.tabs.get(id))); }
export function contextFor(tabs: chrome.tabs.Tab[], fallback: TargetContext): TargetContext {
  const first = tabs[0]; if (first?.id === undefined) return fallback;
  return { tabId: first.id, windowId: first.windowId, ...(tabs.length > 1 ? { tabIds: tabs.flatMap(tab => tab.id === undefined ? [] : [tab.id]) } : {}) };
}
export function markIrreversible(env: ExecutionEnvironment): void { env.state.lastUndoId = null; }
export async function undoSnapshot(action: ChromeAction, tabId: number): Promise<UndoValues | null> {
  if (!['mute_tab', 'pin_tab', 'move_tab', 'move_beside', 'zoom'].includes(action.action)) return null;
  if (action.action === 'zoom') return { zoom: await chrome.tabs.getZoom(tabId) };
  const tab = await chrome.tabs.get(tabId);
  if (action.action === 'mute_tab') return { muted: tab.mutedInfo?.muted ?? false };
  return { ...(action.action === 'pin_tab' ? { pinned: tab.pinned } : {}), index: tab.index, windowId: tab.windowId };
}
export function recordUndo(env: ExecutionEnvironment, kind: UndoRecord['kinds'][number], patch: UndoPatch): void {
  if (JSON.stringify(patch.before) === JSON.stringify(patch.after)) return;
  let record = env.state.undo.find(record => record.id === env.operationId);
  if (!record) { record = { id: env.operationId, label: env.transcript.slice(0, 120), kinds: [], patches: [], at: Date.now() }; env.state.undo.unshift(record); env.state.undo = env.state.undo.slice(0, 10); }
  if (!record.kinds.includes(kind)) record.kinds.push(kind);
  record.patches.push({ ...patch, kind }); env.state.lastUndoId = record.id;
}
export async function applyUndo(env: ExecutionEnvironment, kind?: UndoRecord['kinds'][number]): Promise<string> {
  const record = kind ? env.state.undo.find(record => record.kinds.includes(kind)) : env.state.undo.find(record => record.id === env.state.lastUndoId);
  if (!record) throw new Error('There is no matching change to undo. Undo supports tab moves, pinning, muting, and zoom.');
  const selected = record.patches.filter(patch => !kind || patch.kind === kind);
  const merged = new Map<number, UndoPatch>();
  for (const patch of selected) {
    const prior = merged.get(patch.tabId);
    merged.set(patch.tabId, prior ? { ...prior, before: { ...patch.before, ...prior.before }, after: { ...prior.after, ...patch.after } } : { ...patch, before: { ...patch.before }, after: { ...patch.after } });
  }
  const patches = [...merged.values()].reverse();
  // Check every target before applying the saved values.
  for (const patch of patches) {
    checkCancelled(env.signal);
    const tab = await chrome.tabs.get(patch.tabId); const expected = patch.after;
    if ((expected.muted !== undefined && !!tab.mutedInfo?.muted !== expected.muted) || (expected.pinned !== undefined && tab.pinned !== expected.pinned) || (expected.windowId !== undefined && tab.windowId !== expected.windowId) || (expected.index !== undefined && tab.index !== expected.index) || (expected.zoom !== undefined && Math.abs(await chrome.tabs.getZoom(patch.tabId) - expected.zoom) > 0.001)) throw new Error('A target changed after this command. Its latest state will be kept.');
  }
  for (const patch of patches) {
    checkCancelled(env.signal); const before = patch.before;
    if (before.muted !== undefined) await chrome.tabs.update(patch.tabId, { muted: before.muted });
    if (before.pinned !== undefined) await chrome.tabs.update(patch.tabId, { pinned: before.pinned });
    if (before.index !== undefined) await chrome.tabs.move(patch.tabId, { index: before.index, ...(before.windowId !== undefined ? { windowId: before.windowId } : {}) });
    if (before.zoom !== undefined) await chrome.tabs.setZoom(patch.tabId, before.zoom);
  }
  const undoneKinds = kind ? [kind] : record.kinds;
  record.patches = record.patches.filter(patch => !selected.includes(patch));
  record.kinds = [...new Set(record.patches.flatMap(patch => patch.kind ? [patch.kind] : []))];
  env.state.undo = env.state.undo.filter(item => item.patches.length); env.state.lastUndoId = env.state.undo[0]?.id ?? null;
  return `Undid ${undoneKinds.join(', ')} change${undoneKinds.length === 1 ? '' : 's'}`;
}

export async function finalizeUndo(env: ExecutionEnvironment): Promise<void> {
  const record = env.state.undo.find(item => item.id === env.operationId);
  if (!record) return;
  const latest = new Map<number, chrome.tabs.Tab>();
  for (const patch of record.patches) {
    const tab = latest.get(patch.tabId) ?? await chrome.tabs.get(patch.tabId).catch(() => undefined);
    if (!tab) continue;
    latest.set(patch.tabId, tab);
    if (patch.after.index !== undefined) patch.after.index = tab.index;
    if (patch.after.windowId !== undefined) patch.after.windowId = tab.windowId;
    if (patch.after.pinned !== undefined) patch.after.pinned = tab.pinned;
    if (patch.after.muted !== undefined) patch.after.muted = tab.mutedInfo?.muted ?? false;
    if (patch.after.zoom !== undefined) patch.after.zoom = await chrome.tabs.getZoom(patch.tabId);
  }
}
