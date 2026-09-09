import type { ChromeAction } from './schema';
import type { PageParams } from './expanded-schema';
import { BUILTIN_SITES, normalizeName } from './library';
import { targetClause } from './expanded-parser';

const page = (params: PageParams): ChromeAction[] => [{ action: 'page_action', params }];
const unquote = (value: string): string => value.replace(/^["“]([\s\S]*)["”]$/, '$1');
/** Literal replacements are read before sequence splitting, just like typed text. */
export function formLiteral(raw: string): ChromeAction[] | null {
  const m = raw.match(/^(?:fill|replace)(?: the)? ["“](.+?)["”](?: field| box)? with (.+)$/i) ?? raw.match(/^(?:fill|replace)(?: the)? (.+?)(?: field| box)? with (.+)$/i);
  if (m?.[1] && m[2]) return page({ operation: 'fill', ...(/^(?:this|current|focused)(?: field| box)?$/i.test(m[1]) ? {} : { query: unquote(m[1]) }), text: unquote(m[2]) });
  return null;
}
export function incompleteSearch(raw: string): ChromeAction[] | null {
  if (/^(?:search|search the web)$/i.test(raw)) return [{ action: 'search_site', params: { site: 'search' } }];
  const m = raw.match(/^search(?: on)? (.+)$/i);
  if (m?.[1] && BUILTIN_SITES.some(site => site.searchUrl && site.aliases.includes(normalizeName(m[1]!)))) return [{ action: 'search_site', params: { site: m[1] } }];
  return null;
}
export function productivityCommand(raw: string): ChromeAction[] | null {
  const field = raw.match(/^wait for (?:the )?(.+?) (?:field|box)(?: to (?:appear|be ready))?$/i);
  if (field?.[1]) return [{ action: 'wait_for_field', params: { query: unquote(field[1]) } }];
  let m = raw.match(/^(?:open|show)(?: my| the| chrome)? (downloads|history|bookmarks|settings|extensions)(?: page| manager)?$/i);
  if (m?.[1]) return [{ action: 'browser_page', params: { page: m[1].toLowerCase() as 'downloads' | 'history' | 'bookmarks' | 'settings' | 'extensions' } }];
  if (/^wait (?:for (?:the |this )?page (?:to (?:load|finish loading)|load)|until (?:the |this )?page loads)$/i.test(raw)) return [{ action: 'wait_for_page', params: {} }];
  m = raw.match(/^(?:sort|order|organize)(?: the| my)? (?:ungrouped )?tabs (?:by (title|name|site|website|domain)|alphabetically)$/i);
  if (m) return [{ action: 'organize_tabs', params: { operation: !m[1] || /title|name/i.test(m[1]) ? 'sort_title' : 'sort_site' } }];
  m = raw.match(/^ungroup (?:the )?(.+?) group$/i);
  if (m?.[1]) return [{ action: 'group_action', params: { operation: 'ungroup', name: m[1] } }];
  m = raw.match(/^ungroup (.+)$/i);
  if (m?.[1]) {
    const targets = /^(?:all |the )?tabs$/i.test(m[1]) ? [{ action: 'tab_set' as const, params: { operation: 'target' as const, filter: 'all' as const } }] : targetClause(m[1]);
    if (targets) return [...targets, { action: 'organize_tabs', params: { operation: 'ungroup' } }];
  }
  m = raw.match(/^(?:make|color|colour)(?: the)? (.+?) group (grey|gray|blue|red|yellow|green|pink|purple|cyan|orange)$/i);
  if (m?.[1] && m[2]) return [{ action: 'group_action', params: { operation: 'color', name: m[1], color: (m[2].toLowerCase() === 'gray' ? 'grey' : m[2].toLowerCase()) as 'grey' } }];
  if (/^(?:show|number|list)(?: the)? (?:form |text )?fields$/i.test(raw)) return page({ operation: 'show_fields' });
  m = raw.match(/^(?:(?:go|move|jump)(?: to)?|focus)?\s*(?:the )?(next|previous) (?:form |text )?field$/i);
  if (m?.[1]) return page({ operation: m[1].toLowerCase() === 'next' ? 'next_field' : 'previous_field' });
  if (/^(?:select|highlight) all(?: (?:the )?text)?(?: in (?:this|the|current|focused) (?:field|box))?$/i.test(raw)) return page({ operation: 'select_all' });
  if (/^(?:delete|remove|erase)(?: the)? selected text$/i.test(raw)) return page({ operation: 'delete_selection' });
  m = raw.match(/^(?:clear|empty)(?: the)? (.+?)(?: field| box)$/i);
  if (m?.[1]) return page({ operation: 'clear', ...(/^(?:this|current|focused)$/i.test(m[1]) ? {} : { query: unquote(m[1]) }) });
  m = raw.match(/^(?:select|choose|pick) (.+?) (?:from|in)(?: the)? (.+?)(?: dropdown| drop-down| menu| list)$/i);
  if (m?.[1] && m[2]) return page({ operation: 'select_option', text: unquote(m[1]), query: unquote(m[2]) });
  m = raw.match(/^(check|uncheck|tick|untick)(?: the)? (.+?)(?: checkbox| check box)?$/i);
  if (m?.[1] && m[2]) return page({ operation: /^(check|tick)$/i.test(m[1]) ? 'check' : 'uncheck', query: unquote(m[2]) });
  return null;
}
