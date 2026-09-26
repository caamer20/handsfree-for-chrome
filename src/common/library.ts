import { z } from 'zod';
import { isSafeUrl } from './urls';

export const siteCategorySchema = z.enum(['search', 'email', 'calendar', 'music', 'documents', 'files', 'assistant']);
export type SiteCategory = z.infer<typeof siteCategorySchema>;
export const CATEGORY_LABELS: Record<SiteCategory, string> = { search: 'Search', email: 'Email / inbox', calendar: 'Calendar', music: 'Music', documents: 'Documents', files: 'Files / drive', assistant: 'AI assistant' };
export interface Site { id: string; name: string; aliases: string[]; url: string; searchUrl?: string; category?: SiteCategory; hosts?: string[]; path?: string; }
const site = (id: string, name: string, url: string, aliases: string[], extra: Partial<Site> = {}): Site => ({ id, name, url, aliases, ...extra });
export const BUILTIN_SITES: Site[] = [
  site('google', 'Google', 'https://www.google.com/', ['google'], { category: 'search', searchUrl: 'https://www.google.com/search?q={query}' }),
  site('bing', 'Bing', 'https://www.bing.com/', ['bing'], { category: 'search', searchUrl: 'https://www.bing.com/search?q={query}' }),
  site('duckduckgo', 'DuckDuckGo', 'https://duckduckgo.com/', ['duckduckgo', 'duck duck go'], { category: 'search', searchUrl: 'https://duckduckgo.com/?q={query}' }),
  site('wikipedia', 'Wikipedia', 'https://en.wikipedia.org/', ['wikipedia', 'wiki'], { searchUrl: 'https://en.wikipedia.org/w/index.php?search={query}', hosts: ['wikipedia.org'] }),
  site('gmail', 'Gmail', 'https://mail.google.com/', ['gmail', 'g mail', 'google mail'], { category: 'email' }),
  site('outlook', 'Outlook', 'https://outlook.live.com/mail/', ['outlook', 'hotmail'], { category: 'email', hosts: ['outlook.live.com', 'outlook.office.com', 'outlook.office365.com'], path: '/mail' }),
  site('google-calendar', 'Google Calendar', 'https://calendar.google.com/', ['google calendar'], { category: 'calendar' }),
  site('outlook-calendar', 'Outlook Calendar', 'https://outlook.live.com/calendar/', ['outlook calendar'], { category: 'calendar', hosts: ['outlook.live.com', 'outlook.office.com'], path: '/calendar' }),
  site('youtube', 'YouTube', 'https://www.youtube.com/', ['youtube', 'you tube'], { searchUrl: 'https://www.youtube.com/results?search_query={query}' }),
  site('spotify', 'Spotify', 'https://open.spotify.com/', ['spotify'], { category: 'music', hosts: ['spotify.com'], searchUrl: 'https://open.spotify.com/search/{query}' }),
  site('apple-music', 'Apple Music', 'https://music.apple.com/', ['apple music'], { category: 'music' }),
  site('youtube-music', 'YouTube Music', 'https://music.youtube.com/', ['youtube music', 'you tube music'], { category: 'music' }),
  site('netflix', 'Netflix', 'https://www.netflix.com/', ['netflix']),
  site('twitch', 'Twitch', 'https://www.twitch.tv/', ['twitch']),
  site('google-docs', 'Google Docs', 'https://docs.google.com/document/', ['google docs', 'docs'], { category: 'documents', path: '/document' }),
  site('google-sheets', 'Google Sheets', 'https://docs.google.com/spreadsheets/', ['google sheets', 'sheets', 'spreadsheets'], { path: '/spreadsheets' }),
  site('google-drive', 'Google Drive', 'https://drive.google.com/', ['google drive'], { category: 'files' }),
  site('onedrive', 'OneDrive', 'https://onedrive.live.com/', ['onedrive', 'one drive'], { category: 'files' }),
  site('dropbox', 'Dropbox', 'https://www.dropbox.com/', ['dropbox'], { category: 'files' }),
  site('github', 'GitHub', 'https://github.com/', ['github', 'git hub'], { searchUrl: 'https://github.com/search?q={query}' }),
  site('gitlab', 'GitLab', 'https://gitlab.com/', ['gitlab', 'git lab'], { searchUrl: 'https://gitlab.com/search?search={query}' }),
  site('stack-overflow', 'Stack Overflow', 'https://stackoverflow.com/', ['stack overflow', 'stackoverflow'], { searchUrl: 'https://stackoverflow.com/search?q={query}' }),
  site('notion', 'Notion', 'https://www.notion.so/', ['notion'], { category: 'documents', hosts: ['notion.so', 'notion.site'] }),
  site('slack', 'Slack', 'https://app.slack.com/', ['slack'], { hosts: ['slack.com'] }),
  site('teams', 'Microsoft Teams', 'https://teams.microsoft.com/', ['teams', 'microsoft teams'], { hosts: ['teams.microsoft.com', 'teams.live.com'] }),
  site('reddit', 'Reddit', 'https://www.reddit.com/', ['reddit'], { searchUrl: 'https://www.reddit.com/search/?q={query}' }),
  site('instagram', 'Instagram', 'https://www.instagram.com/', ['instagram', 'insta']),
  site('facebook', 'Facebook', 'https://www.facebook.com/', ['facebook']),
  site('linkedin', 'LinkedIn', 'https://www.linkedin.com/', ['linkedin', 'linked in']),
  site('x', 'X / Twitter', 'https://x.com/', ['x', 'twitter'], { hosts: ['x.com', 'twitter.com'] }),
  site('amazon', 'Amazon', 'https://www.amazon.com/', ['amazon'], { searchUrl: 'https://www.amazon.com/s?k={query}' }),
  site('ebay', 'eBay', 'https://www.ebay.com/', ['ebay', 'e bay'], { searchUrl: 'https://www.ebay.com/sch/i.html?_nkw={query}' }),
  site('etsy', 'Etsy', 'https://www.etsy.com/', ['etsy'], { searchUrl: 'https://www.etsy.com/search?q={query}' }),
  site('chatgpt', 'ChatGPT', 'https://chatgpt.com/', ['chatgpt', 'chat gpt', 'chat g p t'], { category: 'assistant' }),
  site('claude', 'Claude', 'https://claude.ai/', ['claude'], { category: 'assistant' }),
  site('gemini', 'Gemini', 'https://gemini.google.com/', ['gemini'], { category: 'assistant' }),
  site('perplexity', 'Perplexity', 'https://www.perplexity.ai/', ['perplexity'], { category: 'assistant' }),
];
export function normalizeName(value: string): string { return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
export function categoryForName(name: string): SiteCategory | undefined {
  const key = normalizeName(name).replace(/^my /, '');
  const map: Record<string, SiteCategory> = { search: 'search', 'search engine': 'search', email: 'email', mail: 'email', inbox: 'email', calendar: 'calendar', music: 'music', documents: 'documents', document: 'documents', files: 'files', drive: 'files', assistant: 'assistant', ai: 'assistant' };
  return map[key];
}
const webUrl = z.string().trim().min(1).max(4000).refine(url => isSafeUrl(url) && url !== 'chrome://newtab/', 'Use an HTTP(S) website address without embedded credentials.');
export const aliasSchema = z.object({ id: z.string().uuid(), name: z.string().trim().min(1).max(60), url: webUrl, searchUrl: z.string().trim().max(4000).default('').refine(url => !url || (url.split('{query}').length === 2 && isSafeUrl(url.replace('{query}', 'test')) && !url.startsWith('chrome:')), 'A search URL must be HTTP(S) and contain {query} exactly once.') }).strict();
export type SiteAlias = z.infer<typeof aliasSchema>;
const groupColorSchema = z.enum(['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange']);
const workspaceGroupSchema = z.object({ id: z.string().min(1).max(80), title: z.string().max(100), color: groupColorSchema, collapsed: z.boolean() }).strict();
const workspaceSnapshotObject = z.object({
  createdAt: z.number(),
  activeTabIndex: z.number().int().min(0).max(99).optional(),
  groups: z.array(workspaceGroupSchema).max(100).optional(),
  tabs: z.array(z.object({ url: webUrl, title: z.string().max(300), pinned: z.boolean(), group: z.string().max(100).optional(), color: groupColorSchema.optional(), groupId: z.string().min(1).max(80).optional() }).strict()).min(1).max(100),
}).strict();
function validateWorkspaceSnapshot(workspace: z.infer<typeof workspaceSnapshotObject>, ctx: z.RefinementCtx): void {
  if (workspace.activeTabIndex !== undefined && workspace.activeTabIndex >= workspace.tabs.length) ctx.addIssue({ code: 'custom', path: ['activeTabIndex'], message: 'The active tab must refer to a saved tab.' });
  const groups = new Map(workspace.groups?.map(group => [group.id, group]) ?? []);
  if (groups.size !== (workspace.groups?.length ?? 0)) ctx.addIssue({ code: 'custom', path: ['groups'], message: 'Every saved group must have a unique ID.' });
  for (const [index, tab] of workspace.tabs.entries()) {
    if (tab.groupId === undefined) continue;
    const group = groups.get(tab.groupId);
    if (!group) ctx.addIssue({ code: 'custom', path: ['tabs', index, 'groupId'], message: 'The tab refers to an unknown saved group.' });
    if (tab.pinned) ctx.addIssue({ code: 'custom', path: ['tabs', index, 'groupId'], message: 'Pinned tabs cannot belong to a saved group.' });
    if (group && ((tab.group !== undefined && tab.group !== group.title) || (tab.color !== undefined && tab.color !== group.color))) ctx.addIssue({ code: 'custom', path: ['tabs', index], message: 'The tab’s group label and color must match its saved group.' });
  }
  for (const [index, group] of (workspace.groups ?? []).entries()) {
    if (!workspace.tabs.some(tab => tab.groupId === group.id)) ctx.addIssue({ code: 'custom', path: ['groups', index], message: 'A saved group must contain at least one tab.' });
  }
}
export const workspaceSnapshotSchema = workspaceSnapshotObject.superRefine(validateWorkspaceSnapshot);
export type WorkspaceSnapshot = z.infer<typeof workspaceSnapshotSchema>;
export const legacyWorkspaceSchema = workspaceSnapshotObject.extend({ id: z.string().uuid(), name: z.string().trim().min(1).max(60) }).strict().superRefine(validateWorkspaceSnapshot);
export const workspaceSchema = workspaceSnapshotObject.extend({
  id: z.string().uuid(), name: z.string().trim().min(1).max(60), previous: workspaceSnapshotSchema.optional(),
}).strict().superRefine(validateWorkspaceSnapshot);
export type Workspace = z.infer<typeof workspaceSchema>;
export function workspaceSnapshot(workspace: Workspace): WorkspaceSnapshot {
  return { createdAt: workspace.createdAt, tabs: structuredClone(workspace.tabs), ...(workspace.groups ? { groups: structuredClone(workspace.groups) } : {}), ...(workspace.activeTabIndex !== undefined ? { activeTabIndex: workspace.activeTabIndex } : {}) };
}
/** Plain text shared by workspace replacement choices and portable import reviews. */
export function workspaceSnapshotDetails(snapshot: WorkspaceSnapshot): string[] {
  const groups = snapshot.groups ?? [];
  return [
    `Active tab: ${(snapshot.activeTabIndex ?? 0) + 1}`,
    ...groups.map((group, index) => `Group ${index + 1}: ${group.title || 'Untitled group'} · ${group.color} · ${group.collapsed ? 'Collapsed' : 'Expanded'}`),
    ...snapshot.tabs.map((tab, index) => {
      const groupIndex = groups.findIndex(group => group.id === tab.groupId);
      const group = groupIndex >= 0 ? ` · Group ${groupIndex + 1}` : tab.group ? ` · Group: ${tab.group} · ${tab.color ?? 'grey'}` : '';
      return `Tab ${index + 1}: ${tab.title || 'Untitled tab'} · ${tab.url} · ${tab.pinned ? 'Pinned' : 'Unpinned'}${group}`;
    }),
  ];
}
export interface Library { aliases: SiteAlias[]; workspaces: Workspace[]; suggestions: SiteAlias[]; }
export const aliasAsSite = (alias: SiteAlias): Site => ({ id: alias.id, name: alias.name, aliases: [normalizeName(alias.name)], url: alias.url, ...(alias.searchUrl ? { searchUrl: alias.searchUrl } : {}), path: new URL(alias.url).pathname });
export function siteMatchesUrl(site: Site, value: string): boolean {
  try {
    const url = new URL(value); const base = new URL(site.url);
    const host = url.hostname.replace(/^www\./, '');
    const hosts = site.hosts ?? [base.hostname.replace(/^www\./, '')];
    if (!hosts.some(h => host === h || (!!site.hosts && host.endsWith(`.${h}`)))) return false;
    if (site.path && site.path !== '/') {
      const path = site.path.replace(/\/$/, '');
      if (url.pathname !== path && !url.pathname.startsWith(`${path}/`)) return false;
    }
    return [...base.searchParams].every(([key, value]) => url.searchParams.get(key) === value);
  } catch { return false; }
}
