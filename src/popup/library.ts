import { element as el } from './dom';
import { aliasSchema, BUILTIN_SITES, CATEGORY_LABELS, type SiteAlias, type SiteCategory } from '../common/library';
import type { AppState } from '../common/types';
import type { Message } from '../common/schema';
import { errorText, send } from '../common/messaging';

const button = (label: string, handler: () => void): HTMLButtonElement => {
  const node = document.createElement('button'); node.type = 'button'; node.className = 'secondary'; node.textContent = label; node.addEventListener('click', handler); return node;
};
const card = (name: string, detail: string): HTMLElement => {
  const node = document.createElement('article'); node.className = 'macro-card';
  const heading = document.createElement('h3'); heading.textContent = name;
  const info = document.createElement('p'); info.className = 'fine-print'; info.textContent = detail;
  node.append(heading, info); return node;
};
export class LibraryPanel {
  private editingId: string | null = null;
  constructor(private perform: (message: Message) => Promise<boolean>, private showControl: () => void) {
    document.querySelectorAll<HTMLElement>('[data-library]').forEach(tab => tab.addEventListener('click', () => this.show(tab.dataset.library ?? 'sites')));
    document.querySelectorAll<HTMLElement>('[data-routine-view]').forEach(tab => tab.addEventListener('click', () => this.show(tab.dataset.routineView ?? 'routines')));
    el('new-alias').addEventListener('click', () => this.edit());
    el('cancel-alias').addEventListener('click', () => { el('alias-form').hidden = true; this.editingId = null; });
    el('alias-form').addEventListener('submit', event => { event.preventDefault(); void this.save(); });
    el('refresh-sites').addEventListener('click', () => { void perform({ target: 'background', type: 'REFRESH_SITE_SUGGESTIONS' }); });
    el('refresh-reading').addEventListener('click', () => { void this.reading(); });
    el('site-count').textContent = `(${BUILTIN_SITES.length})`;
    for (const site of BUILTIN_SITES) {
      const row = button(site.name, () => { void this.run(`open ${site.aliases[0]}`); }); row.title = site.url;
      el('builtin-sites').append(row);
    }
  }
  show(name: string): void {
    const collection = name === 'macros' ? 'routines' : name;
    el('routine-switcher').hidden = collection !== 'routines';
    document.querySelectorAll<HTMLElement>('.library-section').forEach(section => { section.hidden = section.id !== `library-${name}`; });
    document.querySelectorAll<HTMLElement>('[data-library]').forEach(tab => { if (tab.dataset.library === collection) tab.setAttribute('aria-current', 'page'); else tab.removeAttribute('aria-current'); });
    document.querySelectorAll<HTMLElement>('[data-routine-view]').forEach(tab => { if (tab.dataset.routineView === name) tab.setAttribute('aria-current', 'page'); else tab.removeAttribute('aria-current'); });
    if (name === 'reading') void this.reading();
  }
  private async run(text: string): Promise<void> { if (await this.perform({ target: 'background', type: 'RUN_TEXT', text })) this.showControl(); }
  render(state: AppState): void {
    const library = state.library ?? { aliases: [], workspaces: [], suggestions: [] };
    const aliases = el('alias-list'); aliases.replaceChildren();
    if (!library.aliases.length) aliases.append(card('Your names, your websites', 'Say “call this site Work dashboard”, or add a nickname here.'));
    for (const alias of library.aliases) {
      const node = card(alias.name, alias.url); const actions = document.createElement('div'); actions.className = 'button-row';
      actions.append(button('Open', () => { void this.run(`open ${alias.name}`); }), button('Edit', () => this.edit(alias)), button('Delete', () => { void this.perform({ target: 'background', type: 'DELETE_ALIAS', id: alias.id }); }));
      node.append(actions); aliases.append(node);
    }
    el('suggestions-wrap').hidden = !state.settings.learnTopSites;
    const suggestions = el('site-suggestions'); suggestions.replaceChildren();
    for (const alias of library.suggestions) { const node = card(alias.name, alias.url); node.append(button('Review & add', () => this.edit(alias))); suggestions.append(node); }
    if (state.settings.learnTopSites && !library.suggestions.length) suggestions.append(card('No new suggestions', 'Saved and built-in sites are already available. Try Refresh after browsing.'));
    const workspaces = el('workspace-list'); workspaces.replaceChildren();
    if (!library.workspaces.length) workspaces.append(card('Keep a project ready', 'Save a workspace by voice or in the command box. Up to 100 web tabs per workspace.'));
    for (const workspace of library.workspaces) {
      const node = card(workspace.name, `${workspace.tabs.length} tabs · Saved ${new Date(workspace.createdAt).toLocaleDateString()}`);
      const details = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = 'View saved tabs'; details.append(summary);
      const list = document.createElement('ol'); list.className = 'macro-sites';
      for (const tab of workspace.tabs) { const item = document.createElement('li'); item.textContent = `${tab.pinned ? 'Pinned · ' : ''}${tab.group ? tab.group + ' · ' : ''}${tab.title || tab.url}`; item.title = tab.url; list.append(item); }
      details.append(list); const actions = document.createElement('div'); actions.className = 'button-row';
      const restore = button('Restore in new window', () => { void this.perform({ target: 'background', type: 'RESTORE_WORKSPACE', id: workspace.id }).then(ok => { if (ok) this.showControl(); }); });
      restore.disabled = state.listening || state.hud.phase === 'thinking';
      actions.append(restore, button('Delete', () => { void this.perform({ target: 'background', type: 'DELETE_WORKSPACE', id: workspace.id }); }));
      node.append(details, actions); workspaces.append(node);
    }
    for (const [category, label] of Object.entries(CATEGORY_LABELS)) {
      let select = document.getElementById(`default-${category}`) as HTMLSelectElement | null;
      const selected = select?.value ?? state.settings.siteDefaults[category as SiteCategory] ?? '';
      if (!select) { const row = document.createElement('label'); row.textContent = label; select = document.createElement('select'); select.id = `default-${category}`; row.append(select); el('site-defaults').append(row); }
      select.replaceChildren(new Option(category === 'search' ? 'Google · default' : 'Ask me', ''));
      for (const site of BUILTIN_SITES.filter(site => site.category === category)) select.add(new Option(site.name, site.id));
      for (const alias of library.aliases) select.add(new Option(alias.name, alias.id));
      select.value = selected;
    }
  }
  defaults(): Partial<Record<SiteCategory, string>> {
    return Object.fromEntries(Object.keys(CATEGORY_LABELS).flatMap(category => { const value = el<HTMLSelectElement>(`default-${category}`).value; return value ? [[category, value]] : []; }));
  }
  private edit(alias?: SiteAlias): void {
    this.editingId = alias?.id ?? null; el('alias-form').hidden = false; el('alias-heading').textContent = alias ? 'Edit site nickname' : 'New site nickname';
    el<HTMLInputElement>('alias-name').value = alias?.name ?? ''; el<HTMLInputElement>('alias-url').value = alias?.url ?? ''; el<HTMLInputElement>('alias-search').value = alias?.searchUrl ?? '';
    el<HTMLInputElement>('alias-name').focus();
  }
  private async save(): Promise<void> {
    try {
      const alias = aliasSchema.parse({ id: this.editingId ?? crypto.randomUUID(), name: el<HTMLInputElement>('alias-name').value, url: el<HTMLInputElement>('alias-url').value, searchUrl: el<HTMLInputElement>('alias-search').value });
      if (await this.perform({ target: 'background', type: 'SAVE_ALIAS', alias })) { el('alias-form').hidden = true; this.editingId = null; el('library-status').textContent = `Saved “${alias.name}”. Say “open ${alias.name}”.`; }
    } catch (error) { el('library-status').textContent = errorText(error); }
  }
  private async reading(): Promise<void> {
    try {
      const reply = await send({ target: 'background', type: 'GET_READING_LIST' }); if (!reply.ok) throw new Error(reply.error);
      const items = (reply.readingList ?? []).sort((a, b) => Number(a.hasBeenRead) - Number(b.hasBeenRead) || b.creationTime - a.creationTime);
      const list = el('reading-list'); list.replaceChildren();
      if (!items.length) list.append(card('Something for later', 'Your saved articles will appear here.'));
      for (const item of items) {
        const node = card(item.title, `${item.hasBeenRead ? 'Read' : 'Unread'} · ${new URL(item.url).hostname}`); const actions = document.createElement('div'); actions.className = 'button-row';
        const update = async (operation: 'open' | 'read' | 'unread' | 'remove'): Promise<void> => { await this.perform({ target: 'background', type: 'UPDATE_READING_ITEM', operation, url: item.url }); await this.reading(); };
        actions.append(button('Open', () => { void update('open'); }), button(item.hasBeenRead ? 'Mark unread' : 'Mark read', () => { void update(item.hasBeenRead ? 'unread' : 'read'); }), button('Remove', () => { void update('remove'); }));
        node.append(actions); list.append(node);
      }
    } catch (error) { el('library-status').textContent = errorText(error); }
  }
}
