import { parseCommand } from './command-parser';
import { interruptIntent } from './expanded-parser';
import { reviewIntent, isNegatedCommand, stripLeadingRequestFraming } from './language';
import { normalizeMacroPhrase } from './macros';
import { actionsSchema, type ChromeAction } from './schema';
import { routineSchema, routinesSchema, type Routine } from './routine-schema';
import { z } from 'zod';

const placeholder = /\{([a-z][a-z0-9_]{0,29})\}/g;
export function routineInputs(routine: Routine): string[] {
  const names = [...new Set(routine.steps.flatMap(step => [...step.matchAll(placeholder)].map(match => match[1]!)))];
  if (names.length > 3) throw new Error('Use at most three inputs, such as {topic}, in a routine.');
  const phraseInputs = [...routine.phrase.matchAll(placeholder)];
  if (phraseInputs.length > 1 || (phraseInputs[0] && !routine.phrase.endsWith(phraseInputs[0][0]))) throw new Error('A spoken phrase can have one input, placed at the end: “research {topic}”.');
  if (phraseInputs.some(match => !names.includes(match[1]!))) throw new Error('Use the spoken input in at least one routine step.');
  if (phraseInputs[0] && !routine.phrase.slice(0, phraseInputs[0].index).trim()) throw new Error('Put some command words before the spoken input.');
  return names;
}
function fillAction(action: ChromeAction, values: Record<string, string>, template: boolean): ChromeAction {
  const result = structuredClone(action);
  const fill = (text: string): string => text.replace(placeholder, (match, name: string) => template ? match : values[name]!);
  for (const [field, value] of Object.entries(result.params)) {
    if (Array.isArray(value) && value.some(item => typeof item === 'string' && /[{}]/.test(item))) throw new Error('Use inputs with one tab query at a time.');
    if (typeof value !== 'string') continue;
    if (result.action === 'create_tab' && field === 'url') {
      const url = new URL(value);
      if (/[{}]|%7B/i.test(url.hostname)) throw new Error('Routine inputs cannot change a website hostname. Use a named site search.');
      // URL data is encoded before substitution. Input can never add another action or URL parameter.
      result.params.url = value.replace(/%7B([a-z][a-z0-9_]{0,29})%7D/gi, (match, name: string) => template ? match : encodeURIComponent(values[name]!));
      if (/[{}]/.test(result.params.url)) throw new Error('Use routine inputs in search terms or literal field text, not raw URLs.');
    } else if (value.includes('{') || value.includes('}')) {
      const allowed = ['page_action', 'find_tab', 'search_site', 'wait_for_field', 'bookmark_page'].includes(result.action) && ['text', 'query', 'title'].includes(field);
      if (!allowed || /[{}]/.test(value.replace(placeholder, ''))) throw new Error('Inputs work in search words, field text/labels, tab queries, and bookmark titles. Keep action names, websites, and numbers fixed.');
      Object.assign(result.params, { [field]: fill(value) });
    }
  }
  return result;
}
/** Compile the command structure first, then substitute inputs only into data slots. */
export function compileRoutine(input: Routine, values?: Record<string, string>): ChromeAction[] {
  const routine = routineSchema.parse(input); const names = routineInputs(routine);
  if (interruptIntent(routine.phrase) || reviewIntent(routine.phrase) !== undefined || isNegatedCommand(routine.phrase)) throw new Error('Choose a phrase other than a cancel, confirmation, or negative command.');
  if (values) {
    if (Object.keys(values).some(name => !names.includes(name))) throw new Error('This routine does not use one of the supplied inputs.');
    for (const name of names) if (!values[name]?.trim() || values[name]!.length > 500) throw new Error(`Provide ${name} using 1–500 characters.`);
  }
  const actions: ChromeAction[] = [];
  for (const [index, step] of routine.steps.entries()) {
    let parsed: ChromeAction[] | null = null;
    try { parsed = parseCommand(step); } catch { /* Show the failing step below. */ }
    if (!parsed || interruptIntent(step)) throw new Error(`Step ${index + 1} is not a supported command. Choose an example from Commands and edit its names or text.`);
    if (parsed.some(action => action.action === 'page_action' && ['dictate_start', 'dictate_stop'].includes(action.params.operation))) throw new Error(`Step ${index + 1}: start and stop dictation separately from a routine.`);
    actions.push(...parsed.map(action => fillAction(action, values ?? {}, values === undefined)));
    if (actions.length > 8) throw new Error('A routine can contain at most 8 actions. Named targets can use one action to select and another to change them.');
  }
  return actionsSchema.parse(actions);
}
export function findRoutine(items: Routine[], text: string): Routine | undefined {
  const phrase = normalizeMacroPhrase(text);
  return items.find(item => normalizeMacroPhrase(item.phrase) === phrase || normalizeMacroPhrase(`run ${item.name} routine`) === phrase);
}
export interface RoutineInvocation { routine: Routine; values: Record<string, string>; }
export function matchRoutine(items: Routine[], text: string): RoutineInvocation | undefined {
  const exact = findRoutine(items, text); if (exact) return { routine: exact, values: {} };
  const raw = stripLeadingRequestFraming(text);
  const matches: RoutineInvocation[] = [];
  for (const routine of items) {
    const slot = [...routine.phrase.matchAll(placeholder)][0]; if (!slot) continue;
    const prefix = routine.phrase.slice(0, slot.index).trim();
    const words = prefix.split(/\s+/).map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
    const value = raw.match(new RegExp(`^${words}\\s+([\\s\\S]+)$`, 'i'))?.[1]?.trim();
    if (value) matches.push({ routine, values: { [slot[1]!]: value } });
    else if (normalizeMacroPhrase(raw) === normalizeMacroPhrase(prefix)) matches.push({ routine, values: {} });
  }
  if (matches.length > 1) throw new Error('More than one routine matches. Say “run [routine name] routine” to choose it.');
  return matches[0];
}
const exchangeSchema = z.object({ format: z.literal('handsfree-routines'), version: z.literal(1), routines: routinesSchema }).strict();
export function exportRoutines(routines: Routine[]): string { for (const routine of routines) compileRoutine(routine); return JSON.stringify(exchangeSchema.parse({ format: 'handsfree-routines', version: 1, routines }), null, 2); }
export function importRoutines(text: string): Routine[] {
  if (new TextEncoder().encode(text).length > 250_000) throw new Error('Choose a routine file smaller than 250 KB.');
  const parsed = exchangeSchema.parse(JSON.parse(text) as unknown);
  for (const routine of parsed.routines) compileRoutine(routine);
  if (!parsed.routines.length) throw new Error('This file contains no routines.');
  return parsed.routines.map(routine => ({ ...routine, id: crypto.randomUUID() }));
}
export function moveRoutineStep(steps: string[], from: number, to: number): string[] {
  if (![from, to].every(index => Number.isInteger(index) && index >= 0 && index < steps.length)) return [...steps];
  const next = [...steps]; const [step] = next.splice(from, 1); next.splice(to, 0, step!); return next;
}
