/** Normalize command framing and verbs, never arbitrary words inside a title or query. */
export function stripLeadingRequestFraming(input: string): string {
  let text = input.trim();
  for (let i = 0; i < 5; i++) {
    const next = text.replace(/^(?:hey handsfree|handsfree|okay|ok|alright|hey)[,:]?\s+/i, '')
      .replace(/^(?:please|would you mind|do you mind|can you|could you|would you|will you|can we|let['’]s|go ahead and|i (?:want|need)(?: you)? to|i(?:['’]d| would) like(?: you)? to)\s+/i, '');
    if (next === text) break; text = next;
  }
  return text.trim();
}
export function stripRequestFraming(input: string): string {
  let text = stripLeadingRequestFraming(input);
  // Literal/query tails belong to the payload. Quoting also protects a title's suffix.
  if (!/^(?:type|write|enter text|fill|filling|replace|replacing|search|google|look up)\b/i.test(text)) text = text.replace(/[.!?]+$/, '').replace(/(?:,?\s+(?:please|for me|thanks|thank you))+$/i, '');
  return text.trim();
}
export function isNegatedCommand(input: string): boolean {
  if (/^stop typing[.!?]*$/i.test(stripRequestFraming(input))) return false;
  return /^(?:don['’]t|do not|never|not|avoid|stop (?:opening|closing|muting|pinning|moving|clicking|typing)|please don't)\b/i.test(stripRequestFraming(input));
}
const gerunds: Record<string, string> = { filling: 'fill', replacing: 'replace', opening: 'open', closing: 'close', muting: 'mute', unmuting: 'unmute', pinning: 'pin', unpinning: 'unpin', moving: 'move', switching: 'switch', scrolling: 'scroll', refreshing: 'refresh', reloading: 'reload', finding: 'find', showing: 'show', pausing: 'pause', playing: 'play', saving: 'save', grouping: 'group', searching: 'search', duplicating: 'duplicate' };
export function canonicalCommand(input: string): string {
  let text = stripRequestFraming(input);
  text = text.replace(/^([a-z]+)\b/i, word => gerunds[word.toLowerCase()] ?? word);
  const fixed: [RegExp, string][] = [
    [/^(?:make (?:this|the) (?:page|text) (?:bigger|larger)|increase (?:the )?(?:text size|page zoom)|enlarge (?:this|the) page)$/i, 'zoom in'],
    [/^(?:make (?:this|the) (?:page|text) smaller|decrease (?:the )?(?:text size|page zoom)|shrink (?:this|the) page)$/i, 'zoom out'],
    [/^(?:actual size|normal size|reset (?:the )?(?:page size|text size)|put (?:the )?zoom back to normal)$/i, 'reset zoom'],
    [/^(?:go back (?:a|one) page|back (?:a|one) page|previous page)$/i, 'go back'],
    [/^(?:go forward (?:a|one) page|forward (?:a|one) page|next page)$/i, 'go forward'],
    [/^(?:bring back (?:the )?tab i (?:just )?closed|reopen (?:the )?tab i (?:just )?closed|undo that close)$/i, 'reopen last closed tab'],
    [/^(?:start typing|begin typing|dictation (?:on|mode)|turn on dictation)$/i, 'start dictation'],
    [/^(?:stop typing|finish typing|dictation off|turn off dictation|back to commands|command mode)$/i, 'stop dictation'],
    [/^(?:what(?:['’]s| is) playing|where is (?:that|the) (?:noise|sound|music) coming from|which tabs? (?:are|is) playing sound)$/i, 'which tab is making noise'],
    [/^(?:show (?:me )?what i can (?:say|do)|what commands (?:are available|do you support)|help me with commands)$/i, 'what can i say here'],
    [/^(?:label (?:the )?page|show (?:me )?(?:the )?(?:link numbers|click targets)|number (?:the )?links on (?:this|the) page)$/i, 'show links'],
    [/^(?:remove (?:the )?(?:link numbers|labels)|hide (?:the )?link numbers)$/i, 'hide links'],
    [/^(?:find (?:the )?next (?:one|occurrence)|next (?:search )?result|next occurrence)$/i, 'next match'],
    [/^(?:find (?:the )?previous (?:one|occurrence)|previous occurrence|previous search result)$/i, 'previous match'],
    [/^(?:pause|pause it|stop (?:the )?(?:video|music|playback))$/i, 'pause the video'],
    [/^(?:play|resume|resume it|continue playing|keep playing)$/i, 'resume the video'],
    [/^(?:show (?:me )?(?:my )?saved workspaces|list (?:my )?saved sessions)$/i, 'show workspaces'],
    [/^(?:show (?:me )?(?:my )?(?:saved articles|read later list))$/i, 'show my reading list'],
    [/^(?:remove (?:the )?extra tabs|clean up (?:the )?duplicate tabs|deduplicate (?:my )?tabs)$/i, 'close duplicate tabs'],
  ];
  for (const [pattern, replacement] of fixed) if (pattern.test(text)) return replacement;
  text = text.replace(/^(close|mute|unmute|pin|unpin|reload|refresh|duplicate)\s+every (?:single )?tab$/i, '$1 all tabs');
  text = text.replace(/^(close|mute|unmute|pin|unpin|reload|refresh|show|list)\s+(?:all )?tabs that are (pinned|unpinned|muted|unmuted|audible)(.*)$/i, '$1 all $2 tabs$3');
  const prefixes: [RegExp, string][] = [
    [/^(?:get rid of|close out(?: of)?|close down|shut down|shut|dismiss)\s+/i, 'close '],
    [/^(?:pull up|load up|head (?:over )?to|navigate (?:over )?to|visit|take me over to|bring me to)\s+/i, 'open '],
    [/^(?:switch over to|jump over to|focus on|activate)\s+/i, 'switch to '],
    [/^(?:make a copy of|open a copy of|clone)\s+/i, 'duplicate '],
    [/^(?:quiet down|silence|shush)\s+/i, 'mute '],
    [/^(?:shift|slide)\s+/i, 'move '],
    [/^(?:look for|look up|search the web for|do a search for|run a search for|find information about)\s+/i, 'search for '],
    [/^(?:tap|hit)\s+/i, 'click '],
    [/^(?:stash|remember) (?:this|the) (?:page|article) for later$/i, 'save this for later'],
    [/^(?:remember|save) (?:these tabs|this window) (?:under the name|with the name)\s+/i, 'save this workspace as '],
    [/^(?:bookmark|favorite) (?:this|the) (?:site|website)$/i, 'bookmark this page'],
  ];
  for (const [pattern, replacement] of prefixes) { if (pattern.test(text)) { text = text.replace(pattern, replacement); break; } }
  let match = text.match(/^(?:turn|switch) (?:the )?(?:sound|audio) (off|on|back on) (?:in|on|for)\s+(.+)$/i);
  if (match?.[1] && match[2]) return `${match[1].toLowerCase() === 'off' ? 'mute' : 'unmute'} ${match[2]}`;
  match = text.match(/^(?:turn|switch) (?:the )?(?:sound|audio) (?:in|on|for)\s+(.+?)\s+(off|on|back on)$/i);
  if (match?.[1] && match[2]) return `${match[2].toLowerCase() === 'off' ? 'mute' : 'unmute'} ${match[1]}`;
  match = text.match(/^make\s+(.+?)\s+(silent|quiet)$/i); if (match?.[1]) return `mute ${match[1]}`;
  match = text.match(/^let me hear\s+(.+)$/i); if (match?.[1]) return `unmute ${match[1]}`;
  match = text.match(/^(?:bring|put)\s+(.+?)\s+(?:to the front|in front)$/i); if (match?.[1]) return `switch to ${match[1]}`;
  match = text.match(/^keep\s+(.+?)\s+pinned$/i); if (match?.[1]) return `pin ${match[1]}`;
  match = text.match(/^remove\s+(.+?)\s+from (?:the )?pinned tabs$/i); if (match?.[1]) return `unpin ${match[1]}`;
  match = text.match(/^(?:reload|refresh)\s+(.+?)\s+(?:without (?:the )?cache|from scratch)$/i); if (match?.[1]) return `hard reload ${match[1]}`;
  match = text.match(/^(?:scroll|go|move)\s+(?:all the way )?to (?:the )?(top|bottom)(?: of (?:this|the) page)?$/i); if (match?.[1]) return `scroll to ${match[1]}`;
  match = text.match(/^scroll\s+(?:a little|a bit)\s+(up|down|left|right)$/i); if (match?.[1]) return `scroll ${match[1]} a little`;
  match = text.match(/^(?:scroll|go)\s+(up|down)\s+(?:slightly|a little bit)$/i); if (match?.[1]) return `scroll ${match[1]} a little`;
  match = text.match(/^(?:give|set) (?:this|the) (?:site|website) (?:the )?(?:nickname|name)\s+(.+)$/i); if (match?.[1]) return `call this site ${match[1]}`;
  return text;
}

/** Finite spoken quantities; do not rewrite number-like words in arbitrary titles. */
export function spokenQuantity(input: string): number | undefined {
  const raw = input.toLowerCase().trim().replace(/-/g, ' ').replace(/\band\b/g, ' ').replace(/\s+/g, ' ');
  if (/^\d+(?:\.\d+)?(?:st|nd|rd|th)?$/.test(raw)) return Number.parseFloat(raw);
  const small: Record<string, number> = { zero: 0, one: 1, first: 1, two: 2, second: 2, three: 3, third: 3, four: 4, fourth: 4, five: 5, fifth: 5, six: 6, sixth: 6, seven: 7, seventh: 7, eight: 8, eighth: 8, nine: 9, ninth: 9, ten: 10, tenth: 10, eleven: 11, eleventh: 11, twelve: 12, twelfth: 12, thirteen: 13, thirteenth: 13, fourteen: 14, fourteenth: 14, fifteen: 15, fifteenth: 15, sixteen: 16, sixteenth: 16, seventeen: 17, seventeenth: 17, eighteen: 18, eighteenth: 18, nineteen: 19, nineteenth: 19, twenty: 20, twentieth: 20, thirty: 30, thirtieth: 30, forty: 40, fortieth: 40, fifty: 50, fiftieth: 50, sixty: 60, sixtieth: 60, seventy: 70, seventieth: 70, eighty: 80, eightieth: 80, ninety: 90, ninetieth: 90 };
  if (raw in small) return small[raw];
  if (raw === 'half') return 0.5;
  const words = raw.split(' ');
  const belowHundred = (parts: string[]): number | undefined => {
    if (parts.length === 1) return small[parts[0]!];
    const tens = small[parts[0]!]; const units = small[parts[1]!];
    return parts.length === 2 && tens !== undefined && tens >= 20 && tens % 10 === 0 && units !== undefined && units > 0 && units < 10 ? tens + units : undefined;
  };
  const hundred = words.indexOf('hundred');
  if (hundred >= 0) {
    const multiplier = hundred === 0 || words[0] === 'a' ? 1 : hundred === 1 ? small[words[0]!] : undefined;
    const remainder = words.slice(hundred + 1); const rest = remainder.length ? belowHundred(remainder) : 0;
    return multiplier !== undefined && multiplier >= 1 && multiplier <= 9 && rest !== undefined ? multiplier * 100 + rest : undefined;
  }
  if (/^(?:one |a )?thousand$/.test(raw)) return 1000;
  return belowHundred(words);
}

export function reviewIntent(input: string): boolean | undefined {
  const text = stripRequestFraming(input);
  if (/^(?:yes|yes please|yep|yeah|confirm|confirm (?:it|that|command)|go ahead|go ahead and (?:do|run) it|run it|do it|proceed|approve|approved|okay do it)$/i.test(text)) return true;
  if (/^(?:no|nope|no thanks|cancel|cancel (?:it|that|command)|dismiss|dismiss (?:it|that)|do not run it)$/i.test(text)) return false;
  return undefined;
}
export function dictationControl(input: string): 'stop dictation' | 'stop listening' | null {
  const text = stripRequestFraming(input);
  if (/^(?:(?:stop|end|finish) dictation|stop typing|finish typing|dictation off|turn off dictation|back to commands|command mode)$/i.test(text)) return 'stop dictation';
  if (/^(?:stop listening|microphone off|turn off (?:the )?(?:mic|microphone))$/i.test(text)) return 'stop listening';
  return null;
}
