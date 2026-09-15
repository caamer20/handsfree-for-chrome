import { parseCommand } from './command-parser';
import { isNegatedCommand } from './language';

/** Only explicit spoken replacement markers between two complete commands qualify. */
export function spokenCorrection(text: string): string {
  const marker = /\s+(?:no[,]?\s+actually|sorry[,]?\s+i meant|scratch that[,]?)\s+|,\s*actually\s+/i.exec(text);
  if (!marker || marker.index === undefined) return text;
  const before = text.slice(0, marker.index).trim(); const after = text.slice(marker.index + marker[0].length).trim();
  const first = parseCommand(before); const replacement = parseCommand(after);
  // Search strings, dictated text, labels, and saved names keep their literal wording.
  if (!first || !replacement || first.some(action => ['search_site', 'page_action', 'bookmark_page', 'site_alias', 'workspace_action', 'group_action', 'macro_add_site'].includes(action.action) || (action.action === 'create_tab' && action.params.url.includes('?')))) return text;
  return after;
}

export function speechChoices(primary: string, alternatives: string[], identify: (text: string) => string | undefined): string[] {
  if (!alternatives.length || isNegatedCommand(primary)) return [];
  const key = (text: string): string | undefined => isNegatedCommand(text) ? 'no-action' : identify(text) ?? identify(spokenCorrection(text));
  const firstKey = key(primary); const keys = new Set<string>(); const choices: string[] = [];
  for (const text of [primary, ...alternatives.slice(0, 3)]) {
    const intent = key(text); if (!intent || keys.has(intent)) continue;
    keys.add(intent); choices.push(text);
  }
  // An alternate never silently replaces the user's top transcript, even if it parses.
  return choices.length > 1 || (!firstKey && choices.length) ? choices : [];
}
