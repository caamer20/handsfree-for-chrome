import { expect, it } from 'vitest';
import { formatDictation } from '../src/common/dictation-format';
import { defaultSettings } from '../src/common/schema';
import { migrateSettings } from '../src/common/settings';
import { dictatedInsertion } from '../src/content/text-editing';

it.each([
  ['comma', ','], ['period', '.'], ['full stop', '.'], ['question mark', '?'],
  ['exclamation mark', '!'], ['exclamation point', '!'], ['colon', ':'], ['semicolon', ';'],
  ['open parenthesis', '('], ['close parenthesis', ')'], ['open quote', '“'], ['close quote', '”'],
  ['hyphen', '-'], ['dash', '—'],
])('formats the explicit punctuation phrase %s only when enabled', (text, punctuation) => {
  expect(formatDictation(text, true)).toBe(punctuation);
  expect(formatDictation(text, false)).toBe(text);
});
it.each([
  ['Hello comma world period', 'Hello, world.'],
  ['Is this ready question mark exclamation point', 'Is this ready?!'],
  ['One colon two semicolon three full stop', 'One: two; three.'],
  ['She said open quote hello comma friend close quote period', 'She said “hello, friend”.'],
  ['A note open parenthesis optional close parenthesis follows period', 'A note (optional) follows.'],
  ['open quote open parenthesis hello close parenthesis close quote', '“(hello)”'],
  ['state hyphen of hyphen the hyphen art dash today', 'state-of-the-art — today'],
  ['HELLO COMMA world FULL\tSTOP', 'HELLO, world.'],
  ['hello comma\nworld', 'hello,\nworld'],
  ['hello comma new line world period', 'hello, new line world.'],
  ['hello comma new paragraph world period', 'hello, new paragraph world.'],
])('uses punctuation spacing without rewriting the words: %s', (text, formatted) => {
  expect(formatDictation(text, true)).toBe(formatted);
});
it.each([
  'literal comma period new line scratch that',
  'Literal  open quote hello close quote',
  'literal\nquestion mark',
  'literal stop dictation',
])('leaves the literal escape and its payload untouched: %s', text => {
  expect(formatDictation(text, true)).toBe(text);
  expect(formatDictation(text, false)).toBe(text);
});
it.each(['commander periodical colonial semicolons dashboard', '  Keep   this\nspacing  ', 'new line new paragraph', 'scratch that', 'undo last dictation'])('keeps unformatted data unchanged: %s', text => {
  expect(formatDictation(text, true)).toBe(text);
});
it('requires explicit opt-in while preserving valid migrated preferences', () => {
  expect(defaultSettings.dictationPunctuation).toBe(false);
  expect(migrateSettings({ language: 'en-GB' })).toMatchObject({ language: 'en-GB', dictationPunctuation: false });
  expect(migrateSettings({ dictationPunctuation: true })).toMatchObject({ dictationPunctuation: true });
  expect(migrateSettings({ dictationPunctuation: 'true' })).toMatchObject({ dictationPunctuation: false });
});
it('joins standalone hyphens to neighboring text across dictated phrases', () => {
  expect(dictatedInsertion('wellknown', { start: 4, end: 4 }, formatDictation('hyphen', true))).toBe('-');
  expect(dictatedInsertion('well-', { start: 5, end: 5 }, 'known')).toBe('known');
  expect(dictatedInsertion('-known', { start: 0, end: 0 }, 'well')).toBe('well');
});
it('keeps standalone directional quotes and dashes correctly spaced in a field', () => {
  expect(dictatedInsertion('said', null, formatDictation('open quote', true))).toBe(' “');
  expect(dictatedInsertion('said “', null, 'hello')).toBe('hello');
  expect(dictatedInsertion('said “hello', null, formatDictation('close quote', true))).toBe('”');
  expect(dictatedInsertion('hello', null, formatDictation('dash', true))).toBe(' —');
  expect(dictatedInsertion('hello —', null, 'world')).toBe(' world');
});
