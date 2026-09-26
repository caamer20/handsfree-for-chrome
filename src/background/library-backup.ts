import { exportLibraryBackup, mergeLibraryBackup, parseLibraryBackupState, previewLibraryBackup, type LibraryBackupPreview, type LibraryBackupState } from '../common/library-backup';
import { withLibraryWrite } from './library-write';

const keys = ['library', 'macros', 'routines'];
async function latest(): Promise<LibraryBackupState> { return parseLibraryBackupState(await chrome.storage.local.get(keys)); }
export async function exportSavedLibrary(): Promise<string> { return exportLibraryBackup(await latest()); }
export async function previewSavedLibraryImport(text: string): Promise<LibraryBackupPreview> { return previewLibraryBackup(text, await latest()); }
export async function importSavedLibrary(text: string): Promise<LibraryBackupPreview> {
  return withLibraryWrite(async () => {
    // The preview is never treated as authority: re-read and validate the saved
    // collections immediately before building the single storage update.
    const { state, preview } = mergeLibraryBackup(text, await latest());
    if (!Object.values(preview.added).some(Boolean)) return preview;
    const patch = { library: state.library, macros: state.macros, routines: state.routines };
    const quota = chrome.storage.local.QUOTA_BYTES;
    if (quota && chrome.storage.local.getBytesInUse) {
      const [used, replaced] = await Promise.all([chrome.storage.local.getBytesInUse(null), chrome.storage.local.getBytesInUse(keys)]).catch(() => { throw new Error('Chrome could not check available extension storage. Nothing was imported; try again.'); });
      const nextBytes = Object.entries(patch).reduce((total, [key, value]) => total + new TextEncoder().encode(key + JSON.stringify(value)).byteLength, 0);
      if (used - replaced + nextBytes > quota) throw new Error('There is not enough extension storage for this backup. Remove some saved items or import a smaller backup. Your current library is unchanged.');
    }
    try { await chrome.storage.local.set(patch); }
    catch { throw new Error('Chrome could not save the imported library. Your current library is unchanged. Free extension storage and try again.'); }
    return preview;
  });
}
