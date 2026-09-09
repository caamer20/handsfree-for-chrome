import type { ChromeAction } from './schema';
import { spokenNumber, tabSelector, referenceSelector } from './tab-target';
import { stripRequestFraming } from './language';
import { normalizeName } from './library';

export function interruptIntent(text: string): { stopListening: boolean; replacement?: string } | null {
  const raw = stripRequestFraming(text);
  if (/^(?:stop listening|microphone off|stop (?:the )?microphone|stop voice control|turn (?:the )?(?:mic|microphone) off|turn off (?:the )?(?:mic|microphone))$/i.test(raw)) return { stopListening: true };
  if (/^(?:stop|stop that|cancel|cancel that|cancel (?:the )?command|never mind|nevermind|forget it|forget that|abort|abort that|hold on|wait|scratch that)$/i.test(raw)) return { stopListening: false };
  const correction = raw.match(/^(?:actually[,\s]+|no[,\s]+)(.+?)(?:\s+instead)?$/i)?.[1];
  if (correction && /^(?:close|open|mute|unmute|pin|unpin|move|put|switch|find|reload|refresh|scroll|group|save|pause|play|zoom)\b/i.test(correction)) return { stopListening: false, replacement: correction };
  if (/^(?:actually[,\s]+)?keep (?:that|it|that tab) open$/i.test(raw)) return { stopListening: false };
  return null;
}
function number(value: string): number | undefined {
  const raw = value.trim().toLowerCase();
  if (/^-?\d+(?:\.\d+)?$/.test(raw)) return Number(raw);
  return spokenNumber(raw) ?? ({ zero: 0, half: 0.5 } as Record<string, number>)[raw];
}
export function splitNames(raw: string): string[] {
  const parts: string[] = []; let start = 0; let quote = false;
  for (const match of raw.matchAll(/["“”]|\s+and\s+|\s*,\s*/gi)) {
    if (/^["“”]$/.test(match[0])) { quote = !quote; continue; }
    if (!quote) { parts.push(raw.slice(start, match.index).trim()); start = (match.index ?? 0) + match[0].length; }
  }
  parts.push(raw.slice(start).trim());
  return parts.filter(Boolean).map(text => text.replace(/^and\s+/i, '').replace(/^["“](.*)["”]$/, '$1'));
}
export function targetClause(raw: string, plural = false): ChromeAction[] | null {
  const reference = referenceSelector(raw); if (reference) return reference;
  let target = raw.trim().replace(/^my\s+/i, '');
  if (/^(?:this|current|active)(?: tab| page)?$|^tab$/i.test(target)) return [];
  const all = plural || /^all\s+/i.test(target) || /\stabs$/i.test(target);
  target = target.replace(/^all\s+(?:the\s+)?/i, '').replace(/\s+tabs?$/i, '');
  const queries = splitNames(target).map(q => q.replace(/^(?:the|my)\s+/i, '').trim());
  if (queries.length > 1 || all) return [{ action: 'select_tabs', params: { queries, all_matches: all } }];
  return tabSelector(raw, false, true);
}
export function expandedSearch(raw: string): ChromeAction[] | null {
  let m = raw.match(/^(?:search|look on)\s+(.+?)\s+for\s+(.+)$/i);
  if (m?.[1] && m[2]) {
    if (['google', 'youtube', 'github'].includes(normalizeName(m[1]))) return null;
    return [{ action: 'search_site', params: { site: m[1].replace(/^(?:my|the)\s+/i, ''), query: m[2] } }];
  }
  m = raw.match(/^(?:look up|search for)\s+(.+?)\s+on\s+(.+)$/i);
  if (m?.[1] && m[2]) {
    if (/^search for /i.test(raw) && ['google', 'youtube', 'github'].includes(normalizeName(m[2]))) return null;
    return [{ action: 'search_site', params: { site: m[2].replace(/^(?:my|the)\s+/i, ''), query: m[1] } }];
  }
  m = raw.match(/^search(?:\s+the web)?\s+for\s+(.+)$/i);
  if (m?.[1]) return [{ action: 'search_site', params: { site: 'search', query: m[1] } }];
  return null;
}
export function expandedCommand(raw: string): ChromeAction[] | null {
  const c = raw.toLowerCase(); let m: RegExpMatchArray | null;
  if (/^(?:help|what can i say(?: here)?|what can i do here|show (?:me )?(?:the )?commands)$/.test(c)) return [{ action: 'help', params: {} }];
  if (/^(?:undo(?: that| the last change)?|put (?:it|that) back|restore (?:the )?previous zoom)$/.test(c)) return [{ action: 'undo_action', params: c.includes('zoom') ? { kind: 'zoom' } : {} }];
  m = c.match(/^undo (?:that |the |last )?(move|pin|pinning|mute|muting|zoom)(?: change)?$/);
  if (m?.[1]) return [{ action: 'undo_action', params: { kind: m[1].startsWith('pin') ? 'pin' : m[1].startsWith('mut') ? 'mute' : m[1] as 'move' | 'zoom' } }];
  if (/^(?:start|begin) dictation$/.test(c)) return [{ action: 'page_action', params: { operation: 'dictate_start' } }];
  if (/^(?:stop|end|finish) dictation$/.test(c)) return [{ action: 'page_action', params: { operation: 'dictate_stop' } }];
  m = raw.match(/^(?:type|write)\s+["“]?(.+?)["”]?\s+(?:in|into)\s+(?:the\s+)?(.+?)(?:\s+(?:field|box))?$/i);
  if (m?.[1] && m[2]) return [{ action: 'page_action', params: { operation: 'type', text: m[1], query: m[2] } }];
  m = raw.match(/^type\s+(?:into|in)\s+(?:the\s+)?(.+?)(?:\s+field)?$/i);
  if (m?.[1]) return [{ action: 'page_action', params: { operation: 'focus', query: m[1] } }];
  m = raw.match(/^(?:type|write)\s+(.+)$/i);
  if (m?.[1]) return [{ action: 'page_action', params: { operation: 'type', text: m[1].replace(/^["“](.*)["”]$/, '$1') } }];
  if (/^(?:show|number|label)(?: me)? (?:the )?(?:links|buttons|clickable targets|clickable elements)$/.test(c)) return [{ action: 'page_action', params: { operation: 'show_links' } }];
  if (/^(?:hide|clear) (?:the )?(?:links|numbers|labels)$/.test(c)) return [{ action: 'page_action', params: { operation: 'hide_links' } }];
  m = raw.match(/^(?:click|open|press|select)\s+(?:the\s+)?(?:(?:number|link|result)\s+)?(\S+)(?:\s+(?:result|link|button))?(?:\s+in (?:a )?(new|background) tab)?$/i);
  if (m?.[1] && number(m[1]) !== undefined && /\b(?:number|result|link|click|press)\b/i.test(raw)) return [{ action: 'page_action', params: { operation: 'activate', index: number(m[1]), ...(m[2] ? { new_tab: true, background: m[2].toLowerCase() === 'background' } : {}) } }];
  m = raw.match(/^(?:click|press)\s+(?:the\s+)?(.+?)(?:\s+(?:button|link))?$/i);
  if (m?.[1]) return [{ action: 'page_action', params: { operation: 'activate', query: m[1].replace(/^["“](.*)["”]$/, '$1') } }];
  m = raw.match(/^find\s+["“]?(.+?)["”]?\s+(?:on|in)\s+(?:this|the)\s+page$/i);
  if (m?.[1]) return [{ action: 'page_action', params: { operation: 'find', query: m[1] } }];
  if (/^(?:next|previous|prior) match$/.test(c)) return [{ action: 'page_action', params: { operation: c.startsWith('next') ? 'find_next' : 'find_previous' } }];
  m = c.match(/^(?:scroll|page)\s+(up|down|left|right)(?:\s+(a little|a bit|half a page|one page|a page))?$/);
  if (m?.[1]) return [{ action: 'page_action', params: { operation: 'scroll', direction: m[1] as 'up' | 'down' | 'left' | 'right', amount: /little|bit/.test(m[2] ?? '') ? 'little' : m[2]?.includes('half') ? 'half' : 'page' } }];
  if (/^(?:keep going|a little more|scroll more)$/.test(c)) return [{ action: 'page_action', params: { operation: 'scroll', amount: 'repeat' } }];
  m = c.match(/^(?:scroll |go |back )?(?:to )?(?:the )?(top|bottom)(?: of (?:the )?page)?$/);
  if (m?.[1]) return [{ action: 'page_action', params: { operation: 'scroll', direction: m[1] as 'top' | 'bottom' } }];
  m = c.match(/^(play|pause|resume|toggle)(?: (?:this|the))? (?:video|music|audio|media|playback)$/);
  if (m?.[1]) return [{ action: 'page_action', params: { operation: m[1] === 'pause' ? 'media_pause' : m[1] === 'toggle' ? 'media_toggle' : 'media_play' } }];
  m = c.match(/^(?:go|skip|seek|jump)\s+(back|forward|ahead)\s+(\S+)\s+seconds?$/);
  if (m?.[1] && m[2] && number(m[2]) !== undefined) return [{ action: 'page_action', params: { operation: 'media_seek', value: (number(m[2]) ?? 0) * (m[1] === 'back' ? -1 : 1), relative: true } }];
  m = c.match(/^(?:set |turn )?(?:the )?volume(?: to)?\s+(\S+)(?:\s*(?:percent|%))?$/);
  if (m?.[1] && number(m[1].replace('%', '')) !== undefined) return [{ action: 'page_action', params: { operation: 'media_volume', value: number(m[1].replace('%', '')), relative: false } }];
  m = c.match(/^(?:turn (?:the )?volume (up|down)|(?:volume) (up|down)|make (?:this|it) (quieter|louder))$/);
  if (m) return [{ action: 'page_action', params: { operation: 'media_volume', value: /down|quieter/.test(c) ? -10 : 10, relative: true } }];
  if (/^(?:which|what) tab is (?:making noise|playing (?:audio|music)|making (?:that )?sound)\??$/.test(c)) return [{ action: 'audio_action', params: { operation: 'list' } }];
  if (/^(?:take me to|find|show) (?:the )?tab (?:playing (?:music|audio)|making noise)$/.test(c)) return [{ action: 'audio_action', params: { operation: 'focus' } }];
  m = raw.match(/^mute (?:everything|all(?: other)? tabs) except\s+(.+)$/i);
  if (m?.[1]) return [{ action: 'audio_action', params: { operation: 'mute_others', query: m[1] } }];
  if (/^mute (?:all )?other tabs$/.test(c)) return [{ action: 'audio_action', params: { operation: 'mute_others' } }];
  if (/^(?:show|find|list) (?:me )?(?:the )?duplicate tabs$/.test(c)) return [{ action: 'duplicates_action', params: { operation: 'show' } }];
  if (/^(?:close|remove|clean up) (?:the )?(?:duplicate tabs|duplicates|copies|extra copies)$/.test(c)) return [{ action: 'duplicates_action', params: { operation: 'close' } }];
  m = raw.match(/^(?:call|name) (?:this|that) (?:site|website|tab)\s+(.+)$/i);
  if (m?.[1]) return [{ action: 'site_alias', params: { name: m[1].replace(/^my\s+/i, '').replace(/^["“](.*)["”]$/, '$1') } }];
  m = raw.match(/^add (?:this|that) (?:site|page|website) to\s+(?:my\s+)?(.+)$/i);
  if (m?.[1]) return [{ action: 'macro_add_site', params: { name: m[1] } }];
  if (/^(?:save (?:this|it)(?: page)? for later|read (?:this|it) later|add (?:this|it) to (?:my )?reading list)$/.test(c)) return [{ action: 'reading_action', params: { operation: 'save' } }];
  if (/^(?:show|list) (?:my )?(?:reading list|unread articles)$/.test(c)) return [{ action: 'reading_action', params: { operation: 'list' } }];
  if (/^open (?:my )?unread articles$/.test(c)) return [{ action: 'reading_action', params: { operation: 'open_unread' } }];
  m = c.match(/^mark (?:this|it)(?: (?:page|article))? (?:as )?(read|unread)$/);
  if (m?.[1]) return [{ action: 'reading_action', params: { operation: m[1] === 'read' ? 'mark_read' : 'mark_unread' } }];
  m = raw.match(/^save\s+(this workspace|these tabs|this window)(?:\s+(?:as|called)\s+(.+))?$/i);
  if (m) return [...(m[1]?.toLowerCase() === 'these tabs' ? [{ action: 'reference_tabs', params: { reference: 'these' } } as ChromeAction] : []), { action: 'workspace_action', params: { operation: 'save', ...(m[2] ? { name: m[2] } : {}) } }];
  m = raw.match(/^(?:open|restore|bring back)\s+(?:my\s+)?(.+?)\s+workspace$/i) ?? raw.match(/^restore\s+(?:my\s+)?(.+?)\s+tabs$/i) ?? raw.match(/^(?:open|bring back)\s+(?:my\s+)?(.+?)\s+work tabs$/i);
  if (m?.[1]) return [{ action: 'workspace_action', params: { operation: 'restore', name: m[1] } }];
  if (/^(?:show|list) (?:my )?workspaces$/.test(c)) return [{ action: 'workspace_action', params: { operation: 'list' } }];
  m = raw.match(/^group\s+(.+?)\s+(?:as|into|under)\s+(.+)$/i);
  if (m?.[1] && m[2]) { const targets = targetClause(m[1]); if (targets) return [...targets, { action: 'group_action', params: { operation: 'create', name: m[2] } }]; }
  m = raw.match(/^(?:move|put)\s+(.+?)\s+(next to|beside|before|after)\s+(.+)$/i);
  if (m?.[1] && m[2] && m[3]) { const targets = targetClause(m[1]); if (targets) return [...targets, { action: 'move_beside', params: { query: m[3].replace(/^(?:my|the)\s+/i, '').replace(/\s+tab$/i, ''), side: m[2].toLowerCase() === 'before' ? 'before' : 'after' } }]; }
  m = raw.match(/^(?:move|put|add)\s+(.+?)\s+(?:into|in|to)\s+(?:the\s+)?(.+?)(?:\s+group)?$/i);
  if (m?.[1] && m[2] && !/\b(?:window|position|left|right|end|start|beginning|first|last|next|beside|before|after)\b/i.test(m[2])) { const targets = targetClause(m[1]); if (targets) return [...targets, { action: 'group_action', params: { operation: 'add', name: m[2] } }]; }
  m = raw.match(/^(collapse|expand)\s+(?:the\s+)?(.+?)(?:\s+group)?$/i);
  if (m?.[1] && m[2]) return [{ action: 'group_action', params: { operation: m[1].toLowerCase() as 'collapse' | 'expand', name: m[2] } }];
  m = raw.match(/^rename\s+(?:the\s+)?(.+?)(?:\s+group)?\s+to\s+(.+)$/i);
  if (m?.[1] && m[2]) return [{ action: 'group_action', params: { operation: 'rename', name: m[1], new_name: m[2] } }];
  m = raw.match(/^move\s+(?:the\s+)?(.+?)\s+group\s+to (?:a new|a|another) window$/i);
  if (m?.[1]) return [{ action: 'group_action', params: { operation: 'move_window', name: m[1] } }];
  // Pronouns and coordinated targets share existing mutations.
  m = raw.match(/^(close|mute|unmute|pin|unpin|reload|refresh|duplicate)\s+(.+)$/i);
  if (m?.[1] && m[2] && (referenceSelector(m[2]) || /\s+and\s+|,/i.test(m[2]))) {
    const targets = targetClause(m[2]);
    if (targets) {
      const verb = m[1].toLowerCase();
      const action: ChromeAction = verb === 'close' ? { action: 'close_tab', params: { target: 'current' } } : verb === 'mute' || verb === 'unmute' ? { action: 'mute_tab', params: { mute: verb === 'mute' } } : verb === 'pin' || verb === 'unpin' ? { action: 'pin_tab', params: { pin: verb === 'pin' } } : verb === 'duplicate' ? { action: 'duplicate_tab', params: {} } : { action: 'reload_tab', params: { bypass_cache: false } };
      return [...targets, action];
    }
  }
  m = raw.match(/^(?:open|launch|bring up)\s+(?:(another|a new)\s+)?(.+?)(?:\s+in (?:a )?new tab)?$/i);
  if (m?.[2]) {
    const name = m[2].replace(/^(?:my|the)\s+/i, '').replace(/\s+(?:website|tab)$/i, '');
    if (!/^(?:(?:a )?new (?:tab|window)|window$|tab\b|bookmark\b|[a-z][a-z0-9+.-]*:|https?:\/\/|(?:[\w-]+\.)+[a-z]{2,}(?:\/|$))/i.test(name)) {
      return splitNames(name).map(site => ({ action: 'open_site', params: { site, new_tab: !!m[1] || /in (?:a )?new tab$/i.test(raw) } }));
    }
  }
  return null;
}
