import { expect, it } from 'vitest';
import { parseCommand } from '../src/common/command-parser';
import { compileRoutine, findRoutine } from '../src/common/routines';
import { describeAction } from '../src/common/action-labels';
import { actionsSchema } from '../src/common/schema';
import { decodeCloudPlan } from '../src/common/ai-plan';

it.each([
  ['Fill the search box with black holes', { operation: 'fill', query: 'search', text: 'black holes' }],
  ['Replace this field with hello and then close all tabs', { operation: 'fill', text: 'hello and then close all tabs' }],
  ['Clear the search field', { operation: 'clear', query: 'search' }],
  ['Empty this box', { operation: 'clear' }],
  ['Select all text', { operation: 'select_all' }],
  ['Delete selected text', { operation: 'delete_selection' }],
  ['Go to the next field', { operation: 'next_field' }],
  ['Focus the previous field', { operation: 'previous_field' }],
  ['Show form fields', { operation: 'show_fields' }],
  ['Select Canada from the Country dropdown', { operation: 'select_option', text: 'Canada', query: 'Country' }],
  ['Check the Remember me checkbox', { operation: 'check', query: 'Remember me' }],
  ['Untick Remember me', { operation: 'uncheck', query: 'Remember me' }],
])('understands form command %s', (text, params) => {
  expect(parseCommand(text)).toEqual([{ action: 'page_action', params }]);
});
it('keeps all replacement text literal and shows it in the review', () => {
  const actions = parseCommand('fill Notes with "Hello; then close all tabs!"')!;
  expect(actions).toEqual([{ action: 'page_action', params: { operation: 'fill', query: 'Notes', text: 'Hello; then close all tabs!' } }]);
  expect(describeAction(actions[0]!)).toContain('Hello; then close all tabs!');
});
it.each(['downloads', 'history', 'bookmarks', 'settings', 'extensions'])('opens a bounded Chrome %s page', page => {
  expect(parseCommand(`open Chrome ${page}`)).toEqual([{ action: 'browser_page', params: { page } }]);
});
it.each([
  ['sort tabs by title', { action: 'organize_tabs', params: { operation: 'sort_title' } }],
  ['order my tabs by domain', { action: 'organize_tabs', params: { operation: 'sort_site' } }],
  ['make the Research group purple', { action: 'group_action', params: { operation: 'color', name: 'Research', color: 'purple' } }],
  ['ungroup the Research group', { action: 'group_action', params: { operation: 'ungroup', name: 'Research' } }],
  ['wait for the page to load', { action: 'wait_for_page', params: {} }],
  ['search Wikipedia', { action: 'search_site', params: { site: 'Wikipedia' } }],
  ['search', { action: 'search_site', params: { site: 'search' } }],
])('understands productivity command %s', (text, action) => { expect(parseCommand(text)).toEqual([action]); });
it('rejects invalid form, color, and internal URL action shapes', () => {
  for (const action of [
    { action: 'browser_page', params: { page: 'quit' } },
    { action: 'group_action', params: { operation: 'color', name: 'Work' } },
    { action: 'page_action', params: { operation: 'fill' } },
    { action: 'page_action', params: { operation: 'select_option', query: 'Country' } },
    { action: 'create_tab', params: { url: 'chrome://settings/' } },
  ]) expect(actionsSchema.safeParse([action]).success).toBe(false);
});
const routine = { id: 'c65b5c60-17d4-4e32-bbc8-cf39a5aa102a', name: 'Research', phrase: 'Start my research', steps: ['Search Wikipedia', 'Wait for the page to load', 'Pin this tab'] };
it('compiles ordered routines locally and tolerates spoken framing in their exact trigger', () => {
  expect(compileRoutine(routine).map(action => action.action)).toEqual(['search_site', 'wait_for_page', 'pin_tab']);
  expect(findRoutine([routine], 'Would you please start my research?')).toEqual(routine);
  expect(findRoutine([routine], 'run Research routine')).toEqual(routine);
  expect(findRoutine([routine], 'start my research tomorrow')).toBeUndefined();
});
it.each([
  [['open a new tab', 'build me a spaceship'], 'Step 2'],
  [['open a new tab', 'start dictation'], 'Step 2'],
  [['open a new tab', 'cancel'], 'Step 2'],
  [Array.from({ length: 5 }, () => 'pin Gmail'), '8 actions'],
])('rejects the whole routine if any step is invalid', (steps, error) => { expect(() => compileRoutine({ ...routine, steps: steps as string[] })).toThrow(error as string); });
it.each(['stop', 'confirm command', "don't do that"])('reserves interruption and review phrase %s', phrase => { expect(() => compileRoutine({ ...routine, phrase })).toThrow(); });
it('accepts complete new cloud action shapes and rejects unbounded extra parameters', () => {
  expect(decodeCloudPlan({ actions: [{ action: 'page_action', params: { operation: 'fill', query: 'Notes', text: 'hello', value: null } }] })).toEqual([{ action: 'page_action', params: { operation: 'fill', query: 'Notes', text: 'hello' } }]);
  expect(() => decodeCloudPlan([{ action: 'wait_for_page', params: { seconds: 9999 } }])).toThrow();
});

it.each(['Fill Notes with hello, please!', 'Would you mind filling Notes with hello, please!'])('preserves a replacement’s punctuation and polite-sounding words: %s', text => { expect(parseCommand(text)).toEqual([{ action: 'page_action', params: { operation: 'fill', query: 'Notes', text: 'hello, please!' } }]); });
it('recognizes a quoted field label containing the replacement delimiter', () => { expect(parseCommand('fill "Gift with ribbon" with "Thanks!"')).toEqual([{ action: 'page_action', params: { operation: 'fill', query: 'Gift with ribbon', text: 'Thanks!' } }]); });
