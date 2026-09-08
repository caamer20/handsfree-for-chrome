import { expect, it } from 'vitest';
import { validateGrounding } from '../src/offscreen/grounding';
import { parseCommand } from '../src/common/command-parser';
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
