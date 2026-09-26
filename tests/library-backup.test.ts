import { beforeEach, expect, it, vi } from 'vitest';
import { exportLibraryBackup, LIBRARY_BACKUP_MAX_BYTES, mergeLibraryBackup, parseLibraryBackup, previewLibraryBackup, type LibraryBackup, type LibraryBackupState } from '../src/common/library-backup';
import { exportSavedLibrary, importSavedLibrary, previewSavedLibraryImport } from '../src/background/library-backup';
import { saveRoutine } from '../src/background/routine-store';

const id = (value: number): string => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const empty = (): LibraryBackupState => ({ library: { aliases: [], workspaces: [], suggestions: [] }, macros: [], routines: [] });
const sample = (): LibraryBackupState => ({
  library: {
    aliases: [{ id: id(1), name: 'Work dashboard', url: 'https://work.example/', searchUrl: 'https://work.example/search?q={query}' }],
    workspaces: [{ id: id(4), name: 'Research desk', createdAt: 123, tabs: [
      { title: 'Pinned reading', url: 'https://reading.example/', pinned: true },
      { title: 'Reference', url: 'https://reference.example/', pinned: false, group: 'Sources', color: 'blue' },
    ] }],
    suggestions: [{ id: id(5), name: 'Private suggestion', url: 'https://private.example/', searchUrl: '' }],
  },
  macros: [{ id: id(2), name: 'Daily sites', phrase: 'Open my daily sites', urls: ['https://mail.example/', 'https://calendar.example/'] }],
  routines: [{ id: id(3), name: 'Daily prep', phrase: 'Prepare daily work', steps: ['Open work dashboard', 'Pin this tab'] }],
});
const envelope = (data: Partial<LibraryBackup> = {}): LibraryBackup => ({ format: 'handsfree-library', version: 1, aliases: [], macros: [], routines: [], workspaces: [], ...data });
const text = (data: Partial<LibraryBackup>): string => JSON.stringify(envelope(data));
const total = (counts: Record<string, number>): number => Object.values(counts).reduce((sum, count) => sum + count, 0);

it('exports only portable library collections and round-trips their visible content', () => {
  const source = sample(); const backup = parseLibraryBackup(exportLibraryBackup(source));
  expect(Object.keys(backup).sort()).toEqual(['aliases', 'format', 'macros', 'routines', 'version', 'workspaces']);
  expect(JSON.stringify(backup)).not.toContain('Private suggestion');
  const result = mergeLibraryBackup(JSON.stringify(backup), empty());
  expect(result.preview.added).toEqual({ aliases: 1, macros: 1, routines: 1, workspaces: 1 });
  expect(result.state.library.aliases[0]).toEqual({ ...source.library.aliases[0], id: expect.any(String) });
  expect(result.state.routines[0]?.steps).toEqual(['Open work dashboard', 'Pin this tab']);
  expect(result.state.library.workspaces[0]?.tabs).toEqual(source.library.workspaces[0]?.tabs);
  expect(result.state.library.aliases[0]?.id).not.toBe(id(1));
  expect(result.state.macros[0]?.id).not.toBe(id(2)); expect(result.state.routines[0]?.id).not.toBe(id(3));
  expect(result.state.library.workspaces[0]?.id).not.toBe(id(4));
});
it('previews stable ordered additions without modifying saved collections or assigning IDs', () => {
  const source = sample(); const saved = empty(); const before = structuredClone(saved);
  const random = vi.spyOn(crypto, 'randomUUID');
  try {
    const json = exportLibraryBackup(source); const first = previewLibraryBackup(json, saved); const second = previewLibraryBackup(json, saved);
    expect(first).toEqual(second); expect(saved).toEqual(before); expect(random).not.toHaveBeenCalled();
    expect(first.entries).toMatchObject([
      { kind: 'aliases', name: 'Work dashboard', operation: 'add' }, { kind: 'macros', name: 'Daily sites', operation: 'add' },
      { kind: 'routines', name: 'Daily prep', operation: 'add' }, { kind: 'workspaces', name: 'Research desk', operation: 'add' },
    ]);
  } finally { random.mockRestore(); }
});
it('skips exact content on repeated import even though every imported ID changed', () => {
  const json = exportLibraryBackup(sample()); const first = mergeLibraryBackup(json, empty());
  const second = mergeLibraryBackup(json, first.state);
  expect(total(second.preview.added)).toBe(0); expect(total(second.preview.skipped)).toBe(4);
  expect(second.state).toEqual(first.state);
});
it('exports and round-trips existing website routines sharing a display name but using different phrases', () => {
  const source = sample(); source.macros.push({ ...source.macros[0]!, id: id(10), phrase: 'Open evening sites' });
  const imported = mergeLibraryBackup(exportLibraryBackup(source), empty());
  expect(imported.state.macros.map(macro => macro.name)).toEqual(['Daily sites', 'Daily sites']);
  expect(imported.state.macros.map(macro => macro.phrase)).toEqual(['Open my daily sites', 'Open evening sites']);
  const saved = sample();
  expect(previewLibraryBackup(text({ macros: [source.macros[1]!] }), saved).added.macros).toBe(1);
});
it('preserves workspace active-tab and distinct unnamed group metadata through portable import', () => {
  const source = sample(); const workspace = source.library.workspaces[0]!;
  workspace.activeTabIndex = 1;
  workspace.groups = [{ id: 'first', title: '', color: 'blue', collapsed: true }, { id: 'second', title: '', color: 'purple', collapsed: false }];
  workspace.tabs = workspace.tabs.map((tab, index) => ({ ...tab, pinned: false, groupId: index === 0 ? 'first' : 'second', group: '', color: index === 0 ? 'blue' : 'purple' }));
  const restored = mergeLibraryBackup(exportLibraryBackup(source), empty()).state.library.workspaces[0]!;
  expect(restored.id).not.toBe(workspace.id); expect(restored.activeTabIndex).toBe(1);
  expect(restored.groups).toEqual(workspace.groups); expect(restored.tabs).toEqual(workspace.tabs);
});
it('merges without overwriting saved items or clearing site suggestions', () => {
  const saved = sample(); const before = structuredClone(saved);
  const result = mergeLibraryBackup(text({ aliases: [{ id: id(10), name: 'Personal portal', url: 'https://personal.example/', searchUrl: '' }] }), saved);
  expect(saved).toEqual(before);
  expect(result.state.library.aliases).toHaveLength(2); expect(result.state.library.aliases[0]).toEqual(saved.library.aliases[0]);
  expect(result.state.library.suggestions).toEqual(saved.library.suggestions);
  expect(result.state.macros).toEqual(saved.macros); expect(result.state.routines).toEqual(saved.routines);
});
it.each(['settings', 'apiKey', 'logs', 'suggestions', 'voiceSetup'])('rejects unrecognized envelope field %s', field => {
  const backup = JSON.parse(exportLibraryBackup(sample())) as Record<string, unknown>; backup[field] = 'must not import';
  expect(() => parseLibraryBackup(JSON.stringify(backup))).toThrow('Unrecognized key');
});
it.each(['javascript:alert(1)', 'file:///tmp/private', 'https://user:secret@example.com/', 'chrome://settings/'])('rejects unsafe saved URLs: %s', url => {
  expect(() => parseLibraryBackup(text({ aliases: [{ id: id(1), name: 'Unsafe', url, searchUrl: '' }] }))).toThrow();
  expect(() => parseLibraryBackup(text({ macros: [{ ...sample().macros[0]!, urls: [url] }] }))).toThrow();
  expect(() => parseLibraryBackup(text({ workspaces: [{ ...sample().library.workspaces[0]!, tabs: [{ title: 'Unsafe', url, pinned: false }] }] }))).toThrow();
});
it('rejects unknown nested fields and invalid search templates', () => {
  const backup = JSON.parse(exportLibraryBackup(sample())) as { aliases: Record<string, unknown>[] };
  backup.aliases[0]!.password = 'hidden'; expect(() => parseLibraryBackup(JSON.stringify(backup))).toThrow('Unrecognized key');
  expect(() => parseLibraryBackup(text({ aliases: [{ ...sample().library.aliases[0]!, searchUrl: 'https://work.example/?q={query}&again={query}' }] }))).toThrow('exactly once');
});
it('rejects unsupported routine steps before treating saved IDs or names as duplicate candidates', () => {
  const saved = sample();
  const invalid = { ...saved.routines[0]!, steps: ['Install arbitrary software without asking'] };
  expect(() => previewLibraryBackup(text({ routines: [invalid] }), saved)).toThrow('Step 1');
});
it('rejects duplicate IDs within and across imported collection types', () => {
  const alias = sample().library.aliases[0]!;
  expect(() => parseLibraryBackup(text({ aliases: [alias, { ...alias, name: 'Other portal' }] }))).toThrow('repeats an ID');
  expect(() => parseLibraryBackup(text({ aliases: [alias], macros: [{ ...sample().macros[0]!, id: alias.id }] }))).toThrow('repeats an ID');
});
it('rejects normalized name and spoken phrase duplicates inside a backup', () => {
  const alias = sample().library.aliases[0]!; const macro = sample().macros[0]!;
  expect(() => parseLibraryBackup(text({ aliases: [alias, { ...alias, id: id(10), name: 'WORK—dashboard!' }] }))).toThrow('more than one site nickname');
  expect(() => parseLibraryBackup(text({ macros: [macro, { ...macro, id: id(11), name: 'Different name', phrase: 'Please open my daily sites!' }] }))).toThrow('repeats the spoken phrase');
});
it('rejects conflicts against saved IDs, normalized names, and spoken phrases', () => {
  const saved = sample(); const alias = saved.library.aliases[0]!; const macro = saved.macros[0]!;
  expect(() => previewLibraryBackup(text({ aliases: [{ ...alias, name: 'Different name', url: 'https://different.example/' }] }), saved)).toThrow('ID already held');
  expect(() => previewLibraryBackup(text({ aliases: [{ ...alias, id: id(10), name: 'WORK dashboard!', url: 'https://different.example/' }] }), saved)).toThrow('never overwritten');
  expect(() => previewLibraryBackup(text({ macros: [{ ...macro, id: id(11), name: 'Different name', phrase: 'Please open my daily sites' }] }), saved)).toThrow('spoken phrase');
});
it('rejects built-in site nicknames', () => {
  expect(() => parseLibraryBackup(text({ aliases: [{ ...sample().library.aliases[0]!, name: 'Google' }] }))).toThrow('built-in site');
});
it.each(['incoming macro', 'incoming routine'] as const)('checks macro/routine parameterized invocation collisions with an %s', direction => {
  const macro = { ...sample().macros[0]!, phrase: 'Research whales' };
  const routine = { ...sample().routines[0]!, name: 'Research', phrase: 'Research {topic}', steps: ['Search Wikipedia for {topic}'] };
  const saved = empty();
  if (direction === 'incoming macro') saved.routines = [routine]; else saved.macros = [macro];
  expect(() => previewLibraryBackup(text(direction === 'incoming macro' ? { macros: [macro] } : { routines: [routine] }), saved)).toThrow('same spoken command');
});
it('checks implicit routine-name invocations and overlapping routine input prefixes', () => {
  const routine = { ...sample().routines[0]!, name: 'Research', phrase: 'Research {topic}', steps: ['Search Wikipedia for {topic}'] };
  expect(() => parseLibraryBackup(text({ routines: [routine], macros: [{ ...sample().macros[0]!, phrase: 'Run research routine' }] }))).toThrow('same spoken command');
  expect(() => parseLibraryBackup(text({ routines: [routine, { ...routine, id: id(11), name: 'Research papers', phrase: 'Research papers {topic}' }] }))).toThrow('overlapping spoken commands');
});
it('checks collection capacity after duplicate skips and before adding new items', () => {
  const saved = empty(); saved.library.aliases = Array.from({ length: 100 }, (_, index) => ({ id: id(index + 100), name: `Portal ${index}`, url: `https://portal${index}.example/`, searchUrl: '' }));
  expect(previewLibraryBackup(text({ aliases: [saved.library.aliases[0]!] }), saved).skipped.aliases).toBe(1);
  expect(() => previewLibraryBackup(text({ aliases: [sample().library.aliases[0]!] }), saved)).toThrow('limit of 100');
});
it('enforces the 5 MiB limit on UTF-8 bytes instead of JavaScript character count', () => {
  const multibyte = '😀'.repeat(Math.floor(LIBRARY_BACKUP_MAX_BYTES / 4) + 1);
  expect(multibyte.length).toBeLessThan(LIBRARY_BACKUP_MAX_BYTES);
  expect(() => parseLibraryBackup(multibyte)).toThrow('larger than 5 MiB');
});
it('accepts a valid file exactly at the size boundary and rejects one more byte', () => {
  const json = text({ aliases: sample().library.aliases }).padEnd(LIBRARY_BACKUP_MAX_BYTES, ' ');
  expect(parseLibraryBackup(json).aliases).toHaveLength(1);
  expect(() => parseLibraryBackup(json + ' ')).toThrow('larger than 5 MiB');
});
it('gives clear errors for empty, malformed, and unsupported backup versions', () => {
  expect(() => exportLibraryBackup(empty())).toThrow('library is empty');
  expect(() => parseLibraryBackup(text({}))).toThrow('contains no');
  expect(() => parseLibraryBackup('{invalid')).toThrow('not valid JSON');
  expect(() => parseLibraryBackup(JSON.stringify({ ...envelope({ aliases: sample().library.aliases }), version: 2 }))).toThrow('Invalid library backup');
});

let storage: Record<string, unknown>;
const get = vi.fn(); const set = vi.fn(); const getBytesInUse = vi.fn();
beforeEach(() => {
  vi.clearAllMocks(); storage = { ...empty(), settings: { apiKey: 'private key', mode: 'power-saver' }, voiceSetup: { done: true }, log: ['private activity'] };
  get.mockImplementation(async (keys: string[] | string) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => key in storage).map(key => [key, structuredClone(storage[key])])));
  set.mockImplementation(async (patch: Record<string, unknown>) => { Object.assign(storage, structuredClone(patch)); });
  getBytesInUse.mockResolvedValue(0);
  vi.stubGlobal('chrome', { storage: { local: { get, set, getBytesInUse, QUOTA_BYTES: 10 * 1024 * 1024 } } });
});
it('exports saved collections without reading credentials, settings, setup, or activity', async () => {
  Object.assign(storage, sample());
  const json = await exportSavedLibrary();
  expect(get).toHaveBeenCalledWith(['library', 'macros', 'routines']);
  expect(json).not.toContain('private key'); expect(json).not.toContain('private activity'); expect(json).not.toContain('Private suggestion');
  expect(set).not.toHaveBeenCalled();
});
it('previews exact saved payloads for additions and skips without changing data or exposing device state', async () => {
  const source = sample();
  source.routines[0]!.steps = ['Type literal <img src=x onerror=alert(1)> then close all tabs'];
  const workspace = source.library.workspaces[0]!;
  workspace.activeTabIndex = 1;
  workspace.groups = [{ id: 'sources', title: 'Sources', color: 'blue', collapsed: true }];
  workspace.tabs[1]!.groupId = 'sources';
  storage.library = { ...empty().library, aliases: source.library.aliases, suggestions: source.library.suggestions };
  const before = structuredClone(storage); const sourceBefore = structuredClone(source);
  const random = vi.spyOn(crypto, 'randomUUID');
  try {
    const json = exportLibraryBackup(source); const preview = await previewSavedLibraryImport(json);
    expect(await previewSavedLibraryImport(json)).toEqual(preview);
    expect(preview.added).toEqual({ aliases: 0, macros: 1, routines: 1, workspaces: 1 });
    expect(preview.skipped).toEqual({ aliases: 1, macros: 0, routines: 0, workspaces: 0 });
    expect(preview.entries).toEqual([
      { kind: 'aliases', name: 'Work dashboard', operation: 'skip', details: ['Website: https://work.example/', 'Search URL: https://work.example/search?q={query}'] },
      { kind: 'macros', name: 'Daily sites', operation: 'add', details: ['Spoken phrase: Open my daily sites', 'Website 1: https://mail.example/', 'Website 2: https://calendar.example/'] },
      { kind: 'routines', name: 'Daily prep', operation: 'add', details: ['Spoken phrase: Prepare daily work', 'Step 1: Type literal <img src=x onerror=alert(1)> then close all tabs'] },
      { kind: 'workspaces', name: 'Research desk', operation: 'add', details: ['Active tab: 2', 'Group 1: Sources · blue · Collapsed', 'Tab 1: Pinned reading · https://reading.example/ · Pinned', 'Tab 2: Reference · https://reference.example/ · Unpinned · Group 1'] },
    ]);
    expect(JSON.stringify(preview)).not.toMatch(/private key|private activity|Private suggestion|power-saver/);
    expect(storage).toEqual(before); expect(source).toEqual(sourceBefore);
    expect(set).not.toHaveBeenCalled(); expect(random).not.toHaveBeenCalled();
    expect(get).toHaveBeenCalledWith(['library', 'macros', 'routines']);
  } finally { random.mockRestore(); }
});
it('round-trips distinct accented routine names accepted by the routine editor', async () => {
  const accented = { id: id(10), name: 'Résumé', phrase: 'Prepare my résumé', steps: ['Pin this tab'] };
  const plain = { id: id(11), name: 'Resume', phrase: 'Continue my work', steps: ['Mute this tab'] };
  await saveRoutine(accented); await saveRoutine(plain);
  const json = await exportSavedLibrary();
  expect(parseLibraryBackup(json).routines).toEqual([accented, plain]);
  expect(previewLibraryBackup(json, empty()).added.routines).toBe(2);
  const imported = mergeLibraryBackup(json, empty()).state;
  expect(imported.routines.map(routine => routine.name)).toEqual(['Résumé', 'Resume']);
  expect(imported.routines.map(routine => routine.steps)).toEqual([accented.steps, plain.steps]);
  const partial = empty(); partial.routines = [accented];
  expect(previewLibraryBackup(text({ routines: [plain] }), partial).added.routines).toBe(1);
  expect(mergeLibraryBackup(text({ routines: [plain] }), partial).state.routines).toHaveLength(2);
  const collision = { ...plain, name: 'RÉSUMÉ!' };
  await expect(saveRoutine(collision)).rejects.toThrow('already in use');
  expect(() => parseLibraryBackup(text({ routines: [accented, collision] }))).toThrow('more than one command routine');
  expect(() => previewLibraryBackup(text({ routines: [collision] }), partial)).toThrow('never overwritten');
});
it('imports all collections atomically with one storage write and preserves unrelated data', async () => {
  const beforeSettings = structuredClone(storage.settings);
  const preview = await previewSavedLibraryImport(exportLibraryBackup(sample())); expect(set).not.toHaveBeenCalled();
  const result = await importSavedLibrary(exportLibraryBackup(sample()));
  expect(result).toEqual(preview); expect(set).toHaveBeenCalledOnce();
  expect(Object.keys(set.mock.calls[0]![0]).sort()).toEqual(['library', 'macros', 'routines']);
  expect(storage.settings).toEqual(beforeSettings); expect(storage.log).toEqual(['private activity']); expect(storage.voiceSetup).toEqual({ done: true });
});
it('revalidates current saved data after preview and refuses a new conflict without writing', async () => {
  const json = exportLibraryBackup(sample()); await previewSavedLibraryImport(json);
  const changed = empty(); changed.library.aliases = [{ ...sample().library.aliases[0]!, id: id(15), url: 'https://newer.example/' }];
  Object.assign(storage, changed); const before = structuredClone(storage);
  await expect(importSavedLibrary(json)).rejects.toThrow('never overwritten');
  expect(set).not.toHaveBeenCalled(); expect(storage).toEqual(before);
});
it('does not write when importing an already imported backup', async () => {
  const json = exportLibraryBackup(sample()); await importSavedLibrary(json); set.mockClear();
  expect(total((await importSavedLibrary(json)).skipped)).toBe(4); expect(set).not.toHaveBeenCalled();
});
it('rejects insufficient quota before writing and preserves the current data', async () => {
  const before = structuredClone(storage);
  getBytesInUse.mockImplementation(async (keys: string[] | null) => keys === null ? 10 * 1024 * 1024 : 0);
  await expect(importSavedLibrary(exportLibraryBackup(sample()))).rejects.toThrow('not enough extension storage');
  expect(set).not.toHaveBeenCalled(); expect(storage).toEqual(before);
});
it('leaves stored data untouched if Chrome cannot check available quota', async () => {
  const before = structuredClone(storage); getBytesInUse.mockRejectedValueOnce(new Error('Unavailable'));
  await expect(importSavedLibrary(exportLibraryBackup(sample()))).rejects.toThrow('Nothing was imported');
  expect(set).not.toHaveBeenCalled(); expect(storage).toEqual(before);
});
it('surfaces an atomic storage failure without clearing or retrying saved collections', async () => {
  const before = structuredClone(storage); set.mockRejectedValueOnce(new Error('QUOTA_BYTES quota exceeded'));
  await expect(importSavedLibrary(exportLibraryBackup(sample()))).rejects.toThrow('current library is unchanged');
  expect(set).toHaveBeenCalledOnce(); expect(storage).toEqual(before);
});
it('rejects invalid or oversized imported content before any storage write', async () => {
  await expect(importSavedLibrary(text({ routines: [{ ...sample().routines[0]!, steps: ['Unsupported extension script'] }] }))).rejects.toThrow('Step 1');
  await expect(importSavedLibrary('x'.repeat(LIBRARY_BACKUP_MAX_BYTES + 1))).rejects.toThrow('5 MiB');
  expect(set).not.toHaveBeenCalled();
});
