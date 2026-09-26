import { z } from 'zod';
import { aliasSchema, workspaceSchema, workspaceSnapshot, workspaceSnapshotSchema, normalizeName, BUILTIN_SITES, type Library, type SiteAlias, type Workspace, type WorkspaceSnapshot } from '../common/library';
import { withLibraryWrite } from './library-write';
const storedLibrary = z.object({ aliases: z.array(aliasSchema).max(100).default([]), workspaces: z.array(workspaceSchema).max(30).default([]), suggestions: z.array(aliasSchema).max(30).default([]) });
export async function getLibrary(): Promise<Library> { const { library } = await chrome.storage.local.get('library'); return storedLibrary.parse(library ?? {}); }
export async function saveAlias(input: SiteAlias): Promise<void> {
  return withLibraryWrite(async () => {
    const alias = aliasSchema.parse(input); const library = await getLibrary();
    const key = normalizeName(alias.name);
    if (BUILTIN_SITES.some(site => site.aliases.some(name => normalizeName(name) === key))) throw new Error('That name already belongs to a built-in site. Choose a personal nickname such as “work email”.');
    if (library.aliases.some(item => item.id !== alias.id && normalizeName(item.name) === key)) throw new Error('That nickname is already in use. Edit the saved nickname to change its address.');
    const index = library.aliases.findIndex(item => item.id === alias.id);
    if (index < 0) library.aliases.push(alias); else library.aliases[index] = alias;
    library.suggestions = library.suggestions.filter(item => item.url !== alias.url);
    await chrome.storage.local.set({ library: storedLibrary.parse(library) });
  });
}
export async function deleteAlias(id: string): Promise<void> { return withLibraryWrite(async () => { const library = await getLibrary(); library.aliases = library.aliases.filter(item => item.id !== id); await chrome.storage.local.set({ library }); }); }
export async function saveWorkspace(input: Workspace, beforeSave?: () => void): Promise<void> {
  return withLibraryWrite(async () => {
    const workspace = workspaceSchema.parse(input); const library = await getLibrary();
    if (library.workspaces.some(item => item.id === workspace.id || normalizeName(item.name) === normalizeName(workspace.name))) throw new Error(`A workspace named “${workspace.name}” is already saved. Say “update ${workspace.name} workspace” to review a replacement.`);
    beforeSave?.();
    library.workspaces.push(workspace);
    await chrome.storage.local.set({ library: storedLibrary.parse(library) });
  });
}
export async function replaceWorkspace(expected: Workspace, input: WorkspaceSnapshot, validateSource?: () => Promise<void>): Promise<void> {
  return withLibraryWrite(async () => {
    const proposal = workspaceSnapshotSchema.parse(input); const library = await getLibrary();
    const index = library.workspaces.findIndex(item => item.id === expected.id); const current = library.workspaces[index];
    if (!current || JSON.stringify(current) !== JSON.stringify(workspaceSchema.parse(expected))) throw new Error('This saved workspace changed after the question appeared. Ask to update or recover it again.');
    await validateSource?.();
    library.workspaces[index] = workspaceSchema.parse({ ...proposal, id: current.id, name: current.name, previous: workspaceSnapshot(current) });
    try { await chrome.storage.local.set({ library: storedLibrary.parse(library) }); }
    catch { throw new Error('Chrome could not save this workspace version. Your saved workspace and previous version are unchanged. Free extension storage and try again.'); }
  });
}
function checkedWorkspace(library: Library, expected: Workspace): { index: number; current: Workspace } {
  const index = library.workspaces.findIndex(workspace => workspace.id === expected.id); const current = library.workspaces[index];
  if (!current || JSON.stringify(current) !== JSON.stringify(workspaceSchema.parse(expected))) throw new Error('This saved workspace changed after the question appeared. Ask again to review its current version.');
  return { index, current };
}
export async function renameWorkspace(expected: Workspace, name: string, beforeSave?: () => void): Promise<void> {
  return withLibraryWrite(async () => {
    const library = await getLibrary(); const { index, current } = checkedWorkspace(library, expected);
    const renamed = workspaceSchema.parse({ ...current, name });
    if (library.workspaces.some(workspace => workspace.id !== current.id && normalizeName(workspace.name) === normalizeName(renamed.name))) throw new Error(`A workspace named “${renamed.name}” is already saved. Choose a different name.`);
    beforeSave?.();
    if (renamed.name === current.name) return;
    library.workspaces[index] = renamed;
    try { await chrome.storage.local.set({ library: storedLibrary.parse(library) }); }
    catch { throw new Error('Chrome could not rename this workspace. Its name, saved tabs, and previous version are unchanged. Try again.'); }
  });
}
export async function discardPreviousWorkspace(expected: Workspace, beforeSave?: () => void): Promise<void> {
  return withLibraryWrite(async () => {
    const library = await getLibrary(); const { index, current } = checkedWorkspace(library, expected);
    if (!current.previous) throw new Error('There is no previous saved version to discard.');
    beforeSave?.();
    const next = { ...current }; delete next.previous; library.workspaces[index] = next;
    try { await chrome.storage.local.set({ library: storedLibrary.parse(library) }); }
    catch { throw new Error('Chrome could not discard the previous workspace version. Both saved versions are unchanged. Try again.'); }
  });
}
export async function deleteWorkspace(id: string): Promise<void> { return withLibraryWrite(async () => { const library = await getLibrary(); library.workspaces = library.workspaces.filter(item => item.id !== id); await chrome.storage.local.set({ library }); }); }
export async function refreshSiteSuggestions(): Promise<SiteAlias[]> {
  return withLibraryWrite(async () => {
    if (!(await chrome.permissions.contains({ permissions: ['topSites'] }))) throw new Error('Enable Learn my sites in Settings and allow Chrome’s top-sites permission.');
    const library = await getLibrary(); const suggestions: SiteAlias[] = []; const seen = new Set<string>();
    for (const item of await chrome.topSites.get()) {
      let url: URL; try { url = new URL(item.url); } catch { continue; }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) continue;
      // Suggestions use the origin, never a visited page's private path or query.
      const address = `${url.origin}/`;
      if (seen.has(address) || library.aliases.some(alias => new URL(alias.url).origin === url.origin) || BUILTIN_SITES.some(site => new URL(site.url).hostname.replace(/^www\./, '') === url.hostname.replace(/^www\./, ''))) continue;
      seen.add(address);
      suggestions.push({ id: crypto.randomUUID(), name: url.hostname.replace(/^www\./, '').slice(0, 60), url: address, searchUrl: '' });
      if (suggestions.length === 30) break;
    }
    library.suggestions = suggestions; await chrome.storage.local.set({ library }); return suggestions;
  });
}
export async function clearSiteSuggestions(): Promise<void> { return withLibraryWrite(async () => { const library = await getLibrary(); library.suggestions = []; await chrome.storage.local.set({ library }); }); }
