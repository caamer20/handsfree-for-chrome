import { normalize } from '../background/fuzzy';
import type { ChromeAction } from '../common/schema';

/** Reject invented destinations, search terms, titles, and folders before showing an AI plan. */
export function validateGrounding(actions: ChromeAction[], transcript: string): ChromeAction[] {
  const source = normalize(transcript);
  const grounded = (slot: string): boolean => {
    const words = normalize(slot).split(' ').filter(Boolean);
    return words.length > 0 && words.every(word => source.split(' ').includes(word));
  };
  for (const action of actions) {
    if (action.action === 'find_tab' && !grounded(action.params.query)) throw new Error('The AI invented a tab name. Try “switch to tab containing…” with the name.');
    if (action.action === 'open_bookmark' && action.params.query && !grounded(action.params.query)) throw new Error('The AI invented a bookmark name. Try “open bookmark…” with the name.');
    if (action.action === 'bookmark_page' && ((action.params.title && !grounded(action.params.title)) || (action.params.folder && !grounded(action.params.folder)))) throw new Error('The AI invented a bookmark title or folder. Try a command example.');
    if (action.action === 'create_tab' && action.params.url !== 'chrome://newtab/') {
      const url = new URL(action.params.url);
      const query = url.searchParams.get('q') ?? url.searchParams.get('search_query');
      const engine = /^(www\.)?(google\.com|youtube\.com|github\.com)$/.test(url.hostname);
      if (query && engine) {
        if (!grounded(query)) throw new Error('The AI changed your search terms. Try “search Google for…” with your query.');
      } else if (!transcript.toLowerCase().includes(url.hostname.replace(/^www\./, '').toLowerCase())) throw new Error('The AI invented a destination. Say the full website address.');
    }
  }
  return actions;
}
