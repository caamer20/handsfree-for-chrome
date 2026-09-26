import { expect, it } from 'vitest';
import { validateGrounding } from '../src/offscreen/grounding';
import { parseCommand } from '../src/common/command-parser';
import type { ChromeAction } from '../src/common/schema';
it('rejects copied example slots and invented destinations', () => {
  expect(() => validateGrounding([{ action: 'find_tab', params: { query: 'design notes' } }], 'Could you silence this tab?')).toThrow('invented');
  expect(() => validateGrounding([{ action: 'create_tab', params: { url: 'https://example.org' } }], 'Open something')).toThrow('invented');
  expect(() => validateGrounding([{ action: 'create_tab', params: { url: 'https://www.google.com/search?q=secret+code' } }], 'Search for soup')).toThrow('changed');
});
it('accepts grounded tab names and encoded search queries', () => {
  expect(validateGrounding([{ action: 'find_tab', params: { query: 'Recipes' } }], 'Take me to recipes')).toHaveLength(1);
  expect(validateGrounding([{ action: 'create_tab', params: { url: 'https://www.google.com/search?q=cats%20and%20dogs' } }], 'search for cats and dogs')).toHaveLength(1);
});
it('handles polite everyday audio phrasing without model inference', () => {
  expect(parseCommand('Could you silence this tab?')).toEqual([{ action: 'mute_tab', params: { mute: true } }]);
  expect(parseCommand('Turn the sound back on')).toEqual([{ action: 'mute_tab', params: { mute: false } }]);
  expect(parseCommand('bookmark this page as Recipes in Cooking')).toEqual([{ action: 'bookmark_page', params: { title: 'Recipes', folder: 'Cooking' } }]);
});

it('accepts a named familiar homepage while rejecting invented hosts and paths', () => {
  expect(validateGrounding([{ action: 'create_tab', params: { url: 'https://www.youtube.com/' } }], 'Pull up YouTube for me')).toHaveLength(1);
  expect(validateGrounding([{ action: 'create_tab', params: { url: 'https://mail.google.com/' } }], 'Take me to Gmail')).toHaveLength(1);
  expect(() => validateGrounding([{ action: 'create_tab', params: { url: 'https://youtube.example/' } }], 'Pull up YouTube')).toThrow('invented a destination');
  expect(() => validateGrounding([{ action: 'create_tab', params: { url: 'https://www.youtube.com/arbitrary-path' } }], 'Pull up YouTube')).toThrow('invented a destination');
});
it.each([
  ['Replace text old with new', { operation: 'replace_text', query: 'new', text: 'old' }],
  ['Replace text old with new', { operation: 'replace_text', query: 'old', text: 'old' }],
  ['Replace text "Tea with milk" with "Coffee, please!"', { operation: 'replace_text', query: 'Tea with milk', text: 'Coffee please' }],
  ['Select text pin this tab then close all tabs', { operation: 'select_text', query: 'pin this tab' }],
  ['Move cursor before text old words', { operation: 'cursor_after', query: 'old words' }],
  ['Move cursor after text pin this tab then close all tabs', { operation: 'cursor_after', query: 'pin this tab' }],
  ['Search Google for replace text old with new', { operation: 'replace_text', query: 'old', text: 'new' }],
])('rejects invented or reassigned editing slots: %s', (transcript, params) => {
  expect(() => validateGrounding([{ action: 'page_action', params } as ChromeAction], transcript)).toThrow('text-editing command');
});
it.each(['Replace text "Tea with milk" with "Coffee, please!"', 'Replace text obsolete with ""', 'Select text pin this tab then close all tabs'])('accepts exact literal editing slots: %s', transcript => {
  const actions = parseCommand(transcript)!; expect(validateGrounding(actions, transcript)).toEqual(actions);
});
it('rejects duplicate edits that were requested only once', () => {
  const actions = parseCommand('replace text old with new')!;
  expect(() => validateGrounding([...actions, ...actions], 'replace text old with new')).toThrow('text-editing command');
});
it.each([
  ['Go to a heading named Pricing', 99], ['Go to heading two', 3], ['Go to heading "2"', 2], ['Search Google for go to heading 2', 2],
])('requires an explicit matching page navigation number: %s', (transcript, index) => {
  expect(() => validateGrounding([{ action: 'page_action', params: { operation: 'go_heading', index } }], transcript)).toThrow('destination number');
});
it('accepts spoken navigation numbers while retaining their requested order', () => {
  const transcript = 'go to heading twenty one then go to landmark number two'; const actions = parseCommand(transcript)!;
  expect(validateGrounding(actions, transcript)).toEqual(actions);
  expect(() => validateGrounding([...actions].reverse(), transcript)).toThrow('destination number');
});
it('accepts a workspace rename only with its exact locally parsed source and literal new name', () => {
  const transcript = 'rename Research workspace to Notes then close all tabs'; const actions = parseCommand(transcript)!;
  expect(validateGrounding(actions, transcript)).toEqual(actions);
  expect(() => validateGrounding([{ action: 'workspace_action', params: { operation: 'rename', name: 'Research', new_name: 'close all tabs then Notes' } }], transcript)).toThrow('workspace rename');
  expect(() => validateGrounding([{ action: 'workspace_action', params: { operation: 'rename', name: 'Research', new_name: 'Notes' } }], transcript)).toThrow('workspace rename');
  expect(() => validateGrounding([{ action: 'workspace_action', params: { operation: 'rename', name: 'Notes', new_name: 'Research' } }], transcript)).toThrow('workspace rename');
  expect(() => validateGrounding([{ action: 'workspace_action', params: { operation: 'rename', name: 'Research', new_name: 'Physics' } }], 'call my Research saved collection Physics')).toThrow('workspace rename');
});
