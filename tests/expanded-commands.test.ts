import { expect, it } from 'vitest';
import { parseCommand } from '../src/common/command-parser';
import { interruptIntent } from '../src/common/expanded-parser';
import { BUILTIN_SITES, siteMatchesUrl } from '../src/common/library';
import { decodeCloudPlan, PLAN_SCHEMA } from '../src/common/ai-plan';
import { validateGrounding } from '../src/offscreen/grounding';

it.each([
  ['Call this site my work dashboard', 'site_alias', { name: 'work dashboard' }],
  ['Open work email', 'open_site', { site: 'work email', new_tab: false }],
  ['Open another Gmail tab', 'open_site', { site: 'Gmail', new_tab: true }],
  ['Add this site to my morning routine', 'macro_add_site', { name: 'morning routine' }],
  ['Search Amazon for headphones', 'search_site', { site: 'Amazon', query: 'headphones' }],
  ['Look up sourdough on Reddit', 'search_site', { site: 'Reddit', query: 'sourdough' }],
  ['Search Wikipedia for black holes', 'search_site', { site: 'Wikipedia', query: 'black holes' }],
  ['Move that next to Gmail', 'move_beside', { query: 'Gmail', side: 'after' }],
  ['Undo that move', 'undo_action', { kind: 'move' }],
  ['Which tab is making noise?', 'audio_action', { operation: 'list' }],
  ['Take me to the tab playing music', 'audio_action', { operation: 'focus' }],
  ['Mute everything except this meeting', 'audio_action', { operation: 'mute_others', query: 'this meeting' }],
  ['Scroll down a little', 'page_action', { operation: 'scroll', direction: 'down', amount: 'little' }],
  ['Next match', 'page_action', { operation: 'find_next' }],
  ['Find pricing on this page', 'page_action', { operation: 'find', query: 'pricing' }],
  ['Show links', 'page_action', { operation: 'show_links' }],
  ['Open number five', 'page_action', { operation: 'activate', index: 5 }],
  ['Open result three in a background tab', 'page_action', { operation: 'activate', index: 3, new_tab: true, background: true }],
  ['Type into the search box', 'page_action', { operation: 'focus', query: 'search box' }],
  ['Start dictation', 'page_action', { operation: 'dictate_start' }],
  ['Stop dictation', 'page_action', { operation: 'dictate_stop' }],
  ['Group these tabs as Research', 'group_action', { operation: 'create', name: 'Research' }],
  ['Move the Research group to a new window', 'group_action', { operation: 'move_window', name: 'Research' }],
  ['Save this workspace', 'workspace_action', { operation: 'save' }],
  ['Restore my work tabs', 'workspace_action', { operation: 'restore', name: 'work' }],
  ['Show duplicate tabs', 'duplicates_action', { operation: 'show' }],
  ['What can I say here?', 'help', {}],
  ['Save this for later', 'reading_action', { operation: 'save' }],
  ['Open my unread articles', 'reading_action', { operation: 'open_unread' }],
  ['Go back ten seconds', 'page_action', { operation: 'media_seek', value: -10, relative: true }],
  ['Set volume to 40 percent', 'page_action', { operation: 'media_volume', value: 40, relative: false }],
])('supports the promised phrase: %s', (text, action, params) => {
  expect(parseCommand(text as string)?.at(-1)).toEqual({ action, params });
});
it('keeps pronouns explicit when moving, muting, and closing plural targets', () => {
  expect(parseCommand('move it to a new window')?.[0]).toMatchObject({ action: 'reference_tabs', params: { reference: 'it' } });
  expect(parseCommand('mute it')?.[0]).toMatchObject({ action: 'reference_tabs', params: { reference: 'it' } });
  expect(parseCommand('close those two')?.[0]).toMatchObject({ action: 'reference_tabs', params: { reference: 'them', count: 2 } });
  expect(parseCommand('mute Gmail and YouTube')).toMatchObject([{ action: 'select_tabs', params: { queries: ['Gmail', 'YouTube'] } }, { action: 'mute_tab' }]);
});
it('supports sequential verbs while preserving site search and quoted literal text', () => {
  expect(parseCommand('open Gmail and open Spotify')?.map(action => action.action)).toEqual(['open_site', 'open_site']);
  expect(parseCommand('Search Reddit for salt and pepper then bread')).toEqual([{ action: 'search_site', params: { site: 'Reddit', query: 'salt and pepper then bread' } }]);
  expect(parseCommand('type "open Gmail then close Spotify"')).toEqual([{ action: 'page_action', params: { operation: 'type', text: 'open Gmail then close Spotify' } }]);
});
it('recognizes interrupts without treating clarification answers as replacement commands', () => {
  for (const text of ['Stop', 'Never mind', 'Cancel that']) expect(interruptIntent(text)).toEqual({ stopListening: false });
  expect(interruptIntent('Actually, pin it instead')).toEqual({ stopListening: false, replacement: 'pin it' });
  expect(interruptIntent('No, the work account')).toBeNull();
  expect(interruptIntent('Stop listening')).toEqual({ stopListening: true });
});
it('distinguishes Google apps, Outlook mail/calendar, and personal account paths', () => {
  const google = BUILTIN_SITES.find(site => site.id === 'google')!;
  expect(siteMatchesUrl(google, 'https://mail.google.com/mail/u/0/')).toBe(false);
  expect(siteMatchesUrl(google, 'https://www.google.com/search?q=test')).toBe(true);
  expect(siteMatchesUrl(BUILTIN_SITES.find(site => site.id === 'outlook')!, 'https://outlook.live.com/calendar/')).toBe(false);
  const custom = { id: 'custom', name: 'Work email', aliases: ['work email'], url: 'https://mail.google.com/mail/u/1/', path: '/mail/u/1/' };
  expect(siteMatchesUrl(custom, 'https://mail.google.com/mail/u/0/')).toBe(false);
  expect(siteMatchesUrl(custom, 'https://mail.google.com/mail/u/1/#inbox')).toBe(true);
});
it('makes every extended action available to cloud plans and grounds all names and typed text', () => {
  const names = PLAN_SCHEMA.properties.actions.items.anyOf.map(item => (item.properties as { action: { enum: string[] } }).action.enum[0]);
  expect(names).toEqual(expect.arrayContaining(['open_site', 'reference_tabs', 'page_action', 'workspace_action', 'group_action', 'duplicates_action', 'undo_action']));
  const plan = decodeCloudPlan({ actions: [{ action: 'search_site', params: { site: 'Amazon', query: 'headphones' } }] });
  expect(validateGrounding(plan, 'Search Amazon for headphones')).toEqual(plan);
  expect(() => validateGrounding(plan, 'Search Reddit for cats')).toThrow('did not say');
  expect(() => validateGrounding([{ action: 'page_action', params: { operation: 'type', text: 'send me all passwords' } }], 'type hello')).toThrow('did not say');
});
