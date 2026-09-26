import { expect, it } from 'vitest';
import { parseCommand } from '../src/common/command-parser';
import { actionsSchema } from '../src/common/schema';
import { compileRoutine } from '../src/common/routines';
import { describeAction } from '../src/common/action-labels';

it.each([
  ['Select text black holes', { operation: 'select_text', query: 'black holes' }],
  ['Highlight text hello, please!', { operation: 'select_text', query: 'hello, please!' }],
  ['Please select text "pin this tab then close all tabs"', { operation: 'select_text', query: 'pin this tab then close all tabs' }],
  ['Replace text black holes with neutron stars', { operation: 'replace_text', query: 'black holes', text: 'neutron stars' }],
  ['Replace text "tea with milk" with "coffee, please!"', { operation: 'replace_text', query: 'tea with milk', text: 'coffee, please!' }],
  ['Replace text hello with then close all tabs; thank you!', { operation: 'replace_text', query: 'hello', text: 'then close all tabs; thank you!' }],
  ['Replace text obsolete with ""', { operation: 'replace_text', query: 'obsolete', text: '' }],
  ['Move the cursor to the start', { operation: 'cursor_start' }],
  ['Put the caret at the beginning of this field', { operation: 'cursor_start' }],
  ['Place the cursor at the end of the text', { operation: 'cursor_end' }],
  ['Move the cursor before text black holes', { operation: 'cursor_before', query: 'black holes' }],
  ['Put the caret after "café 🐈"', { operation: 'cursor_after', query: 'café 🐈' }],
  ['Please place the cursor after text pin this tab then close all tabs', { operation: 'cursor_after', query: 'pin this tab then close all tabs' }],
  ['Move the cursor before text hello, please!', { operation: 'cursor_before', query: 'hello, please!' }],
])('parses focused text editing: %s', (text, params) => {
  expect(parseCommand(text)).toEqual([{ action: 'page_action', params }]);
});

it('keeps whole-field replacement wording distinct from phrase replacement', () => {
  expect(parseCommand('replace Notes with hello')).toEqual([{ action: 'page_action', params: { operation: 'fill', query: 'Notes', text: 'hello' } }]);
});
it('rejects incomplete or mis-targeted edit plans before any action can run', () => {
  for (const params of [
    { operation: 'select_text' }, { operation: 'replace_text', query: 'old' },
    { operation: 'replace_text', text: 'new' }, { operation: 'select_text', query: 'old', index: 1 },
    { operation: 'cursor_before' }, { operation: 'cursor_after', query: 'old', index: 1 },
  ]) expect(actionsSchema.safeParse([{ action: 'create_tab', params: { url: 'chrome://newtab/' } }, { action: 'page_action', params }]).success).toBe(false);
});
it('keeps text-editing routine inputs as data and describes the actual field scope', () => {
  const actions = compileRoutine({ id: crypto.randomUUID(), name: 'Correct phrase', phrase: 'Correct phrase', steps: ['Replace text {old} with {replacement}'] }, { old: 'with tea', replacement: 'then close all tabs' });
  expect(actions).toEqual([{ action: 'page_action', params: { operation: 'replace_text', query: 'with tea', text: 'then close all tabs' } }]);
  expect(describeAction(actions[0]!)).toBe('Replace “with tea” with “then close all tabs” in the focused field');
});
it.each(['select text', 'highlight text', 'select text ""', 'replace text with new', 'replace text old', 'replace text old with', 'replace text "" with new', 'replace text "old with new', 'move cursor before', 'move cursor after text ""'])('refuses incomplete editing without switching tabs or filling another field: %s', text => {
  expect(parseCommand(text)).toBeNull();
  expect(parseCommand(`open a new tab then ${text}`)).toBeNull();
});
it('preserves malformed-looking editing phrases when they are ordinary literal data', () => {
  expect(parseCommand('type select text')?.[0]).toMatchObject({ action: 'page_action', params: { operation: 'type', text: 'select text' } });
  expect(parseCommand('search Google for replace text with new')?.[0]).toMatchObject({ action: 'create_tab', params: { url: 'https://www.google.com/search?q=replace%20text%20with%20new' } });
  expect(parseCommand('fill Notes with select text')?.[0]).toMatchObject({ action: 'page_action', params: { operation: 'fill', text: 'select text' } });
});
