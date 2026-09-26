import { test, expect, message, state, activateExtension } from './fixtures';
import { emitSpeech, installSpeechFixture } from './speech-fixture';
import type { Page } from '@playwright/test';

async function run(control: Page, text: string, phase = 'success'): Promise<void> {
  expect((await message(control, { target: 'background', type: 'RUN_TEXT', text })).ok).toBe(true);
  await expect.poll(async () => { const current = await state(control); return [current.transcript, current.hud.phase]; }).toEqual([text, phase]);
}

test('selects and replaces literal phrases and moves the caret in installed Chrome', async ({ context, control, extensionId }) => {
  await context.route('https://handsfree.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Writing</title><label>Notes<textarea>We study black holes today.</textarea></label><div contenteditable="true" role="textbox" aria-label="Draft">Hello <strong>bright</strong> world</div>' }));
  const page = await context.newPage(); await page.goto('https://handsfree.test/writing');
  await activateExtension(page, extensionId); await page.bringToFront();
  await run(control, 'focus the Notes field');
  await run(control, 'select text black holes');
  expect(await page.locator('textarea').evaluate(el => { const field = el as HTMLTextAreaElement; return field.value.slice(field.selectionStart, field.selectionEnd); })).toBe('black holes');
  await run(control, 'type neutron stars');
  await expect(page.locator('textarea')).toHaveValue('We study neutron stars today.');
  await run(control, 'replace text neutron stars with then close all tabs');
  await expect(page.locator('textarea')).toHaveValue('We study then close all tabs today.');
  await run(control, 'move the cursor to the start');
  expect(await page.locator('textarea').evaluate(el => { const field = el as HTMLTextAreaElement; return [field.selectionStart, field.selectionEnd]; })).toEqual([0, 0]);
  await run(control, 'move the cursor to the end');
  expect(await page.locator('textarea').evaluate(el => (el as HTMLTextAreaElement).selectionStart)).toBe('We study then close all tabs today.'.length);
  await run(control, 'fill Notes with cat cat');
  await run(control, 'replace text cat with dog', 'error');
  await expect(page.locator('textarea')).toHaveValue('cat cat');
  await run(control, 'focus the Draft field');
  await run(control, 'replace text bright world with quiet space');
  await expect(page.locator('[contenteditable]')).toHaveText('Hello quiet space');
});

test('dictates at the caret, corrects one phrase, and stops on a controlled editor rejection', async ({ context, control, extensionId }) => {
  await context.route('https://handsfree.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Dictation</title><label>Notes<textarea>old words</textarea></label>' }));
  const engine = await installSpeechFixture(control);
  const page = await context.newPage(); await page.goto('https://handsfree.test/dictation');
  await activateExtension(page, extensionId); await page.bringToFront();
  await run(control, 'focus the Notes field'); await run(control, 'select all text');
  await message(control, { target: 'background', type: 'MICROPHONE_READY' });
  await message(control, { target: 'background', type: 'TOGGLE_LISTENING' });
  await emitSpeech(engine, 'start dictation');
  await expect.poll(async () => !!(await state(control)).dictation).toBe(true);
  await emitSpeech(engine, 'new words'); await expect(page.locator('textarea')).toHaveValue('new words');
  await emitSpeech(engine, 'scratch that'); await expect(page.locator('textarea')).toHaveValue('old words');
  await emitSpeech(engine, 'literal scratch that'); await expect(page.locator('textarea')).toHaveValue('scratch that');
  await page.locator('textarea').evaluate(el => {
    el.addEventListener('input', () => { queueMicrotask(() => { (el as HTMLTextAreaElement).value = 'rejected by editor'; }); }, { once: true });
  });
  await emitSpeech(engine, 'more text');
  await expect.poll(async () => (await state(control)).dictation).toBeNull();
  await expect(page.locator('textarea')).toHaveValue('rejected by editor');
  await expect.poll(async () => (await state(control)).hud.text).toMatch(/changed|rejected/i);
  await message(control, { target: 'background', type: 'INTERRUPT_COMMAND', stopListening: true });
  await engine.detach();
});

test('keeps disabled fieldset buttons out of the clickable targets and resolves shadow labels', async ({ context, control, extensionId }) => {
  await context.route('https://handsfree.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Accessible controls</title><fieldset disabled><button>Send order</button></fieldset><button>Available</button><div id="host"></div><script>const root = document.querySelector("#host").attachShadow({mode:"open"});root.innerHTML = `<span id="label">Shadow notes</span><input aria-labelledby="label">`;</script>' }));
  const page = await context.newPage(); await page.goto('https://handsfree.test/controls');
  await activateExtension(page, extensionId); await page.bringToFront();
  await run(control, 'click Send order', 'error');
  await run(control, 'fill Shadow notes with accessible by voice');
  await expect(page.locator('#host input')).toHaveValue('accessible by voice');
});

test('opts into spoken punctuation through Settings and keeps literal escapes', async ({ context, control, extensionId }) => {
  await control.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(control.locator('#dictation-punctuation')).not.toBeChecked();
  await control.locator('#dictation-punctuation').check();
  await control.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await expect.poll(async () => (await state(control)).settings.dictationPunctuation).toBe(true);
  const engine = await installSpeechFixture(control);
  await context.route('https://handsfree.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Punctuation</title><label>Notes<textarea></textarea></label>' }));
  const page = await context.newPage(); await page.goto('https://handsfree.test/punctuation');
  await activateExtension(page, extensionId); await page.bringToFront();
  await run(control, 'focus the Notes field');
  await message(control, { target: 'background', type: 'MICROPHONE_READY' });
  await message(control, { target: 'background', type: 'TOGGLE_LISTENING' });
  await emitSpeech(engine, 'start dictation');
  await expect.poll(async () => !!(await state(control)).dictation).toBe(true);
  await emitSpeech(engine, 'Hello comma world period'); await expect(page.locator('textarea')).toHaveValue('Hello, world.');
  await emitSpeech(engine, 'scratch that'); await expect(page.locator('textarea')).toHaveValue('');
  await emitSpeech(engine, 'literal comma period'); await expect(page.locator('textarea')).toHaveValue('comma period');
  await emitSpeech(engine, 'stop dictation');
  await expect.poll(async () => (await state(control)).dictation).toBeNull();
  await message(control, { target: 'background', type: 'INTERRUPT_COMMAND', stopListening: true });
  await engine.detach();
});
