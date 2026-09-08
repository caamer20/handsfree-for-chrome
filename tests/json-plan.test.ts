import { expect, it } from 'vitest';
import { parseModelPlan } from '../src/offscreen/json-plan';
it('unwraps JSON code fences and respects brackets inside strings', () => {
  expect(parseModelPlan('```json\n[{"action":"find_tab","params":{"query":"hello [world]"}}]\n```')).toEqual([{ action: 'find_tab', params: { query: 'hello [world]' } }]);
});
it.each(['[{"action":"eval","params":{}}]', '[{"action":"close_tab","params":{}}] [{"action":"duplicate_tab","params":{}}]', 'not json', '[{"action":"close_tab"', '[]'])('rejects malformed or ambiguous model output %s', value => expect(() => parseModelPlan(value)).toThrow());
