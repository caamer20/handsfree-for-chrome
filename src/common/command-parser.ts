import { actionsSchema, type ChromeAction } from './schema';

export const searchUrl = (engine: string, query: string): string => {
  const q = encodeURIComponent(query.trim());
  if (engine.toLowerCase() === 'youtube') return `https://www.youtube.com/results?search_query=${q}`;
  if (engine.toLowerCase() === 'github') return `https://github.com/search?q=${q}`;
  return `https://www.google.com/search?q=${q}`;
};
export function stripTrigger(input: string, phrase: string): string {
  const raw = input.trim();
  if (!phrase) return raw;
  const prefix = phrase.trim().toLowerCase();
  if (raw.toLowerCase() === prefix) throw new Error('Say your trigger phrase followed by a command.');
  const next = raw.slice(prefix.length, prefix.length + 1);
  if (!raw.toLowerCase().startsWith(prefix) || !/[\s,:]/.test(next)) throw new Error(`Start your command with “${phrase}”.`);
  return raw.slice(prefix.length).replace(/^[\s,:]+/, '');
}
function single(action: ChromeAction): ChromeAction[] { return actionsSchema.parse([action]); }

/** Conservative exact grammar. Unrecognized language is never guessed into an action. */
export function parseCommand(input: string): ChromeAction[] | null {
  const raw = input.trim().replace(/[.!?]+$/, '').replace(/^(?:(?:please|can you|could you|would you)\s+)+/i, '').replace(/\s+please$/i, '');
  const c = raw.toLowerCase().replace(/\s+/g, ' ');
  if (!c || c.length > 500) return null;
  let m: RegExpMatchArray | null;

  // Resolve compound search BEFORE splitting commands; queries may contain “and”.
  m = raw.match(/^(?:open (?:a )?new tab[,\s]*(?:and\s+)?)?(?:open\s+)?(google|youtube|github)(?:\s+search)?\s+(?:and\s+)?(?:search\s+)?for\s+(.+)$/i)
    ?? raw.match(/^search\s+(google|youtube|github)\s+(?:for\s+)?(.+)$/i);
  if (m?.[1] && m[2]) return single({ action: 'create_tab', params: { url: searchUrl(m[1], m[2]) } });
  m = raw.match(/^search\s+for\s+(.+?)\s+on\s+(google|youtube|github)$/i);
  if (m?.[1] && m[2]) return single({ action: 'create_tab', params: { url: searchUrl(m[2], m[1]) } });
  m = raw.match(/^(?:search(?:\s+for)?|google)\s+(.+)$/i);
  if (m?.[1]) return single({ action: 'create_tab', params: { url: searchUrl('google', m[1]) } });

  if (/^(?:open|create)(?: a)? new tab$/.test(c) || c === 'new tab') return single({ action: 'create_tab', params: { url: 'chrome://newtab/' } });
  m = raw.match(/^(?:open|go to|navigate to)\s+(https?:\/\/\S+|(?:[\w-]+\.)+[a-z]{2,}(?:\/\S*)?)$/i);
  if (m?.[1]) return single({ action: 'create_tab', params: { url: /^https?:/i.test(m[1]) ? m[1] : `https://${m[1]}` } });
  m = raw.match(/^open (google|youtube|github)$/i);
  if (m?.[1]) return single({ action: 'create_tab', params: { url: `https://www.${m[1].toLowerCase()}.com/` } });
  m = raw.match(/^(?:switch to|find|focus|take me to)(?: the| a)? tab(?: containing| with| about| called| named)?\s+(.+)$/i);
  if (m?.[1]) return single({ action: 'find_tab', params: { query: m[1], auto_switch: true } });
  if (/^close (?:(?:this|the|current) )?tab$/.test(c)) return single({ action: 'close_tab', params: { target: 'current' } });
  if (/^close (?:all )?other tabs$/.test(c)) return single({ action: 'close_tab', params: { target: 'all_others' } });
  m = c.match(/^close (?:all )?tabs (?:to the |on the )?(left|right)$/);
  if (m?.[1]) return single({ action: 'close_tab', params: { target: m[1] as 'left' | 'right' } });
  if (/^duplicate (?:(?:this|the|current) )?tab$/.test(c)) return single({ action: 'duplicate_tab', params: {} });
  if (/^(?:(hard) )?(?:reload|refresh)(?: (?:(?:this|the|current) )?(?:tab|page))?$/.test(c)) return single({ action: 'reload_tab', params: { bypass_cache: c.startsWith('hard ') } });
  m = c.match(/^(mute|silence|quiet|unmute|toggle mute)(?: (?:(?:this|the|current) )?(?:tab|page))?$/);
  if (m?.[1]) return single({ action: 'mute_tab', params: m[1] === 'toggle mute' ? { toggle: true } : { mute: m[1] !== 'unmute' } });
  if (/^(?:make (?:(?:this|the|current) )?(?:tab|page) quiet|turn (?:the )?(?:sound|audio) off)$/.test(c)) return single({ action: 'mute_tab', params: { mute: true } });
  if (/^(?:let me hear (?:this|the) tab|turn (?:the )?(?:sound|audio) (?:back )?on)$/.test(c)) return single({ action: 'mute_tab', params: { mute: false } });
  m = c.match(/^(pin|unpin|toggle pin)(?: (?:(?:this|the|current) )?tab)?$/);
  if (m?.[1]) return single({ action: 'pin_tab', params: m[1] === 'toggle pin' ? { toggle: true } : { pin: m[1] === 'pin' } });
  m = c.match(/^(maximize|minimize|restore)(?: (?:(?:this|the|current) )?window)?$/);
  if (m?.[1]) return single({ action: 'window_state', params: { state: m[1] === 'maximize' ? 'maximized' : m[1] === 'minimize' ? 'minimized' : 'normal' } });
  if (/^(?:enter |go )?full ?screen$/.test(c)) return single({ action: 'window_state', params: { state: 'fullscreen' } });
  if (/^(?:exit|leave) full ?screen$/.test(c)) return single({ action: 'window_state', params: { state: 'normal' } });
  if (c === 'zoom in' || c === 'zoom out') return single({ action: 'zoom', params: { mode: c === 'zoom in' ? 'in' : 'out' } });
  if (c === 'reset zoom' || c === 'zoom reset') return single({ action: 'zoom', params: { mode: 'reset' } });
  m = c.match(/^(?:set )?zoom(?: to)? (\d+(?:\.\d+)?)\s*(?:percent|%)?$/);
  if (m?.[1]) return single({ action: 'zoom', params: { mode: 'set', factor: Number(m[1]) / 100 } });
  m = raw.match(/^(?:bookmark|save) (?:(?:this|the|current) )?(?:page|tab)(?: as (.+?))?(?: (?:in|to)(?: folder)? (.+))?$/i);
  if (m) return single({ action: 'bookmark_page', params: { ...(m[1] ? { title: m[1] } : {}), ...(m[2] ? { folder: m[2] } : {}) } });
  m = raw.match(/^open bookmark(?: number)? (\d+)$/i);
  if (m?.[1]) return single({ action: 'open_bookmark', params: { index: Number(m[1]) } });
  m = raw.match(/^open bookmark\s+(.+)$/i);
  if (m?.[1]) return single({ action: 'open_bookmark', params: { query: m[1] } });
  if (/^(?:go |navigate )?(back|forward)$/.test(c)) return single({ action: 'navigate_history', params: { direction: c.endsWith('back') ? 'back' : 'forward' } });

  const parts = raw.split(/\s+(?:and then|then)\s+|\s*;\s*/i);
  if (parts.length > 1 && parts.length <= 8) {
    const parsed = parts.map(parseCommand);
    if (parsed.every((part) => part !== null)) return actionsSchema.parse(parsed.flat());
  }
  return null;
}
