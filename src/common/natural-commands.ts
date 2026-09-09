import type { ChromeAction } from './schema';
import { targetClause, splitNames } from './expanded-parser';
import { BUILTIN_SITES, normalizeName } from './library';
import { spokenQuantity } from './language';
const page = (params: Extract<ChromeAction, { action: 'page_action' }>['params']): ChromeAction[] => [{ action: 'page_action', params }];
const targetAction = (target: string, action: ChromeAction): ChromeAction[] | null => { const selected = targetClause(target); return selected ? [...selected, action] : null; };
const integer = (text: string): number | undefined => { const value = spokenQuantity(text); return value !== undefined && Number.isInteger(value) && value >= 1 && value <= 1000 ? value : undefined; };

export function literalCommand(raw: string): ChromeAction[] | null {
  const match = raw.match(/^(?:type|write|enter text)\s+(.+)$/is); if (!match?.[1]) return null;
  const payload = match[1];
  if (/^(?:in|into)\s+/i.test(payload)) return page({ operation: 'focus', query: payload.replace(/^(?:in|into)\s+(?:the\s+)?/i, '') });
  const quoted = payload.match(/^["“]([\s\S]*?)["”](?:\s+(?:in|into)\s+(?:the\s+)?(.+?)(?:\s+(?:field|box))?)?$/i);
  if (quoted) return page({ operation: 'type', text: quoted[1]!, ...(quoted[2] ? { query: quoted[2] } : {}) });
  if (/^["“]/.test(payload)) return null; // A quoted payload may precede another explicit command.
  const field = payload.match(/^(.+?)\s+into\s+(?:the\s+)?(.+?)(?:\s+(?:field|box))?$/i) ?? payload.match(/^(.+?)\s+in\s+(?:the\s+)?(.+?)\s+(?:field|box)$/i);
  return page({ operation: 'type', text: field?.[1] ?? payload, ...(field?.[2] ? { query: field[2] } : {}) });
}
export function naturalSearch(raw: string): ChromeAction[] | null {
  const local = raw.match(/^(?:find|search for)\s+(.+?)\s+(?:on|in)\s+(?:this|the)\s+(?:page|website)$/i);
  if (local?.[1]) return page({ operation: 'find', query: local[1].replace(/^["“](.*)["”]$/, '$1') });
  const search = raw.match(/^(?:find|look for)\s+(.+?)\s+on\s+(.+)$/i);
  if (search?.[1] && search[2]) return [{ action: 'search_site', params: { site: search[2], query: search[1] } }];
  const aliases = BUILTIN_SITES.flatMap(site => site.aliases.map(alias => ({ alias, site }))).sort((a, b) => b.alias.length - a.alias.length);
  for (const { alias, site } of aliases) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
    const match = raw.match(new RegExp(`^${escaped}\\s+(?:search(?: for)?|look up)\\s+(.+)$`, 'i'));
    if (match?.[1]) return [{ action: 'search_site', params: { site: alias, query: match[1] } }];
    if (['google', 'youtube', 'github'].includes(site.id)) continue; // Preserve the established explicit search encoding.
    const direct = raw.match(new RegExp(`^search\\s+(${escaped})\\s+(?:for\\s+)?(.+)$`, 'i'));
    if (direct?.[1] && direct[2]) return [{ action: 'search_site', params: { site: direct[1], query: direct[2] } }];
  }
  return null;
}
function duration(input: string): number | undefined {
  const clock = input.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (clock) {
    if (Number(clock[2]) >= 60 || (clock[3] && Number(clock[3]) >= 60)) return undefined;
    return clock[3] ? Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]) : Number(clock[1]) * 60 + Number(clock[2]);
  }
  let total = 0; let end = 0;
  for (const match of input.matchAll(/(.+?)\s+(hours?|minutes?|seconds?)(?:\s+(?:and\s+)?)?/gi)) {
    if (match.index !== end) return undefined;
    const quantity = /^(?:a|an)$/i.test(match[1]!) ? 1 : spokenQuantity(match[1]!);
    if (quantity === undefined) return undefined;
    total += quantity * (/^hour/i.test(match[2]!) ? 3600 : /^minute/i.test(match[2]!) ? 60 : 1); end = match.index + match[0].length;
  }
  return end === input.length && end > 0 && total <= 86400 ? total : undefined;
}
export function naturalCommand(raw: string, parse: (text: string) => ChromeAction[] | null): ChromeAction[] | null {
  let m: RegExpMatchArray | null; const c = raw.toLowerCase();
  m = raw.match(/^(?:on|in|for)\s+(.+?),\s*(.+)$/i);
  if (m?.[1] && m[2]) { const targets = targetClause(m[1]); const actions = parse(m[2]); return targets && actions ? [...targets, ...actions] : null; }
  m = raw.match(/^((?:pause|play|resume|rewind|fast forward|turn|set|increase|decrease|raise|lower|scroll|zoom)\b.+?)\s+(?:on|in)\s+(.+?)(?:\s+tab)?$/i);
  if (m?.[1] && m[2]) {
    const actions = parse(m[1]); const targets = targetClause(m[2]);
    if (targets && actions?.length === 1 && ['page_action', 'zoom'].includes(actions[0]!.action)) return [...targets, ...actions];
  }
  m = raw.match(/^(?:open|go to|take me to)\s+((?:[a-z\d-]+\s+dot\s+)+[a-z]{2,})$/i);
  if (m?.[1]) return [{ action: 'create_tab', params: { url: `https://${m[1].replace(/\s+dot\s+/gi, '.')}` } }];
  m = raw.match(/^(?:go to|take me to)\s+(.+)$/i);
  if (m?.[1] && !/\b(?:tab|page|window|bookmark|top|bottom)\b|https?:|\./i.test(m[1])) return [{ action: 'open_site', params: { site: m[1].replace(/^(?:the|my)\s+/i, '') } }];
  m = raw.match(/^(?:go|switch|jump|skip)\s+(?:over\s+)?(?:forward|ahead|right|back|backward|left)\s+(.+?)\s+tabs?$/i);
  if (m?.[1]) { const count = integer(m[1]); if (count) return [{ action: 'select_tab', params: { position: /\b(?:back|backward|left)\b/i.test(raw) ? 'previous' : 'next', offset: count, activate: true } }]; }
  m = raw.match(/^(?:switch to|go to|close|mute|unmute|pin|unpin|reload|duplicate)\s+(?:the\s+)?(.+?)\s+tab\s+from (?:the\s+)?(?:right|end)$/i);
  if (m?.[1]) {
    const index = integer(m[1]); if (!index) return null;
    const switching = /^(?:switch|go)\b/i.test(raw);
    const selector: ChromeAction = { action: 'select_tab', params: { position: 'index', index, from_end: true, activate: switching } };
    if (switching) return [selector];
    const mutation = parse(`${raw.split(' ')[0]} this tab`); return mutation ? [selector, ...mutation] : null;
  }
  if (/^(?:switch back|go back to (?:the )?(?:last|previous) tab|return to (?:the )?tab i was (?:just )?(?:on|using))$/i.test(raw)) return [{ action: 'reference_tabs', params: { reference: 'previous', activate: true } }];
  m = raw.match(/^move\s+(.+?)\s+(?:places?|positions?|slots?)\s+(?:to (?:the )?)?(left|right)$/i);
  if (m?.[1] && m[2]) {
    const words = m[1].split(/\s+/);
    for (let index = 1; index < words.length; index++) {
      const steps = integer(words.slice(index).join(' '));
      if (steps) return targetAction(words.slice(0, index).join(' '), { action: 'move_tab', params: { position: m[2].toLowerCase() as 'left' | 'right', steps } });
    }
  }
  m = raw.match(/^(?:zoom(?: (?:in|out))?(?: to)?|set (?:the )?zoom to)\s+(.+?)\s*(?:percent|%)$/i);
  if (m?.[1]) { const value = spokenQuantity(m[1]); if (value !== undefined && value >= 25 && value <= 500) return [{ action: 'zoom', params: { mode: 'set', factor: value / 100 } }]; }
  m = raw.match(/^(?:click|press|open|select)\s+(?:the\s+)?(?:(?:number|link|result|button)\s+)?(.+?)(?:\s+(?:result|link|button))?(?:\s+in (?:a )?(new|background) tab)?$/i);
  if (m?.[1] && !/^open (?:a )?new tab$/i.test(raw)) {
    const index = integer(m[1]); if (index && index <= 200) return page({ operation: 'activate', index, ...(m[2] ? { new_tab: true, background: m[2] === 'background' } : {}) });
  }
  m = raw.match(/^(?:rewind|skip back|go back|jump back)\s+(?:by\s+)?(.+)$/i);
  if (m?.[1]) { const seconds = duration(m[1]); if (seconds !== undefined) return page({ operation: 'media_seek', value: -seconds, relative: true }); }
  m = raw.match(/^(?:fast forward|skip forward|go forward|jump ahead)\s+(?:by\s+)?(.+)$/i);
  if (m?.[1]) { const seconds = duration(m[1]); if (seconds !== undefined) return page({ operation: 'media_seek', value: seconds, relative: true }); }
  m = raw.match(/^(?:jump|skip|seek|go) to\s+(.+)$/i);
  if (m?.[1]) { const seconds = duration(m[1]); if (seconds !== undefined) return page({ operation: 'media_seek', value: seconds, relative: false }); }
  if (/^(?:restart|start over|play from (?:the )?beginning)(?: (?:the|this) (?:video|song|audio|media))?$/.test(c)) return page({ operation: 'media_seek', value: 0, relative: false });
  m = raw.match(/^(?:turn |set |put )?(?:the )?volume (?:to |at )?(.+?)(?:\s*(?:percent|%))?$/i);
  if (m?.[1]) { const value = spokenQuantity(m[1]); if (value !== undefined && value >= 0 && value <= 100) return page({ operation: 'media_volume', value, relative: false }); }
  m = raw.match(/^(?:(?:turn|bring|put) (?:the )?volume (up|down)|(?:increase|decrease|raise|lower) (?:the )?volume)(?: by)?\s+(.+?)(?:\s*(?:percent|%))?$/i);
  if (m?.[2]) { const value = spokenQuantity(m[2]); if (value !== undefined && value >= 0 && value <= 100) return page({ operation: 'media_volume', value: /\b(?:down|decrease|lower)\b/.test(c) ? -value : value, relative: true }); }
  m = raw.match(/^(pause|play|resume)\s+(.+?)(?:\s+(?:video|music|audio|playback))?$/i);
  if (m?.[1] && m[2] && !/^(?:(?:the|this)\s+)?(?:video|music|audio|media|playback)$|^(?:the|this|it)$/i.test(m[2])) return targetAction(m[2], { action: 'page_action', params: { operation: m[1].toLowerCase() === 'pause' ? 'media_pause' : 'media_play' } });
  m = raw.match(/^(?:focus|click in|put (?:the )?cursor in)\s+(?:the\s+)?(.+?)\s+(?:field|box)$/i);
  if (m?.[1]) return page({ operation: 'focus', query: m[1] });
  m = raw.match(/^(?:look for|search for|find)\s+(.+?)\s+(?:on|in)\s+(?:this|the)\s+(?:page|website)$/i);
  if (m?.[1]) return page({ operation: 'find', query: m[1].replace(/^["“](.*)["”]$/, '$1') });
  m = raw.match(/^(?:save|remember) (?:this session|this window|these tabs)(?: as| called)?\s+(.+)$/i);
  if (m?.[1]) return [{ action: 'workspace_action', params: { operation: 'save', name: m[1] } }];
  m = raw.match(/^(?:load|reopen|restore)\s+(?:my\s+)?(.+?)\s+(?:session|workspace)$/i);
  if (m?.[1]) return [{ action: 'workspace_action', params: { operation: 'restore', name: m[1] } }];
  m = raw.match(/^(?:put|organize|collect)\s+(.+?)\s+(?:in|into)\s+(?:a\s+)?group\s+(?:called|named)\s+(.+)$/i);
  if (m?.[1] && m[2]) return targetAction(m[1], { action: 'group_action', params: { operation: 'create', name: m[2] } });
  if (/^(?:add (?:this|the) page to (?:my )?(?:favorites|bookmarks)|save (?:this|the) page as a bookmark)$/.test(c)) return [{ action: 'bookmark_page', params: {} }];
  if (/^(?:add (?:this|the) (?:page|article) to (?:my )?(?:reading list|read later)|save (?:this|the) article for later|read (?:this|the) page later)$/.test(c)) return [{ action: 'reading_action', params: { operation: 'save' } }];
  m = raw.match(/^open (?:my\s+)?(.+?)\s+bookmark$/i); if (m?.[1]) return [{ action: 'open_bookmark', params: { query: m[1] } }];
  m = raw.match(/^bookmark\s+(.+)$/i); if (m?.[1] && !/^(?:this|the|current)\s+(?:page|tab)\b/i.test(m[1])) return targetAction(m[1], { action: 'bookmark_page', params: {} });
  return tabSetCommand(raw, parse);
}
function tabSetCommand(raw: string, parse: (text: string) => ChromeAction[] | null): ChromeAction[] | null {
  let m = raw.match(/^(close|mute|unmute|pin|unpin|reload|refresh|duplicate)\s+tabs?\s+(.+?)\s+(?:through|to)\s+(.+)$/i);
  if (m?.[1] && m[2] && m[3]) {
    const first = integer(m[2]); const last = integer(m[3]);
    if (first && last && last >= first && last - first < 50) return [{ action: 'tab_set', params: { operation: 'target', filter: 'all', indices: Array.from({ length: last - first + 1 }, (_, i) => first + i) } }, ...parse(`${m[1]} this tab`)!];
    return null;
  }
  m = raw.match(/^(close|mute|unmute|pin|unpin|reload|refresh|duplicate)\s+tabs?\s+(.+)$/i);
  if (m?.[1] && m[2] && /,|\band\b/i.test(m[2])) {
    const indices = splitNames(m[2]).map(value => integer(value.replace(/^and\s+/i, '')));
    if (indices.every((value): value is number => value !== undefined)) return [{ action: 'tab_set', params: { operation: 'target', filter: 'all', indices: [...new Set(indices)] } }, ...parse(`${m[1]} this tab`)!];
  }
  m = raw.match(/^(close|mute|unmute|pin|unpin|reload|refresh|duplicate|show|list)\s+(?:me\s+)?(?:all (?:of )?(?:the |my )?|my |the )?(?:(pinned|unpinned|muted|unmuted|audible|playing|all|open)\s+)?tabs(?:\s+(?:in|across)\s+(all|every|this|the current)\s+windows?)?(?:\s+(?:except|apart from|other than)\s+(.+))?$/i);
  if (m?.[1]) {
    const verb = m[1].toLowerCase(); const filter = /^(?:all|open)$/.test(m[2] ?? '') ? 'all' : m[2] === 'playing' ? 'audible' : m[2] ?? 'all';
    const listing = verb === 'show' || verb === 'list';
    const action: ChromeAction = { action: 'tab_set', params: { operation: listing ? 'list' : 'target', filter: filter as 'all' | 'pinned' | 'unpinned' | 'muted' | 'unmuted' | 'audible', scope: m[3] && /all|every/i.test(m[3]) ? 'all' : 'window', ...(m[4] ? { exclude_query: m[4].replace(/^(?:the|my)\s+/i, '').replace(/\s+tab$/i, '') } : {}) } };
    // Preserve the existing contracts for plain singular and bulk-close forms.
    if (!listing && !m[2] && !m[3] && !m[4] && !/^(?:mute|unmute|pin|unpin|reload|refresh|duplicate)\s+all\b/i.test(raw)) return null;
    return listing ? [action] : [action, ...parse(`${verb} this tab`)!];
  }
  if (/^(?:what(?:['’]s| is) open|which tabs (?:are open|do i have)|show me (?:my )?open tabs)$/i.test(raw)) return [{ action: 'tab_set', params: { operation: 'list', filter: 'all', scope: 'window' } }];
  m = raw.match(/^(?:close (?:everything|all (?:other )?tabs) (?:except|but)|keep only)\s+(.+?)(?:\s+open)?$/i);
  if (m?.[1] && !/^(?:this|the current|this one)(?: tab)?$/i.test(m[1])) return [{ action: 'tab_set', params: { operation: 'target', filter: 'all', exclude_query: m[1].replace(/^(?:the|my)\s+/i, '').replace(/\s+tab$/i, '') } }, { action: 'close_tab', params: { target: 'current' } }];
  m = raw.match(/^(mute|unmute|pin|unpin|reload|refresh|duplicate)\s+(all\s+.+?\s+tabs|.+?\s+tabs)$/i);
  if (m?.[1] && m[2] && normalizeName(m[2]) !== 'other tabs') { const targets = targetClause(m[2], true); const mutation = parse(`${m[1]} this tab`); if (targets && mutation) return [...targets, ...mutation]; }
  return null;
}
