import { actionsSchema, type ChromeAction } from './schema';
import { spokenNumber, tabSelector } from './tab-target';

function onTab(target: string, action: ChromeAction): ChromeAction[] | null {
  const selector = tabSelector(target, false, true);
  return selector === null ? null : actionsSchema.parse([...selector, action]);
}
function choose(target: string): ChromeAction[] | null {
  const selector = tabSelector(target, true, true);
  return selector?.length ? selector : null;
}
export function parseTabCommand(raw: string): ChromeAction[] | null {
  const c = raw.toLowerCase();
  let m: RegExpMatchArray | null;
  if (/^(?:reopen|restore|bring back)(?: the| my)?(?: last| recently)? closed tab$/.test(c) || /^(?:reopen (?:the )?(?:last )?tab|undo (?:close|closed tab|closing (?:the |this )?tab))$/.test(c)) return [{ action: 'reopen_tab', params: {} }];
  if (/^(?:open|create)(?: a)? new window$/.test(c) || c === 'new window') return [{ action: 'create_window', params: {} }];
  if (/^(?:(?:go|switch|jump) to (?:the )?)?(?:next|previous|prior|first|last|left|right) tab$/.test(c) || /^tab(?: number)? .+$/.test(c) || (c.endsWith(' tab') && spokenNumber(c.replace(/ tab$/, '')) !== undefined)) return choose(raw.replace(/^(?:go|switch|jump) to (?:the )?/i, ''));
  m = raw.match(/^(?:switch to|go to|jump to|focus|select|show|find|take me to|bring up)\s+(.+)$/i);
  if (m?.[1] && !/^(?:https?:\/\/|(?:[\w-]+\.)+[a-z]{2,}(?:\/|$))/i.test(m[1])) return choose(m[1]);

  if (/^(?:close|shut)(?: down)? (?:all |the )?other tabs$/.test(c) || /^(?:close all tabs (?:except|but) (?:this|the current|this one)|keep only (?:this|the current) tab)$/.test(c)) return [{ action: 'close_tab', params: { target: 'all_others' } }];
  if (/^(?:close|shut)(?: down)? (?:all|every)(?: the)? tabs?(?: in (?:this|the current) window)?$/.test(c)) return [{ action: 'close_tab', params: { target: 'all' } }];
  m = c.match(/^(?:close|shut)(?: down)? (?:all )?(?:the )?tabs (?:to the |on the )?(left|right)$/);
  if (m?.[1]) return [{ action: 'close_tab', params: { target: m[1] as 'left' | 'right' } }];
  m = raw.match(/^close (?:all )?tabs (?:named|called|containing|matching|with|for)\s+(.+)$/i)
    ?? raw.match(/^close (?:all (?:the )?)?(.+?)\s+tabs$/i);
  if (m?.[1]) {
    const match = tabSelector(m[1], false, true)?.[0];
    if (match?.action === 'find_tab') return [{ action: 'close_tab', params: { target: 'matching', query: match.params.query } }];
    return null;
  }
  m = raw.match(/^(close|shut(?: down)?|dismiss|duplicate|copy|reload|refresh|hard reload|hard refresh|mute|silence|quiet|unmute|pin|unpin|toggle mute|toggle pin)\s+(.+)$/i);
  if (m?.[1] && m[2]) {
    const verb = m[1].toLowerCase(); const target = m[2];
    if (['close', 'shut', 'shut down', 'dismiss'].includes(verb)) return onTab(target, { action: 'close_tab', params: { target: 'current' } });
    if (verb === 'duplicate' || verb === 'copy') return onTab(target, { action: 'duplicate_tab', params: {} });
    if (/^(?:hard )?(?:reload|refresh)$/.test(verb)) return onTab(target, { action: 'reload_tab', params: { bypass_cache: verb.startsWith('hard ') } });
    if (['mute', 'silence', 'quiet', 'unmute', 'toggle mute'].includes(verb)) return onTab(target, { action: 'mute_tab', params: verb === 'toggle mute' ? { toggle: true } : { mute: verb !== 'unmute' } });
    if (['pin', 'unpin', 'toggle pin'].includes(verb)) return onTab(target, { action: 'pin_tab', params: verb === 'toggle pin' ? { toggle: true } : { pin: verb === 'pin' } });
  }
  m = raw.match(/^make\s+(.+?)\s+quiet$/i);
  if (m?.[1]) return onTab(m[1], { action: 'mute_tab', params: { mute: true } });
  m = raw.match(/^turn (?:the )?(?:sound|audio) (off|on|back on) (?:on|for)\s+(.+)$/i);
  if (m?.[1] && m[2]) return onTab(m[2], { action: 'mute_tab', params: { mute: m[1].toLowerCase() === 'off' } });
  m = raw.match(/^(?:move|send|detach)\s+(.+?)\s+(?:to|into)(?: a| its own)? new window$/i);
  if (m?.[1]) return onTab(m[1], { action: 'create_window', params: { with_current_tab: true } });
  m = raw.match(/^move\s+(.+?)\s+(?:(?:to|towards) )?(?:the )?(left|right|start|beginning|end|first position|last position)$/i);
  if (m?.[1] && m[2]) {
    const p = m[2].toLowerCase();
    return onTab(m[1], { action: 'move_tab', params: { position: /^(?:start|beginning|first)/.test(p) ? 'first' : /^(?:end|last)/.test(p) ? 'last' : p as 'left' | 'right' } });
  }
  m = raw.match(/^move\s+(.+?)\s+to (?:position|slot|tab number)\s+(\S+)$/i);
  if (m?.[1] && m[2]) {
    const index = spokenNumber(m[2]);
    if (index !== undefined) return onTab(m[1], { action: 'move_tab', params: { position: 'index', index } });
  }
  return null;
}
