import { isNegatedCommand } from '../common/language';
import { normalize } from '../background/fuzzy';
import type { ChromeAction } from '../common/schema';

const siteNames: Record<string, string[]> = {
  'google.com': ['google'], 'youtube.com': ['youtube'], 'github.com': ['github'],
  'mail.google.com': ['gmail'], 'wikipedia.org': ['wikipedia'], 'reddit.com': ['reddit'],
};
/** Reject invented destinations, search terms, titles, and folders before executing an AI plan. */
export function validateGrounding(actions: ChromeAction[], transcript: string): ChromeAction[] {
  if (isNegatedCommand(transcript)) throw new Error('This command asks not to act. No changes were made.');
  const source = normalize(transcript);
  const grounded = (slot: string): boolean => {
    const words = normalize(slot).split(' ').filter(Boolean);
    return words.length > 0 && words.every(word => source.split(' ').includes(word));
  };
  for (const action of actions) {
    const slots: string[] = [];
    switch (action.action) {
      case 'browser_page': slots.push(action.params.page); break;
      case 'tab_set': if (action.params.exclude_query) slots.push(action.params.exclude_query); break;
      case 'open_site': slots.push(action.params.site); break;
      case 'search_site': slots.push(action.params.site); if (action.params.query) slots.push(action.params.query); break;
      case 'site_alias': case 'macro_add_site': case 'group_action': slots.push(action.params.name); if ('new_name' in action.params && action.params.new_name) slots.push(action.params.new_name); break;
      case 'select_tabs': slots.push(...action.params.queries); break;
      case 'wait_for_field': case 'move_beside': slots.push(action.params.query); break;
      case 'page_action': if (action.params.query) slots.push(action.params.query); if (action.params.text) slots.push(action.params.text); break;
      case 'workspace_action': if (action.params.name) slots.push(action.params.name); break;
      case 'reference_tabs': case 'audio_action': case 'reading_action': if (action.params.query) slots.push(action.params.query); break;
    }
    if (slots.some(slot => !grounded(slot))) throw new Error('The AI added a name, label, or text you did not say. Try the command with the exact words.');
    if ((action.action === 'find_tab' || (action.action === 'close_tab' && action.params.target === 'matching')) && !grounded(action.params.query ?? '')) throw new Error('The AI invented a tab name. Try “switch to tab containing…” with the name.');
    if (action.action === 'open_bookmark' && action.params.query && !grounded(action.params.query)) throw new Error('The AI invented a bookmark name. Try “open bookmark…” with the name.');
    if (action.action === 'bookmark_page' && ((action.params.title && !grounded(action.params.title)) || (action.params.folder && !grounded(action.params.folder)))) throw new Error('The AI invented a bookmark title or folder. Try a command example.');
    if (action.action === 'create_tab' && action.params.url !== 'chrome://newtab/') {
      const url = new URL(action.params.url);
      const query = url.searchParams.get('q') ?? url.searchParams.get('search_query');
      const engine = /^(www\.)?(google\.com|youtube\.com|github\.com)$/.test(url.hostname);
      if (query && engine) {
        if (!grounded(query)) throw new Error('The AI changed your search terms. Try “search Google for…” with your query.');
      } else {
        const host = url.hostname.replace(/^www\./, '').toLowerCase();
        const namedHome = url.pathname === '/' && !url.search && !url.hash && siteNames[host]?.some(name => grounded(name));
        if (!namedHome && !transcript.toLowerCase().includes(host)) throw new Error('The AI invented a destination. Say the full website address.');
      }
    }
  }
  return actions;
}
