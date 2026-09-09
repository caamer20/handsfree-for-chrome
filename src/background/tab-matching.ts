import { fuzzyScore, normalize } from './fuzzy';

const names = (text: string): string => normalize(text).replace(/\byou tube\b/g, 'youtube').replace(/\bgit hub\b/g, 'github').replace(/\bchat gpt\b/g, 'chatgpt');
export function literalTabMatch(tab: chrome.tabs.Tab, query: string): boolean {
  const tokens = names(query).split(' ').filter(Boolean);
  if (!tokens.length) return false;
  const fields = [names(tab.title ?? ''), names(tab.url ?? tab.pendingUrl ?? '')];
  return fields.some(field => tokens.every(token => field.split(' ').includes(token)));
}
export function resolveTab(tabs: chrome.tabs.Tab[], query: string): chrome.tabs.Tab {
  const eligible = tabs.filter(tab => tab.id !== undefined);
  const literal = eligible.filter(tab => literalTabMatch(tab, query));
  const matches = literal.length ? literal : eligible.filter(tab => fuzzyScore(names(query), names(tab.title ?? ''), names(tab.url ?? tab.pendingUrl ?? '')) >= 0.7);
  if (!matches.length) throw new Error(`No tab matching “${query}” found. Try a title word or website name.`);
  if (matches.length > 1) {
    const examples = matches.slice(0, 3).map(tab => `“${(tab.title || tab.url || 'Untitled tab').slice(0, 55)}”`).join(', ');
    throw new Error(`${matches.length} tabs match “${query}”: ${examples}. Use a more specific title, or a tab number in the current window.`);
  }
  return matches[0]!;
}
