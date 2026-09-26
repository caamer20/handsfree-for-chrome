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

test('places the caret around paragraph text and refuses a field changed during beforeinput', async ({ context, control, extensionId }) => {
  await context.route('https://handsfree.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Paragraph editing</title><div contenteditable="true" aria-label="Draft"><p>First <strong>line</strong></p><p>Second line</p></div><label>Notes<textarea>original</textarea></label><input aria-label="Other">' }));
  const page = await context.newPage(); await page.goto('https://handsfree.test/paragraphs');
  await activateExtension(page, extensionId); await page.bringToFront();
  await run(control, 'focus the Draft field');
  await run(control, 'move the cursor before text Second');
  expect(await page.evaluate(() => [getSelection()?.anchorNode?.textContent, getSelection()?.anchorOffset, getSelection()?.isCollapsed])).toEqual(['Second line', 0, true]);
  await run(control, 'move the cursor after text First');
  expect(await page.evaluate(() => [getSelection()?.anchorNode?.textContent, getSelection()?.anchorOffset])).toEqual(['First ', 5]);
  await run(control, 'type !'); await expect(page.locator('p').first()).toHaveText('First! line');
  await run(control, 'focus the Notes field');
  await page.locator('textarea').evaluate(el => {
    el.addEventListener('beforeinput', () => {
      (el as HTMLTextAreaElement).value = 'manual update'; (el as HTMLTextAreaElement).readOnly = true;
      document.querySelector<HTMLInputElement>('input')!.focus();
    }, { once: true });
  });
  await run(control, 'type must not be entered', 'error');
  await expect(page.locator('textarea')).toHaveValue('manual update');
  await expect(page.locator('input')).toBeFocused();
});

test('renders dictated line breaks and restores original paragraph nodes and listeners on undo', async ({ context, control, extensionId }) => {
  await context.route('https://handsfree.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Multiline dictation</title><style>[contenteditable]{font:16px/20px monospace;border:1px solid;width:400px}p{margin:0}</style><div contenteditable="true" aria-label="Draft"><p>Hello <strong>bright</strong></p><p>new <em>world</em></p></div>' }));
  const engine = await installSpeechFixture(control);
  const page = await context.newPage(); await page.goto('https://handsfree.test/multiline');
  await activateExtension(page, extensionId); await page.bringToFront();
  const field = page.locator('[contenteditable]'); const markup = await field.innerHTML();
  const original = await field.locator('strong').elementHandle();
  await original!.evaluate(node => node.addEventListener('click', () => { document.body.dataset.originalListener = 'fired'; }));
  await run(control, 'focus the Draft field'); await run(control, 'select all text');
  await message(control, { target: 'background', type: 'MICROPHONE_READY' });
  await message(control, { target: 'background', type: 'TOGGLE_LISTENING' });
  await emitSpeech(engine, 'start dictation'); await expect.poll(async () => !!(await state(control)).dictation).toBe(true);
  await emitSpeech(engine, 'one new line two new paragraph three new line');
  await expect(field.locator('br')).toHaveCount(5);
  const geometry = await field.evaluate(element => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT); const lines: { text: string; top: number }[] = [];
    for (let node; (node = walker.nextNode());) { if (!node.textContent) continue; const range = document.createRange(); range.selectNodeContents(node); lines.push({ text: node.textContent, top: range.getBoundingClientRect().top }); }
    return { height: element.getBoundingClientRect().height, lines };
  });
  expect(geometry.lines.map(line => line.text)).toEqual(['one', 'two', 'three']);
  expect(geometry.lines[1]!.top - geometry.lines[0]!.top).toBe(20);
  expect(geometry.lines[2]!.top - geometry.lines[1]!.top).toBe(40);
  expect(geometry.height).toBeGreaterThanOrEqual(100);
  await emitSpeech(engine, 'scratch that'); await expect(field).toHaveJSProperty('innerHTML', markup);
  expect(await original!.evaluate(node => node.isConnected && document.querySelector('strong') === node)).toBe(true);
  await original!.evaluate(node => (node as HTMLElement).click());
  await expect(page.locator('body')).toHaveAttribute('data-original-listener', 'fired');
  await emitSpeech(engine, 'stop dictation'); await expect.poll(async () => (await state(control)).dictation).toBeNull();
  await message(control, { target: 'background', type: 'INTERRUPT_COMMAND', stopListening: true });
  await engine.detach();
});

test('refuses dictation undo after the page reuses an original paragraph elsewhere', async ({ context, control, extensionId }) => {
  await context.route('https://handsfree.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Reused editor nodes</title><div contenteditable="true" aria-label="Draft"><p>first</p><p id="reused">second</p><p>third</p></div><aside></aside>' }));
  const engine = await installSpeechFixture(control); const page = await context.newPage(); await page.goto('https://handsfree.test/reused-editor');
  await activateExtension(page, extensionId); await page.bringToFront();
  const original = await page.locator('#reused').elementHandle();
  await run(control, 'focus the Draft field'); await run(control, 'select all text');
  await message(control, { target: 'background', type: 'MICROPHONE_READY' }); await message(control, { target: 'background', type: 'TOGGLE_LISTENING' });
  await emitSpeech(engine, 'start dictation'); await expect.poll(async () => !!(await state(control)).dictation).toBe(true);
  await emitSpeech(engine, 'replacement'); await expect(page.locator('[contenteditable]')).toHaveText('replacement');
  await original!.evaluate(node => { document.querySelector('aside')!.append(node); node.textContent = 'Reused page content'; });
  await emitSpeech(engine, 'scratch that'); await expect.poll(async () => (await state(control)).dictation).toBeNull();
  await expect(page.locator('[contenteditable]')).toHaveText('replacement'); await expect(page.locator('aside')).toHaveText('Reused page content');
  expect(await original!.evaluate(node => node.parentElement === document.querySelector('aside'))).toBe(true);
  await expect.poll(async () => (await state(control)).hud.phase).toBe('error');
  await message(control, { target: 'background', type: 'INTERRUPT_COMMAND', stopListening: true }); await engine.detach();
});
