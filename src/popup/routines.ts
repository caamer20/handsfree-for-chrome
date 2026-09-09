import { element as el } from './dom';
import { routineSchema, type Routine } from '../common/routine-schema';
import { compileRoutine, routineInputs, exportRoutines, importRoutines, moveRoutineStep } from '../common/routines';
import { describeAction } from '../common/action-labels';
import { errorText } from '../common/messaging';
import type { Message } from '../common/schema';

export class RoutinesPanel {
  private saved: Routine[] = [];
  private imported: Routine[] = [];
  private dragging: number | null = null;
  private editingId: string | null = null;
  constructor(private perform: (message: Message) => Promise<boolean>, private showControl: () => void) {
    el('export-routines').addEventListener('click', () => this.export());
    el('import-routines').addEventListener('change', () => { void this.import(); });
    el('confirm-routine-import').addEventListener('click', () => {
      void this.perform({ target: 'background', type: 'IMPORT_ROUTINES', routines: this.imported }).then(ok => { if (ok) { this.imported = []; el('routine-import-review').hidden = true; el('routine-status').textContent = 'Routines imported. Review their steps before running them.'; } });
    });
    el('cancel-routine-import').addEventListener('click', () => { this.imported = []; el('routine-import-review').hidden = true; });
    el('new-routine').addEventListener('click', () => this.edit());
    el('cancel-routine').addEventListener('click', () => { el('routine-form').hidden = true; this.editingId = null; });
    el('routine-form').addEventListener('input', () => this.preview());
    el('routine-form').addEventListener('submit', event => { event.preventDefault(); void this.save(); });
    const presets = [
      { name: 'Focused reading', phrase: 'Set up focused reading', steps: ['Mute other tabs', 'Zoom to 125 percent', 'Scroll to the top'] },
      { name: 'Research starter', phrase: 'Research {topic}', steps: ['Search Wikipedia for {topic}', 'Wait for the page to load', 'Pin this tab'] },
      { name: 'Prepare a search', phrase: 'Prepare my search', steps: ['Open Google', 'Wait for the page to load', 'Wait for the search field', 'Focus the search box'] },
    ];
    for (const preset of presets) {
      const button = document.createElement('button'); button.className = 'secondary'; button.textContent = preset.name;
      button.addEventListener('click', () => this.edit({ ...preset, id: crypto.randomUUID() })); el('routine-presets').append(button);
    }
  }
  render(routines: Routine[], busy: boolean): void {
    this.saved = routines; el<HTMLButtonElement>('export-routines').disabled = !routines.length;
    el<HTMLInputElement>('import-routines').disabled = busy; el<HTMLButtonElement>('confirm-routine-import').disabled = busy;
    el('routine-count').textContent = `(${routines.length}/50)`;
    const list = el('routine-list'); list.replaceChildren();
    el('routine-empty').hidden = routines.length > 0;
    for (const routine of routines) {
      const card = document.createElement('article'); card.className = 'macro-card';
      const heading = document.createElement('h3'); heading.textContent = routine.name;
      const phrase = document.createElement('p'); phrase.textContent = `Say “${routine.phrase}”`;
      const details = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = `${routine.steps.length} steps`; details.append(summary);
      const steps = document.createElement('ol'); steps.className = 'macro-sites';
      for (const text of routine.steps) { const li = document.createElement('li'); li.textContent = text; steps.append(li); }
      details.append(steps);
      const actions = document.createElement('div'); actions.className = 'button-row';
      for (const [label, action] of [
        ['Preview & run', () => { void this.perform({ target: 'background', type: 'RUN_ROUTINE', id: routine.id }).then(ok => { if (ok) this.showControl(); }); }],
        ['Edit', () => this.edit(routine)],
        ['Delete', () => { void this.perform({ target: 'background', type: 'DELETE_ROUTINE', id: routine.id }); }],
      ] as const) { const button = document.createElement('button'); button.className = 'secondary'; button.textContent = label; button.disabled = busy; button.addEventListener('click', action); actions.append(button); }
      card.append(heading, phrase, details, actions); list.append(card);
    }
  }
  private edit(routine?: Routine): void {
    this.editingId = routine?.id ?? null;
    el('routine-form').hidden = false;
    el('routine-heading').textContent = routine ? 'Edit routine' : 'New routine';
    el<HTMLInputElement>('routine-name').value = routine?.name ?? '';
    el<HTMLInputElement>('routine-phrase').value = routine?.phrase ?? '';
    el<HTMLTextAreaElement>('routine-steps').value = routine?.steps.join('\n') ?? '';
    el('routine-status').textContent = '';
    this.preview(); el<HTMLInputElement>('routine-name').focus();
  }
  private draft(): Routine {
    return routineSchema.parse({ id: this.editingId ?? crypto.randomUUID(), name: el<HTMLInputElement>('routine-name').value, phrase: el<HTMLInputElement>('routine-phrase').value, steps: el<HTMLTextAreaElement>('routine-steps').value.split('\n').map(line => line.trim()).filter(Boolean) });
  }
  private preview(): void {
    const list = el('routine-preview'); list.replaceChildren();
    const status = el('routine-validation'); this.reorder();
    if (!el<HTMLInputElement>('routine-name').value || !el<HTMLInputElement>('routine-phrase').value || !el<HTMLTextAreaElement>('routine-steps').value.trim()) { status.textContent = 'Add a name, spoken phrase, and steps to preview this routine.'; return; }
    try {
      const actions = compileRoutine(this.draft());
      for (const action of actions) { const li = document.createElement('li'); li.textContent = describeAction(action); list.append(li); }
      status.textContent = `${actions.length} of 8 actions. ${routineInputs(this.draft()).length ? 'Inputs: ' + routineInputs(this.draft()).join(', ') + '. ' : ''}Ready to save.`;
    } catch (error) { status.textContent = errorText(error); }
  }

  private reorder(): void {
    const list = el('routine-order'); list.replaceChildren();
    const steps = el<HTMLTextAreaElement>('routine-steps').value.split('\n').map(line => line.trim()).filter(Boolean);
    const move = (from: number, to: number): void => { el<HTMLTextAreaElement>('routine-steps').value = moveRoutineStep(steps, from, to).join('\n'); this.preview(); };
    steps.forEach((text, index) => {
      const row = document.createElement('li'); row.draggable = true; row.className = 'routine-step';
      const label = document.createElement('span'); label.textContent = `${index + 1}. ${text}`; row.append(label);
      row.addEventListener('dragstart', event => { this.dragging = index; event.dataTransfer?.setData('text/plain', String(index)); if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'; });
      row.addEventListener('dragover', event => { if (this.dragging !== null) event.preventDefault(); });
      row.addEventListener('drop', event => { event.preventDefault(); if (this.dragging !== null) move(this.dragging, index); this.dragging = null; });
      row.addEventListener('dragend', () => { this.dragging = null; });
      for (const [caption, offset] of [['↑', -1], ['↓', 1]] as const) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary'; button.textContent = caption;
        button.setAttribute('aria-label', `Move step ${index + 1} ${offset < 0 ? 'up' : 'down'}`); button.disabled = index + offset < 0 || index + offset >= steps.length;
        button.addEventListener('click', () => move(index, index + offset)); row.append(button);
      }
      list.append(row);
    });
  }
  private export(): void {
    try {
      const url = URL.createObjectURL(new Blob([exportRoutines(this.saved)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = 'handsfree-routines.json'; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      el('routine-status').textContent = 'Exported routine templates. API keys and run inputs are not included.';
    } catch (error) { el('routine-status').textContent = errorText(error); }
  }
  private async import(): Promise<void> {
    const input = el<HTMLInputElement>('import-routines'); const file = input.files?.[0]; input.value = ''; if (!file) return;
    this.imported = []; el('routine-import-review').hidden = true;
    try {
      if (file.size > 250_000) throw new Error('Choose a routine file smaller than 250 KB.');
      this.imported = importRoutines(await file.text());
      const list = el('routine-import-list'); list.replaceChildren();
      for (const routine of this.imported) { const item = document.createElement('li'); item.textContent = `${routine.name}: ${routine.steps.join(' → ')}`; list.append(item); }
      el('routine-import-review').hidden = false;
    } catch (error) { el('routine-status').textContent = `Import failed: ${errorText(error)}`; }
  }
  private async save(): Promise<void> {
    try {
      const routine = this.draft(); compileRoutine(routine);
      if (await this.perform({ target: 'background', type: 'SAVE_ROUTINE', routine })) {
        el('routine-form').hidden = true; this.editingId = null;
        el('routine-status').textContent = `Saved “${routine.name}”. Say “${routine.phrase}”, or “run ${routine.name} routine”.`;
      }
    } catch (error) { el('routine-validation').textContent = errorText(error); }
  }
}
