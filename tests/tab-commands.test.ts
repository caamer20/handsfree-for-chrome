import { describe, expect, it } from 'vitest';
import { COMMAND_EXAMPLES } from '../src/common/constants';
import { parseCommand } from '../src/common/command-parser';
import { actionsSchema, type ChromeAction } from '../src/common/schema';
import { requiresReview } from '../src/background/dispatcher';
import { literalTabMatch, resolveTab } from '../src/background/tab-matching';
const find = (query: string, auto_switch = false): ChromeAction => ({ action: 'find_tab', params: { query, auto_switch } });
const close: ChromeAction = { action: 'close_tab', params: { target: 'current' } };
const select = (index: number, activate = false): ChromeAction => ({ action: 'select_tab', params: { position: 'index', index, activate } });

describe('named tab commands', () => {
  it.each([
    ['close xyz tab', [find('xyz'), close]],
    ['close the All Hands tab', [find('All Hands'), close]],
    ['close tab named Other projects', [find('Other projects'), close]],
    ['Close the YouTube tab for me, please.', [find('YouTube'), close]],
    ['Please close the YouTube tab', [find('YouTube'), close]],
    ['Could you close my GitHub tab?', [find('GitHub'), close]],
    ['close tab named Design notes', [find('Design notes'), close]],
    ['close the tab containing recipes', [find('recipes'), close]],
    ['close Wikipedia', [find('Wikipedia'), close]],
    ['shut the YouTube tab', [find('YouTube'), close]],
    ['dismiss the Calendar tab', [find('Calendar'), close]],
    ['mute YouTube', [find('YouTube'), { action: 'mute_tab', params: { mute: true } }]],
    ['unmute the Spotify tab', [find('Spotify'), { action: 'mute_tab', params: { mute: false } }]],
    ['silence tab containing meeting', [find('meeting'), { action: 'mute_tab', params: { mute: true } }]],
    ['make my YouTube tab quiet', [find('YouTube'), { action: 'mute_tab', params: { mute: true } }]],
    ['pin the GitHub tab', [find('GitHub'), { action: 'pin_tab', params: { pin: true } }]],
    ['unpin Gmail', [find('Gmail'), { action: 'pin_tab', params: { pin: false } }]],
    ['reload the Calendar tab', [find('Calendar'), { action: 'reload_tab', params: { bypass_cache: false } }]],
    ['hard refresh GitHub', [find('GitHub'), { action: 'reload_tab', params: { bypass_cache: true } }]],
    ['duplicate the Design notes tab', [find('Design notes'), { action: 'duplicate_tab', params: {} }]],
    ['switch to the YouTube tab', [find('YouTube', true)]],
    ['take me to my GitHub tab', [find('GitHub', true)]],
    ['find my calendar tab', [find('calendar', true)]],
    ['show the tab called Recipes', [find('Recipes', true)]],
    ['close "Rock then Roll" tab', [find('Rock then Roll'), close]],
  ])('%s', (text, expected) => expect(parseCommand(text as string)).toEqual(expected));
  it('keeps entire sequences ordered rather than treating trailing commands as tab names', () => {
    expect(parseCommand('close YouTube tab then pin GitHub tab')).toEqual([find('YouTube'), close, find('GitHub'), { action: 'pin_tab', params: { pin: true } }]);
    expect(parseCommand('close YouTube tab then delete history')).toBeNull();
    expect(parseCommand('search google for close YouTube tab then pin GitHub')).toEqual([{ action: 'create_tab', params: { url: 'https://www.google.com/search?q=close%20YouTube%20tab%20then%20pin%20GitHub' } }]);
  });
});
describe('positions, reopening and moving', () => {
  it.each([
    ['next tab', [{ action: 'select_tab', params: { position: 'next', activate: true } }]],
    ['go to the previous tab', [{ action: 'select_tab', params: { position: 'previous', activate: true } }]],
    ['first tab', [{ action: 'select_tab', params: { position: 'first', activate: true } }]],
    ['switch to the last tab', [{ action: 'select_tab', params: { position: 'last', activate: true } }]],
    ['switch to tab three', [select(3, true)]],
    ['tab number 12', [select(12, true)]],
    ['close tab number three', [select(3), close]],
    ['close the second tab', [select(2), close]],
    ['mute tab four', [select(4), { action: 'mute_tab', params: { mute: true } }]],
    ['close next tab', [{ action: 'select_tab', params: { position: 'next', activate: false } }, close]],
    ['move this tab left', [{ action: 'move_tab', params: { position: 'left' } }]],
    ['move the GitHub tab to the end', [find('GitHub'), { action: 'move_tab', params: { position: 'last' } }]],
    ['move tab three to position one', [select(3), { action: 'move_tab', params: { position: 'index', index: 1 } }]],
    ['move this tab to a new window', [{ action: 'create_window', params: { with_current_tab: true } }]],
    ['move the Design tab into a new window', [find('Design'), { action: 'create_window', params: { with_current_tab: true } }]],
    ['open a new window', [{ action: 'create_window', params: {} }]],
    ['reopen the last closed tab', [{ action: 'reopen_tab', params: {} }]],
    ['undo close', [{ action: 'reopen_tab', params: {} }]],
    ['bring back my closed tab', [{ action: 'reopen_tab', params: {} }]],
  ])('%s', (text, expected) => expect(parseCommand(text as string)).toEqual(expected));
  it.each(['close tab zero', 'close tab 0', 'close tab 1001', 'close tab -1', 'close tab 1.5', 'close all windows', 'close things maybe'])('does not turn invalid selectors into current-tab actions: %s', text => {
    expect(parseCommand(text)).toBeNull();
  });
});
describe('bulk closures', () => {
  it.each([
    ['close all YouTube tabs', { target: 'matching', query: 'YouTube' }],
    ['close YouTube tabs', { target: 'matching', query: 'YouTube' }],
    ['close tabs containing github.com', { target: 'matching', query: 'github.com' }],
    ['close all tabs', { target: 'all' }],
    ['close every tab in this window', { target: 'all' }],
    ['keep only this tab', { target: 'all_others' }],
  ])('requires review for %s', (text, params) => {
    const plan = parseCommand(text as string);
    expect(plan).toEqual([{ action: 'close_tab', params }]);
    expect(requiresReview(plan!, 'grammar')).toBe(true);
  });
  it('does not require extra approval for an explicit single named close', () => expect(requiresReview(parseCommand('close GitHub tab')!, 'grammar')).toBe(false));
  it('rejects incomplete or conflicting selection and close parameters', () => {
    for (const action of [
      { action: 'close_tab', params: { target: 'matching' } },
      { action: 'close_tab', params: { target: 'current', query: 'YouTube' } },
      { action: 'select_tab', params: { position: 'index' } },
      { action: 'move_tab', params: { position: 'first', index: 2 } },
    ]) expect(actionsSchema.safeParse([action]).success).toBe(false);
  });
});
describe('tab name resolution', () => {
  const tab = (id: number, title: string, url = 'https://example.org'): chrome.tabs.Tab => ({ id, title, url, windowId: id < 3 ? 1 : 2, index: 0 } as chrome.tabs.Tab);
  it('uses titles and hosts, including common speech spacing and a unique typo', () => {
    expect(resolveTab([tab(1, 'Music', 'https://youtube.com/watch?v=1')], 'you tube').id).toBe(1);
    expect(resolveTab([tab(1, 'Project', 'https://github.com/org/repo')], 'githb').id).toBe(1);
    expect(resolveTab([tab(1, 'Café recipe collection')], 'cafe recipes').id).toBe(1);
  });
  it('rejects no-match and ambiguous names across windows', () => {
    const tabs = [tab(1, 'YouTube'), tab(3, 'Music - YouTube')];
    expect(() => resolveTab(tabs, 'youtube')).toThrow('2 tabs match');
    expect(() => resolveTab(tabs, 'nonexistent')).toThrow('No tab matching');
  });
  it('bulk matching uses literal words without typo guesses', () => {
    expect(literalTabMatch(tab(1, 'YouTube - Music'), 'you tube')).toBe(true);
    expect(literalTabMatch(tab(1, 'Catch up on news'), 'cat')).toBe(false);
    expect(literalTabMatch(tab(1, 'GitHub'), 'githb')).toBe(false);
    expect(literalTabMatch(tab(1, 'Notes · Design review'), 'design notes')).toBe(true);
  });
});

it('every command-guide example works without AI', () => {
  for (const example of COMMAND_EXAMPLES) expect(parseCommand(example.text), example.text).not.toBeNull();
});
