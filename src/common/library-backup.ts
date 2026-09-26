import { z } from 'zod';
import { aliasSchema, BUILTIN_SITES, legacyWorkspaceSchema, normalizeName, workspaceSchema, workspaceSnapshotDetails, type Library, type SiteAlias, type Workspace } from './library';
import { macroSchema, normalizeMacroPhrase, type Macro } from './macros';
import { routineSchema, type Routine } from './routine-schema';
import { compileRoutine, matchRoutine } from './routines';

export const LIBRARY_BACKUP_MAX_BYTES = 5 * 1024 * 1024;
export const LIBRARY_BACKUP_KINDS = ['aliases', 'macros', 'routines', 'workspaces'] as const;
export type LibraryBackupKind = typeof LIBRARY_BACKUP_KINDS[number];
export type LibraryBackupCounts = Record<LibraryBackupKind, number>;
export interface LibraryBackupPreview {
  added: LibraryBackupCounts;
  skipped: LibraryBackupCounts;
  entries: { kind: LibraryBackupKind; name: string; operation: 'add' | 'skip'; details: string[] }[];
}
export interface LibraryBackupState { library: Library; macros: Macro[]; routines: Routine[]; }
const portableSchema = z.object({
  aliases: z.array(aliasSchema).max(100, 'Use at most 100 site nicknames.'),
  macros: z.array(macroSchema).max(50, 'Use at most 50 website routines.'),
  routines: z.array(routineSchema).max(50, 'Use at most 50 command routines.'),
  workspaces: z.array(workspaceSchema).max(30, 'Use at most 30 workspaces.'),
}).strict();
const backupSchema = z.discriminatedUnion('version', [
  portableSchema.extend({ format: z.literal('handsfree-library'), version: z.literal(1), workspaces: z.array(legacyWorkspaceSchema).max(30) }).strict(),
  portableSchema.extend({ format: z.literal('handsfree-library'), version: z.literal(2) }).strict(),
]);
export type LibraryBackup = z.infer<typeof backupSchema>;
type PortableLibrary = z.infer<typeof portableSchema>;
type Item = SiteAlias | Macro | Routine | Workspace;
const labels: Record<LibraryBackupKind, string> = { aliases: 'site nickname', macros: 'website routine', routines: 'command routine', workspaces: 'workspace' };
const limits: LibraryBackupCounts = { aliases: 100, macros: 50, routines: 50, workspaces: 30 };
const counts = (): LibraryBackupCounts => ({ aliases: 0, macros: 0, routines: 0, workspaces: 0 });
const itemName = (name: string): string => normalizeName(name) || name.normalize('NFKC').toLowerCase().trim();
const nameKey = (kind: LibraryBackupKind, name: string): string => kind === 'routines' ? normalizeMacroPhrase(`run ${name} routine`) : itemName(name);

function schemaError(error: unknown, context: string): never {
  if (error instanceof z.ZodError) {
    const issue = error.issues[0];
    throw new Error(`${context}: ${issue?.path.length ? issue.path.join('.') + ': ' : ''}${issue?.message ?? 'Invalid data.'}`);
  }
  throw error;
}
function checkSize(text: string): void {
  if (new TextEncoder().encode(text).byteLength > LIBRARY_BACKUP_MAX_BYTES) throw new Error('The library backup is larger than 5 MiB. Choose a smaller backup.');
}
function portable(state: LibraryBackupState): PortableLibrary {
  return { aliases: state.library.aliases, macros: state.macros, routines: state.routines, workspaces: state.library.workspaces };
}
function validateContents(data: PortableLibrary, context: string): void {
  const ids = new Set<string>();
  for (const kind of LIBRARY_BACKUP_KINDS) {
    const names = new Set<string>(); const phrases = new Set<string>();
    for (const item of data[kind]) {
      if (ids.has(item.id)) throw new Error(`${context} repeats an ID for “${item.name}”. Every item must have its own ID.`);
      ids.add(item.id);
      const name = nameKey(kind, item.name);
      if (kind !== 'macros' && names.has(name)) throw new Error(`${context} contains more than one ${labels[kind]} named “${item.name}”. Rename one before importing.`);
      names.add(name);
      if ('phrase' in item) {
        const phrase = normalizeMacroPhrase(item.phrase);
        if (phrases.has(phrase)) throw new Error(`${context} repeats the spoken phrase “${item.phrase}”. Choose a different phrase.`);
        phrases.add(phrase);
      }
    }
  }
  for (const alias of data.aliases) {
    if (BUILTIN_SITES.some(site => site.aliases.some(name => normalizeName(name) === normalizeName(alias.name)))) throw new Error(`The nickname “${alias.name}” belongs to a built-in site. Choose a personal nickname before importing.`);
  }
  // Compile every routine before considering duplicate skips. Importing a file
  // can never bypass step validation by copying a saved name or ID.
  for (const routine of data.routines) {
    try { compileRoutine(routine); }
    catch (error) { throw new Error(`Command routine “${routine.name}”: ${error instanceof Error ? error.message : 'A step is unsupported.'}`); }
  }
  for (const [index, routine] of data.routines.entries()) {
    for (const other of data.routines.slice(index + 1)) {
      const overlaps = [routine.phrase, `run ${routine.name} routine`].some(phrase => matchRoutine([other], phrase))
        || [other.phrase, `run ${other.name} routine`].some(phrase => matchRoutine([routine], phrase));
      if (overlaps) throw new Error(`Command routines “${routine.name}” and “${other.name}” use overlapping spoken commands. Choose different names or phrases.`);
    }
    for (const macro of data.macros) {
      if (matchRoutine([routine], macro.phrase)) throw new Error(`Website routine “${macro.name}” and command routine “${routine.name}” use the same spoken command. Choose a different phrase.`);
    }
  }
}

/** Validate only the saved collections; settings, credentials and logs are not read here. */
export function parseLibraryBackupState(input: unknown): LibraryBackupState {
  const stateSchema = z.object({
    library: z.object({ aliases: z.array(aliasSchema).max(100).default([]), workspaces: z.array(workspaceSchema).max(30).default([]), suggestions: z.array(aliasSchema).max(30).default([]) }).default({}),
    macros: z.array(macroSchema).max(50).default([]), routines: z.array(routineSchema).max(50).default([]),
  });
  try {
    const state = stateSchema.parse(input);
    validateContents(portable(state), 'The saved library');
    return state;
  } catch (error) { return schemaError(error, 'The saved library is invalid'); }
}
export function parseLibraryBackup(text: string): LibraryBackup {
  checkSize(text);
  let raw: unknown;
  try { raw = JSON.parse(text) as unknown; } catch { throw new Error('This file is not valid JSON. Choose a HandsFree library backup.'); }
  if (raw && typeof raw === 'object' && 'format' in raw && raw.format === 'handsfree-library' && 'version' in raw && raw.version !== 1 && raw.version !== 2) throw new Error('Unsupported library backup version. Update HandsFree before importing this file.');
  let backup: LibraryBackup;
  try { backup = backupSchema.parse(raw); } catch (error) { return schemaError(error, 'Invalid library backup'); }
  if (!LIBRARY_BACKUP_KINDS.some(kind => backup[kind].length)) throw new Error('This backup contains no site nicknames, routines, or workspaces.');
  validateContents(backup, 'The backup');
  return backup;
}
export function exportLibraryBackup(input: LibraryBackupState): string {
  const state = parseLibraryBackupState(input);
  const data = portable(state);
  if (!LIBRARY_BACKUP_KINDS.some(kind => data[kind].length)) throw new Error('Your library is empty. Save a site nickname, routine, or workspace before exporting.');
  const text = JSON.stringify({ format: 'handsfree-library', version: 2, ...data }, null, 2);
  checkSize(text); return text;
}
function content(item: Item): string {
  // IDs are regenerated on import; a workspace's creation date is metadata.
  // All user-visible content must match to qualify for a duplicate skip.
  const value = { ...item } as Record<string, unknown>; delete value.id; delete value.createdAt;
  if ('previous' in item && item.previous) { const previous = { ...item.previous } as Record<string, unknown>; delete previous.createdAt; value.previous = previous; }
  return JSON.stringify(value);
}
function details(item: Item): string[] {
  if ('searchUrl' in item) return [`Website: ${item.url}`, ...(item.searchUrl ? [`Search URL: ${item.searchUrl}`] : [])];
  if ('urls' in item) return [`Spoken phrase: ${item.phrase}`, ...item.urls.map((url, index) => `Website ${index + 1}: ${url}`)];
  if ('steps' in item) return [`Spoken phrase: ${item.phrase}`, ...item.steps.map((step, index) => `Step ${index + 1}: ${step}`)];
  return [...workspaceSnapshotDetails(item), ...(item.previous ? [`Previous saved version: ${item.previous.tabs.length} tabs`, ...workspaceSnapshotDetails(item.previous).map(detail => `Previous version · ${detail}`)] : [])];
}
function plan(text: string, input: LibraryBackupState): { state: LibraryBackupState; preview: LibraryBackupPreview; additions: PortableLibrary } {
  const incoming = parseLibraryBackup(text); const state = parseLibraryBackupState(input); const saved = portable(state);
  const preview: LibraryBackupPreview = { added: counts(), skipped: counts(), entries: [] };
  const additions: PortableLibrary = { aliases: [], macros: [], routines: [], workspaces: [] };
  const ids = new Map(LIBRARY_BACKUP_KINDS.flatMap(kind => saved[kind].map(item => [item.id, { kind, item }] as const)));
  function mergeKind<T extends Item>(kind: LibraryBackupKind, current: T[], imports: T[]): T[] {
    const next = [...current];
    for (const item of imports) {
      const sameId = ids.get(item.id);
      if (sameId && (sameId.kind !== kind || content(sameId.item) !== content(item))) throw new Error(`“${item.name}” uses an ID already held by a different saved item. Nothing was imported.`);
      if (current.some(savedItem => content(savedItem) === content(item))) {
        preview.skipped[kind]++; preview.entries.push({ kind, name: item.name, operation: 'skip', details: details(item) }); continue;
      }
      if (kind !== 'macros' && current.some(savedItem => nameKey(kind, savedItem.name) === nameKey(kind, item.name))) throw new Error(`A saved ${labels[kind]} named “${item.name}” has different content. Rename the imported item; saved entries are never overwritten.`);
      if ('phrase' in item && current.some(savedItem => 'phrase' in savedItem && normalizeMacroPhrase(savedItem.phrase) === normalizeMacroPhrase(item.phrase))) throw new Error(`The spoken phrase “${item.phrase}” is already saved. Choose a different imported phrase.`);
      next.push(item); (additions[kind] as Item[]).push(item);
      preview.added[kind]++; preview.entries.push({ kind, name: item.name, operation: 'add', details: details(item) });
    }
    if (next.length > limits[kind]) throw new Error(`Import would exceed the limit of ${limits[kind]} ${kind === 'aliases' ? 'site nicknames' : kind === 'macros' ? 'website routines' : kind === 'routines' ? 'command routines' : 'workspaces'}. Remove entries or use a smaller backup.`);
    return next;
  }
  const combined = {
    aliases: mergeKind('aliases', saved.aliases, incoming.aliases),
    macros: mergeKind('macros', saved.macros, incoming.macros),
    routines: mergeKind('routines', saved.routines, incoming.routines),
    workspaces: mergeKind('workspaces', saved.workspaces, incoming.workspaces),
  };
  validateContents(combined, 'The merged library');
  return { state, preview, additions };
}
/** Pure preview: validates the exact same merge as import, without creating IDs or writing storage. */
export function previewLibraryBackup(text: string, state: LibraryBackupState): LibraryBackupPreview { return plan(text, state).preview; }
export function mergeLibraryBackup(text: string, input: LibraryBackupState): { state: LibraryBackupState; preview: LibraryBackupPreview } {
  const { state, preview, additions } = plan(text, input);
  const used = new Set([...state.library.suggestions.map(item => item.id), ...LIBRARY_BACKUP_KINDS.flatMap(kind => [...portable(state)[kind], ...additions[kind]].map(item => item.id))]);
  function fresh<T extends Item>(item: T): T {
    for (let attempt = 0; attempt < 10; attempt++) {
      const id = crypto.randomUUID(); if (used.has(id)) continue;
      used.add(id); return { ...item, id };
    }
    throw new Error('Could not assign unique IDs to the imported items. Nothing was imported; try again.');
  }
  return { state: {
    library: { ...state.library, aliases: [...state.library.aliases, ...additions.aliases.map(fresh)], workspaces: [...state.library.workspaces, ...additions.workspaces.map(fresh)] },
    macros: [...state.macros, ...additions.macros.map(fresh)], routines: [...state.routines, ...additions.routines.map(fresh)],
  }, preview };
}
