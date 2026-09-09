import { z } from 'zod';
import { aliasSchema, workspaceSchema, normalizeName, BUILTIN_SITES, type Library, type SiteAlias, type Workspace } from '../common/library';
const storedLibrary = z.object({ aliases: z.array(aliasSchema).max(100).default([]), workspaces: z.array(workspaceSchema).max(30).default([]), suggestions: z.array(aliasSchema).max(30).default([]) });
export async function getLibrary(): Promise<Library> { const { library } = await chrome.storage.local.get('library'); return storedLibrary.parse(library ?? {}); }
export async function saveAlias(input: SiteAlias): Promise<void> {
  const alias = aliasSchema.parse(input); const library = await getLibrary();
  const key = normalizeName(alias.name);
  if (BUILTIN_SITES.some(site => site.aliases.some(name => normalizeName(name) === key))) throw new Error('That name already belongs to a built-in site. Choose a personal nickname such as “work email”.');
  if (library.aliases.some(item => item.id !== alias.id && normalizeName(item.name) === key)) throw new Error('That nickname is already in use. Edit the saved nickname to change its address.');
  const index = library.aliases.findIndex(item => item.id === alias.id);
  if (index < 0) library.aliases.push(alias); else library.aliases[index] = alias;
  library.suggestions = library.suggestions.filter(item => item.url !== alias.url);
  await chrome.storage.local.set({ library: storedLibrary.parse(library) });
}
export async function deleteAlias(id: string): Promise<void> { const library = await getLibrary(); library.aliases = library.aliases.filter(item => item.id !== id); await chrome.storage.local.set({ library }); }
export async function saveWorkspace(input: Workspace): Promise<void> {
  const workspace = workspaceSchema.parse(input); const library = await getLibrary();
  const match = library.workspaces.findIndex(item => item.id === workspace.id || normalizeName(item.name) === normalizeName(workspace.name));
  if (match < 0) library.workspaces.push(workspace); else library.workspaces[match] = { ...workspace, id: library.workspaces[match]!.id };
  await chrome.storage.local.set({ library: storedLibrary.parse(library) });
}
export async function deleteWorkspace(id: string): Promise<void> { const library = await getLibrary(); library.workspaces = library.workspaces.filter(item => item.id !== id); await chrome.storage.local.set({ library }); }
export async function refreshSiteSuggestions(): Promise<SiteAlias[]> {
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
}
export async function clearSiteSuggestions(): Promise<void> { const library = await getLibrary(); library.suggestions = []; await chrome.storage.local.set({ library }); }
