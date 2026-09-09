// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest';
import { RoutinesPanel } from '../src/popup/routines';
const perform = vi.fn(async () => true);
beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '<button id="new-routine"></button><button id="cancel-routine"></button><button id="export-routines"></button><input type="file" id="import-routines"><button id="confirm-routine-import"></button><button id="cancel-routine-import"></button><div id="routine-import-review" hidden><ol id="routine-import-list"></ol></div><div id="routine-count"></div><div id="routine-list"></div><div id="routine-empty"></div><div id="routine-presets"></div><form id="routine-form"><h3 id="routine-heading"></h3><input id="routine-name"><input id="routine-phrase"><textarea id="routine-steps"></textarea><ol id="routine-order"></ol><ol id="routine-preview"></ol><p id="routine-validation"></p></form><p id="routine-status"></p>';
  const panel = new RoutinesPanel(perform, vi.fn()); panel.render([], false);
  document.querySelectorAll<HTMLButtonElement>('#routine-presets button')[1]!.click();
});
it('uses actual drag and drop handlers to reorder the draft and action preview', () => {
  const rows = document.querySelectorAll('#routine-order li');
  const drag = new Event('dragstart', { bubbles: true }); Object.defineProperty(drag, 'dataTransfer', { value: { setData: vi.fn(), effectAllowed: '' } });
  rows[2]!.dispatchEvent(drag); rows[0]!.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));
  expect(document.querySelector<HTMLTextAreaElement>('#routine-steps')!.value.split('\n')[0]).toBe('Pin this tab');
  expect(document.querySelector('#routine-preview li')!.textContent).toBe('Pin tab'); expect(perform).not.toHaveBeenCalled();
});
it('moves a step with the keyboard-accessible buttons and saves only the new order', async () => {
  document.querySelector<HTMLButtonElement>('[aria-label="Move step 3 up"]')!.click();
  document.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
  await Promise.resolve();
  expect(perform).toHaveBeenCalledWith(expect.objectContaining({ type: 'SAVE_ROUTINE', routine: expect.objectContaining({ steps: ['Search Wikipedia for {topic}', 'Pin this tab', 'Wait for the page to load'] }) }));
});
it('validates and previews an import before saving anything', async () => {
  const fixture = { format: 'handsfree-routines', version: 1, routines: [{ id: crypto.randomUUID(), name: 'Test import', phrase: 'Do my test', steps: ['Pin this tab'] }] };
  const input = document.querySelector<HTMLInputElement>('#import-routines')!;
  Object.defineProperty(input, 'files', { configurable: true, value: [new File([JSON.stringify(fixture)], 'routines.json', { type: 'application/json' })] });
  input.dispatchEvent(new Event('change'));
  await vi.waitFor(() => expect(document.getElementById('routine-import-review')!.hidden).toBe(false));
  expect(document.getElementById('routine-import-list')!.textContent).toContain('Test import'); expect(perform).not.toHaveBeenCalled();
  document.querySelector<HTMLButtonElement>('#confirm-routine-import')!.click(); await Promise.resolve();
  expect(perform).toHaveBeenCalledWith(expect.objectContaining({ type: 'IMPORT_ROUTINES', routines: [expect.objectContaining({ name: 'Test import' })] }));
});
