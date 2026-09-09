import { routinesSchema, routineSchema, type Routine } from '../common/routine-schema';
import { compileRoutine, matchRoutine } from '../common/routines';
import type { Macro } from '../common/macros';
import { getMacros } from './store';

export async function getRoutines(): Promise<Routine[]> {
  const { routines } = await chrome.storage.local.get('routines');
  return routinesSchema.parse(routines ?? []);
}
function validatePhrases(all: Routine[], macros: Macro[]): void {
  for (const routine of all) {
    const others = all.filter(item => item.id !== routine.id);
    if ([routine.phrase, `run ${routine.name} routine`].some(phrase => matchRoutine(others, phrase)) || macros.some(macro => matchRoutine([routine], macro.phrase))) throw new Error('That spoken phrase or routine name is already in use. Choose another.');
  }
}
export async function saveRoutine(input: Routine): Promise<void> {
  const routine = routineSchema.parse(input); compileRoutine(routine);
  const next = routinesSchema.parse([...(await getRoutines()).filter(item => item.id !== routine.id), routine]);
  validatePhrases(next, await getMacros());
  await chrome.storage.local.set({ routines: next });
}
export async function addImportedRoutines(inputs: Routine[]): Promise<void> {
  const imported = routinesSchema.parse(inputs); if (!imported.length) throw new Error('Choose at least one routine to import.');
  for (const routine of imported) compileRoutine(routine);
  const all = routinesSchema.parse([...await getRoutines(), ...imported]);
  validatePhrases(all, await getMacros());
  await chrome.storage.local.set({ routines: all });
}
export async function deleteRoutine(id: string): Promise<void> {
  await chrome.storage.local.set({ routines: (await getRoutines()).filter(item => item.id !== id) });
}
