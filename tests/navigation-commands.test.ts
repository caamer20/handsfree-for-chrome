import { expect, it } from 'vitest';
import { parseCommand } from '../src/common/command-parser';
import { actionsSchema } from '../src/common/schema';

it.each([
  ['show headings', { operation: 'show_headings' }],
  ['List all headings', { operation: 'show_headings' }],
  ['Show page regions', { operation: 'show_landmarks' }],
  ['Show me the landmarks', { operation: 'show_landmarks' }],
  ['Next heading', { operation: 'next_heading' }],
  ['Go to the previous heading', { operation: 'previous_heading' }],
  ['Previous page region', { operation: 'previous_landmark' }],
  ['Jump to the next landmark', { operation: 'next_landmark' }],
  ['Go to the Pricing heading', { operation: 'go_heading', query: 'Pricing' }],
  ['Go to heading "Then and now"', { operation: 'go_heading', query: 'Then and now' }],
  ['Go to heading number twenty one', { operation: 'go_heading', index: 21 }],
  ['Go to the "Three" heading', { operation: 'go_heading', query: 'Three' }],
  ['Jump to page region "Primary navigation"', { operation: 'go_landmark', query: 'Primary navigation' }],
  ['Skip to main content', { operation: 'go_landmark', query: 'main' }],
])('parses page navigation: %s', (text, params) => { expect(parseCommand(text)).toEqual([{ action: 'page_action', params }]); });

it('preserves regular browser targets and validates required page destinations', () => {
  expect(parseCommand('switch to the Pricing tab')?.[0]?.action).toBe('find_tab');
  expect(parseCommand('go to the bottom')?.[0]).toEqual({ action: 'page_action', params: { operation: 'scroll', direction: 'bottom' } });
  for (const operation of ['go_heading', 'go_landmark']) expect(actionsSchema.safeParse([{ action: 'page_action', params: { operation } }]).success).toBe(false);
});
it.each(['go to heading', 'go to heading number', 'go to heading zero', 'go to heading 201', 'go to heading 1.5', 'go to heading -1', 'go to heading number two hundred one', 'go to landmark 0', 'go to the 201 heading', 'go to heading ""'])('refuses malformed navigation without falling back to browser actions: %s', text => {
  expect(parseCommand(text)).toBeNull();
  expect(parseCommand(`open a new tab then ${text}`)).toBeNull();
});
it('keeps quoted numbers as heading names and complete navigation sequences valid', () => {
  expect(parseCommand('go to heading "201"')).toEqual([{ action: 'page_action', params: { operation: 'go_heading', query: '201' } }]);
  expect(parseCommand('show headings then go to heading twenty one')).toEqual([{ action: 'page_action', params: { operation: 'show_headings' } }, { action: 'page_action', params: { operation: 'go_heading', index: 21 } }]);
});
