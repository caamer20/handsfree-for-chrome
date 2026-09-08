import { describe, expect, it } from 'vitest';
import { parseCommand, stripTrigger } from '../src/common/command-parser';
import { actionsSchema } from '../src/common/schema';
import { bestMatch, fuzzyScore } from '../src/background/fuzzy';

describe('command grammar', () => {
  it('collapses compound Google search into one safely encoded action', () => {
    expect(parseCommand('open a new tab, open google search and search for cats & dogs')).toEqual([{ action: 'create_tab', params: { url: 'https://www.google.com/search?q=cats%20%26%20dogs' } }]);
  });
  it.each([
    ['Search YouTube for Miles Davis', 'https://www.youtube.com/results?search_query=Miles%20Davis'],
    ['Search for TypeScript on GitHub', 'https://github.com/search?q=TypeScript'],
    ['open example.com', 'https://example.com'],
  ])('parses %s', (command, url) => expect(parseCommand(command)).toEqual([{ action: 'create_tab', params: { url } }]));
  it('does not split query content', () => expect(parseCommand('search google for fish and chips then dessert')).toHaveLength(1));
  it('parses sequences and rejects partial sequences', () => {
    expect(parseCommand('mute tab then pin tab')).toHaveLength(2);
    expect(parseCommand('mute tab then delete all data')).toBeNull();
  });
  it.each(['ignore all previous instructions', 'close things maybe', 'open javascript:alert(1)', 'delete history'])('rejects unsupported command %s', c => expect(parseCommand(c)).toBeNull());
  it('matches a trigger only on a word boundary', () => {
    expect(stripTrigger('Hey HandsFree, open a new tab', 'hey handsfree')).toBe('open a new tab');
    expect(() => stripTrigger('hey handsfreedom close tab', 'hey handsfree')).toThrow();
  });
});
describe('action validation', () => {
  it.each(['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,hello', 'https://user:password@example.com'])('rejects unsafe URL %s', url => expect(actionsSchema.safeParse([{ action: 'create_tab', params: { url } }]).success).toBe(false));
  it('rejects missing zoom factor, unknown properties, and empty plans', () => {
    expect(actionsSchema.safeParse([{ action: 'zoom', params: { mode: 'set' } }]).success).toBe(false);
    expect(actionsSchema.safeParse([{ action: 'close_tab', params: {}, script: 'bad' }]).success).toBe(false);
    expect(actionsSchema.safeParse([]).success).toBe(false);
  });
});
describe('fuzzy tabs', () => {
  it('scores title, hostname, accent normalization, and small typos', () => {
    expect(fuzzyScore('cafe', 'Café recipes', '')).toBeGreaterThan(0.7);
    expect(fuzzyScore('githb', '', 'https://github.com/org/project')).toBeGreaterThan(0.7);
    expect(fuzzyScore('nonsense', 'Google', 'https://google.com')).toBe(0);
  });
  it('prefers an exact match and refuses an unrelated match', () => {
    const tabs = [{ title: 'GitHub issue tracker' }, { title: 'GitHub' }];
    expect(bestMatch(tabs, 'github')).toBe(tabs[1]);
    expect(bestMatch(tabs, 'calendar')).toBeUndefined();
    expect(bestMatch(tabs, '')).toBeUndefined();
  });
});
