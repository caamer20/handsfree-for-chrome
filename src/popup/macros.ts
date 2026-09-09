import { element as el } from './dom';
import { macroSchema, upsertMacro, MAX_MACROS, type Macro } from '../common/macros';
import type { Message } from '../common/schema';
import { errorText } from '../common/messaging';

export class MacrosPanel {
  private macros: Macro[] = [];
  private editingId: string | null = null;
  private deletingId: string | null = null;
  private busy = false;
  constructor(private perform: (message: Message) => Promise<boolean>, private showControl: () => void) {
    el('new-macro').addEventListener('click', () => this.edit());
    el('cancel-macro').addEventListener('click', () => this.closeEditor());
    el('macro-form').addEventListener('submit', event => { event.preventDefault(); void this.save(); });
  }
  render(macros: Macro[], busy: boolean): void {
    this.macros = macros; this.busy = busy;
    el('macro-count').textContent = `(${macros.length})`;
    el<HTMLButtonElement>('new-macro').disabled = busy || macros.length >= MAX_MACROS;
    el<HTMLButtonElement>('save-macro').disabled = busy;
    el('macro-empty').hidden = macros.length > 0 || !el('macro-form').hidden;
    const list = el('macro-list'); list.replaceChildren();
    for (const macro of macros) {
      const card = document.createElement('article'); card.className = 'macro-card';
      const heading = document.createElement('h3'); heading.textContent = macro.name;
      const phrase = document.createElement('p'); phrase.className = 'macro-phrase'; phrase.textContent = `“${macro.phrase}”`;
      const details = document.createElement('details');
      const summary = document.createElement('summary'); summary.textContent = `${macro.urls.length} site${macro.urls.length === 1 ? '' : 's'}`;
      const sites = document.createElement('ol'); sites.className = 'macro-sites';
      macro.urls.forEach(url => { const li = document.createElement('li'); li.textContent = url; sites.append(li); });
      details.append(summary, sites);
      const actions = document.createElement('div'); actions.className = 'button-row';
      const button = (text: string, handler: () => void, style = 'secondary'): HTMLButtonElement => {
        const node = document.createElement('button'); node.type = 'button'; node.className = style; node.textContent = text; node.disabled = busy; node.addEventListener('click', handler); return node;
      };
      actions.append(
        button('Run macro ↗', () => { void this.perform({ target: 'background', type: 'RUN_MACRO', id: macro.id }).then(ok => { if (ok) this.showControl(); }); }),
        button('Edit', () => this.edit(macro)),
        button('Delete', () => { this.deletingId = macro.id; this.render(this.macros, this.busy); }, 'text-button'),
      );
      card.append(heading, phrase, details, actions);
      if (this.deletingId === macro.id) {
        const confirmation = document.createElement('div'); confirmation.className = 'macro-delete';
        const label = document.createElement('p'); label.textContent = `Delete “${macro.name}” and its saved sites?`;
        confirmation.append(label, button('Delete macro', () => { void this.remove(macro); }, 'secondary danger-button'), button('Keep it', () => { this.deletingId = null; this.render(this.macros, this.busy); }));
        card.append(confirmation);
      }
      list.append(card);
    }
  }
  private edit(macro?: Macro): void {
    this.editingId = macro?.id ?? null;
    el('macro-form').hidden = false;
    el('macro-empty').hidden = true;
    el('macro-editor-title').textContent = macro ? 'Edit macro' : 'New macro';
    el('save-macro').textContent = macro ? 'Save changes' : 'Save macro';
    el<HTMLInputElement>('macro-name').value = macro?.name ?? '';
    el<HTMLInputElement>('macro-phrase').value = macro?.phrase ?? '';
    el<HTMLTextAreaElement>('macro-sites').value = macro?.urls.join('\n') ?? '';
    el('macro-status').textContent = '';
    el('macro-status').classList.remove('error-message');
    el<HTMLInputElement>('macro-name').focus();
  }
  private closeEditor(): void {
    el<HTMLFormElement>('macro-form').reset(); el('macro-form').hidden = true; this.editingId = null;
    el('macro-empty').hidden = this.macros.length > 0;
  }
  private async save(): Promise<void> {
    if (this.busy) return;
    try {
      const macro = macroSchema.parse({
        id: this.editingId ?? crypto.randomUUID(), name: el<HTMLInputElement>('macro-name').value,
        phrase: el<HTMLInputElement>('macro-phrase').value,
        urls: el<HTMLTextAreaElement>('macro-sites').value.split(/\r?\n/).map(line => line.trim()).filter(Boolean),
      });
      upsertMacro(this.macros, macro); // Fast field/phrase feedback; worker also validates against latest storage.
      if (await this.perform({ target: 'background', type: 'SAVE_MACRO', macro })) {
        el('macro-status').classList.remove('error-message');
        this.closeEditor(); el('macro-status').textContent = `Saved “${macro.name}”. Say “${macro.phrase}” to run it.`;
      }
    } catch (error) { el('macro-status').classList.add('error-message'); el('macro-status').textContent = errorText(error); }
  }
  private async remove(macro: Macro): Promise<void> {
    if (await this.perform({ target: 'background', type: 'DELETE_MACRO', id: macro.id })) {
      this.deletingId = null;
      if (this.editingId === macro.id) this.closeEditor();
      el('macro-status').classList.remove('error-message');
      el('macro-status').textContent = `Deleted “${macro.name}”.`;
    }
  }
}
