import { element as el } from './dom';
import { send, errorText } from '../common/messaging';
import type { Message } from '../common/schema';
import type { LibraryBackupPreview } from '../common/library-backup';

export class LibraryBackupPanel {
  private json: string | undefined;
  private processing = false;
  private busy = false;
  private hasAdditions = false;

  constructor(private perform: (message: Message) => Promise<boolean>) {
    el('export-library').addEventListener('click', () => { void this.export(); });
    el('import-library').addEventListener('change', () => { void this.preview(); });
    el('cancel-library-import').addEventListener('click', () => this.clear());
    el('confirm-library-import').addEventListener('click', () => { void this.import(); });
  }
  render(busy: boolean): void {
    this.busy = busy;
    el<HTMLButtonElement>('export-library').disabled = this.processing;
    el<HTMLInputElement>('import-library').disabled = busy || this.processing;
    el<HTMLButtonElement>('confirm-library-import').disabled = busy || this.processing || !this.json || !this.hasAdditions;
    el<HTMLButtonElement>('cancel-library-import').disabled = this.processing;
  }
  private status(text: string): void { el('library-backup-status').textContent = text; }
  private clear(): void {
    this.json = undefined; this.hasAdditions = false;
    el('library-import-review').hidden = true;
    el<HTMLInputElement>('import-library').value = '';
    this.render(this.busy);
  }
  private async export(): Promise<void> {
    if (this.processing) return;
    this.processing = true; this.status('Preparing your library…'); this.render(this.busy);
    try {
      const reply = await send({ target: 'background', type: 'EXPORT_LIBRARY_BACKUP' });
      if (!reply.ok) throw new Error(reply.error);
      if (!reply.backupJson) throw new Error('No library file was returned. Try exporting again.');
      const url = URL.createObjectURL(new Blob([reply.backupJson], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = `handsfree-library-${new Date().toISOString().slice(0, 10)}.json`;
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      this.status('Library exported. The file includes saved URLs and command steps, without API keys or permissions.');
    } catch (error) { this.status(errorText(error)); }
    finally { this.processing = false; this.render(this.busy); }
  }
  private showPreview(preview: LibraryBackupPreview): void {
    const total = Object.values(preview.added).reduce((sum, count) => sum + count, 0);
    const skipped = Object.values(preview.skipped).reduce((sum, count) => sum + count, 0);
    this.hasAdditions = total > 0;
    el('library-import-summary').textContent = `${total} item${total === 1 ? '' : 's'} to add${skipped ? ` · ${skipped} already saved` : ''}. Existing entries stay unchanged.`;
    const list = el('library-import-list'); list.replaceChildren();
    const labels = { aliases: 'Site nickname', macros: 'Website routine', routines: 'Command routine', workspaces: 'Workspace' };
    for (const entry of preview.entries) {
      const row = document.createElement('li');
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = `${entry.operation === 'add' ? 'Add' : 'Already saved'} · ${labels[entry.kind]} · ${entry.name}`;
      const contents = document.createElement('ul'); contents.className = 'macro-sites';
      for (const text of entry.details) {
        const item = document.createElement('li'); item.textContent = text; contents.append(item);
      }
      details.append(summary, contents); row.append(details); list.append(row);
    }
    el('library-import-review').hidden = false;
  }
  private async preview(): Promise<void> {
    if (this.processing || this.busy) return;
    const file = el<HTMLInputElement>('import-library').files?.[0]; if (!file) return;
    this.clear(); this.processing = true; this.status('Checking the library file…'); this.render(this.busy);
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('Choose a library file no larger than 5 MiB.');
      const json = await file.text();
      const reply = await send({ target: 'background', type: 'PREVIEW_LIBRARY_BACKUP', json });
      if (!reply.ok) throw new Error(reply.error);
      if (!reply.backupPreview) throw new Error('The library preview was unavailable. Choose the file again.');
      this.json = json; this.showPreview(reply.backupPreview);
      this.status(this.hasAdditions ? 'Review the items below, then choose Add to library.' : 'Everything in this file is already saved.');
    } catch (error) { this.clear(); this.status(errorText(error)); }
    finally { this.processing = false; this.render(this.busy); }
  }
  private async import(): Promise<void> {
    if (!this.json || this.processing || this.busy || !this.hasAdditions) return;
    this.processing = true; this.status('Adding the reviewed library items…'); this.render(this.busy);
    try {
      const ok = await this.perform({ target: 'background', type: 'IMPORT_LIBRARY_BACKUP', json: this.json });
      if (ok) { this.clear(); this.status('Library imported. Review saved command steps before running them.'); }
      else this.status('The library was not imported. Check the error below; saved entries were kept.');
    } catch (error) { this.status(errorText(error)); }
    finally { this.processing = false; this.render(this.busy); }
  }
}
