import { COMMAND_EXAMPLES } from '../src/common/constants';
import { expect, it } from 'vitest';
import { parseCommand } from '../src/common/command-parser';
import { canonicalCommand, dictationControl, isNegatedCommand, reviewIntent, spokenQuantity } from '../src/common/language';
import { interruptIntent } from '../src/common/expanded-parser';
import { actionsSchema } from '../src/common/schema';
import { findMacro } from '../src/common/macros';
import { validateGrounding } from '../src/offscreen/grounding';

const variations: [string, string[]][] = [
  ['close the YouTube tab', ['Get rid of the YouTube tab', 'Close out of the YouTube tab', 'Shut down the YouTube tab', 'Dismiss the YouTube tab', 'Would you mind closing the YouTube tab?', 'I want you to close the YouTube tab', 'Okay, could you please close the YouTube tab for me?']],
  ['open Gmail', ['Pull up Gmail', 'Load up Gmail', 'Head over to Gmail', 'Visit Gmail', "I'd like you to open Gmail", 'I would like to open Gmail', 'Can we open Gmail', "Let's open Gmail", 'Go ahead and open Gmail', 'HandsFree, please open Gmail']],
  ['mute YouTube', ['Silence YouTube', 'Quiet down YouTube', 'Shush YouTube', 'Make YouTube silent', 'Turn the sound off on YouTube', 'Turn the sound on YouTube off', 'Switch the audio off for YouTube']],
  ['unmute YouTube', ['Turn the audio back on for YouTube', 'Turn the sound in YouTube on', 'Let me hear YouTube']],
  ['switch to the GitHub tab', ['Switch over to the GitHub tab', 'Jump over to the GitHub tab', 'Focus on the GitHub tab', 'Bring the GitHub tab to the front', 'Activate the GitHub tab']],
  ['duplicate this tab', ['Make a copy of this tab', 'Open a copy of this tab', 'Clone this tab']],
  ['hard reload this tab', ['Refresh this tab without the cache', 'Reload this tab from scratch']],
  ['pin the Gmail tab', ['Keep the Gmail tab pinned', 'Would you mind pinning the Gmail tab?']],
  ['unpin the Gmail tab', ['Remove the Gmail tab from the pinned tabs']],
  ['zoom in', ['Make this page bigger', 'Make the text larger', 'Increase the text size', 'Enlarge this page']],
  ['zoom out', ['Make this page smaller', 'Decrease the page zoom', 'Shrink this page']],
  ['reset zoom', ['Actual size', 'Normal size', 'Put the zoom back to normal']],
  ['go back', ['Go back one page', 'Back a page', 'Previous page']],
  ['go forward', ['Go forward one page', 'Next page']],
  ['reopen last closed tab', ['Bring back the tab I just closed', 'Reopen the tab I closed', 'Undo that close']],
  ['show links', ['Show me the click targets', 'Show link numbers', 'Number the links on this page', 'Label the page']],
  ['hide links', ['Remove the link numbers', 'Hide the link numbers']],
  ['next match', ['Find the next occurrence', 'Next occurrence', 'Next search result']],
  ['previous match', ['Find the previous one', 'Previous occurrence']],
  ['pause the video', ['Pause', 'Pause it', 'Stop the video', 'Stop playback']],
  ['resume the video', ['Play', 'Resume', 'Keep playing', 'Continue playing']],
  ['start dictation', ['Start typing', 'Begin typing', 'Dictation mode', 'Turn on dictation']],
  ['stop dictation', ['Stop typing', 'Finish typing', 'Dictation off', 'Back to commands', 'Command mode']],
  ['which tab is making noise', ["What's playing?", 'Where is that noise coming from?', 'Where is the music coming from?']],
  ['what can i say here', ['What commands are available?', 'Help me with commands', 'Show me what I can do']],
  ['scroll down a little', ['Scroll a little down', 'Scroll down slightly', 'Go down a little bit']],
  ['scroll to the bottom', ['Scroll all the way to the bottom', 'Go to the bottom of this page']],
];
for (const [canonical, phrases] of variations) it.each(phrases)('interprets “%s” as “' + canonical + '”', phrase => {
  const expected = parseCommand(canonical); expect(expected, canonical).not.toBeNull(); expect(parseCommand(phrase)).toEqual(expected);
});
it.each([
  ['Pause YouTube', 'page_action', { operation: 'media_pause' }],
  ['On the YouTube tab, pause the video', 'page_action', { operation: 'media_pause' }],
  ['Rewind two minutes', 'page_action', { operation: 'media_seek', value: -120, relative: true }],
  ['Fast forward one minute and thirty seconds', 'page_action', { operation: 'media_seek', value: 90, relative: true }],
  ['Jump to 1:30', 'page_action', { operation: 'media_seek', value: 90, relative: false }],
  ['Seek to two minutes fifteen seconds', 'page_action', { operation: 'media_seek', value: 135, relative: false }],
  ['Restart this video', 'page_action', { operation: 'media_seek', value: 0, relative: false }],
  ['Set volume to twenty five percent', 'page_action', { operation: 'media_volume', value: 25, relative: false }],
  ['Turn volume down by fifteen percent', 'page_action', { operation: 'media_volume', value: -15, relative: true }],
  ['Increase the volume by twenty percent', 'page_action', { operation: 'media_volume', value: 20, relative: true }],
  ['Zoom to one hundred and twenty five percent', 'zoom', { mode: 'set', factor: 1.25 }],
  ['Switch to tab twenty one', 'select_tab', { position: 'index', index: 21, activate: true }],
  ['Go forward three tabs', 'select_tab', { position: 'next', offset: 3, activate: true }],
  ['Go back two tabs', 'select_tab', { position: 'previous', offset: 2, activate: true }],
  ['Move this tab three places to the left', 'move_tab', { position: 'left', steps: 3 }],
  ['Open link twenty one', 'page_action', { operation: 'activate', index: 21 }],
  ['Save this session as Research', 'workspace_action', { operation: 'save', name: 'Research' }],
  ['Load my Research workspace', 'workspace_action', { operation: 'restore', name: 'Research' }],
  ['Put Gmail and GitHub in a group called Work', 'group_action', { operation: 'create', name: 'Work' }],
  ['Add this page to my favorites', 'bookmark_page', {}],
  ['Open my Recipes bookmark', 'open_bookmark', { query: 'Recipes' }],
  ['Add this article to my reading list', 'reading_action', { operation: 'save' }],
  ['Go to Gmail', 'open_site', { site: 'Gmail' }],
  ['Open example dot com', 'create_tab', { url: 'https://example.com' }],
])('executes the extended phrase “%s”', (text, action, params) => expect(parseCommand(text as string)?.at(-1)).toEqual({ action, params }));
it('targets the named media tab and respects positions counted from the right', () => {
  expect(parseCommand('pause YouTube')?.[0]).toEqual({ action: 'find_tab', params: { query: 'YouTube', auto_switch: false } });
  expect(parseCommand('close the second tab from the right')).toEqual([{ action: 'select_tab', params: { position: 'index', index: 2, from_end: true, activate: false } }, { action: 'close_tab', params: { target: 'current' } }]);
});
it('targets filtered sets, explicit tab ranges, and exclusions', () => {
  expect(parseCommand('mute all pinned tabs')).toEqual([{ action: 'tab_set', params: { operation: 'target', filter: 'pinned', scope: 'window' } }, { action: 'mute_tab', params: { mute: true } }]);
  expect(parseCommand('unmute all muted tabs across all windows')?.[0]).toMatchObject({ action: 'tab_set', params: { filter: 'muted', scope: 'all' } });
  expect(parseCommand('close tabs two through five')?.[0]).toMatchObject({ action: 'tab_set', params: { indices: [2, 3, 4, 5] } });
  expect(parseCommand('pin tabs two, four, and six')?.[0]).toMatchObject({ action: 'tab_set', params: { indices: [2, 4, 6] } });
  expect(parseCommand('close all tabs except GitHub')?.[0]).toMatchObject({ action: 'tab_set', params: { exclude_query: 'GitHub' } });
  expect(parseCommand('mute all YouTube tabs')?.[0]).toMatchObject({ action: 'select_tabs', params: { queries: ['YouTube'], all_matches: true } });
});
it('supports alternate search wording without changing queries or splitting embedded commands', () => {
  expect(parseCommand('Search Amazon headphones')).toEqual([{ action: 'search_site', params: { site: 'Amazon', query: 'headphones' } }]);
  expect(parseCommand('Wikipedia search for black holes')).toEqual([{ action: 'search_site', params: { site: 'wikipedia', query: 'black holes' } }]);
  expect(parseCommand('Look up sourdough on Reddit')).toEqual([{ action: 'search_site', params: { site: 'Reddit', query: 'sourdough' } }]);
  expect(parseCommand('Look for pricing on this page')).toEqual([{ action: 'page_action', params: { operation: 'find', query: 'pricing' } }]);
  expect(parseCommand('search for pull up Gmail then close YouTube')).toEqual([{ action: 'search_site', params: { site: 'search', query: 'pull up Gmail then close YouTube' } }]);
});
it('preserves literal typing, punctuation, quoted titles, and conjunctive names', () => {
  expect(parseCommand('Type please close Gmail and open YouTube!')).toEqual([{ action: 'page_action', params: { operation: 'type', text: 'please close Gmail and open YouTube!' } }]);
  expect(parseCommand('write I’m here, please.')).toEqual([{ action: 'page_action', params: { operation: 'type', text: 'I’m here, please.' } }]);
  expect(parseCommand('type "hello" then open Gmail')?.map(action => action.action)).toEqual(['page_action', 'open_site']);
  expect(parseCommand('get rid of the "Never Mind" tab')?.[0]).toMatchObject({ params: { query: 'Never Mind' } });
  expect(parseCommand('mute Gmail, YouTube, and Spotify')?.[0]).toMatchObject({ params: { queries: ['Gmail', 'YouTube', 'Spotify'] } });
});
it.each(["Don't close Gmail", 'Do not mute this tab', 'Could you not pin Gmail?', 'Would you mind not closing YouTube?', 'Avoid closing all tabs', 'Never open example.com'])('does not run a negated request: %s', text => {
  expect(isNegatedCommand(text)).toBe(true); expect(parseCommand(text)).toBeNull(); expect(() => validateGrounding([{ action: 'close_tab', params: { target: 'current' } }], text)).toThrow('not to act');
});
it('bounds spoken quantities and rejects incoherent or out-of-range action arguments', () => {
  expect(spokenQuantity('twenty-first')).toBe(21); expect(spokenQuantity('one hundred and twenty five')).toBe(125); expect(spokenQuantity('twenty eleven')).toBeUndefined();
  expect(actionsSchema.safeParse([{ action: 'select_tab', params: { position: 'first', offset: 3 } }]).success).toBe(false);
  expect(actionsSchema.safeParse([{ action: 'tab_set', params: { operation: 'target', filter: 'all', scope: 'all', indices: [2] } }]).success).toBe(false);
  expect(canonicalCommand('search for twenty one pilots')).toBe('search for twenty one pilots');
});
it('understands conversational review, cancellation, dictation exits, and macro framing', () => {
  for (const text of ['Yes please', 'Go ahead', 'Run it', 'Confirm that']) expect(reviewIntent(text)).toBe(true);
  expect(reviewIntent('No thanks')).toBe(false); expect(reviewIntent('go ahead and close Gmail')).toBeUndefined();
  for (const text of ['Hold on', 'Scratch that', 'Wait', 'Cancel the command']) expect(interruptIntent(text)).toMatchObject({ stopListening: false });
  expect(interruptIntent('Turn off the microphone')).toEqual({ stopListening: true });
  expect(dictationControl('back to commands')).toBe('stop dictation'); expect(dictationControl('stop')).toBeNull();
  const macro = { id: crypto.randomUUID(), name: 'Morning', phrase: 'open my morning sites', urls: ['https://example.com/'] };
  expect(findMacro([macro], 'I would like you to open my morning sites please')).toEqual(macro);
});

it('parses every advertised alternate wording in the command guide', () => {
  for (const example of COMMAND_EXAMPLES) for (const phrase of example.variations ?? []) expect(parseCommand(phrase), phrase).not.toBeNull();
});
