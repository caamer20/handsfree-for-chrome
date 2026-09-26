import { test, expect, message, state } from './fixtures';
import { preapproveHost } from './permission-fixture';
import { emitSpeech, installSpeechFixture } from './speech-fixture';

test('requests only the blocked site and resumes after a preapproved native consent decision', async ({ control, context, worker, extensionId }) => {
  await context.route('https://handsfree.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Recovery fixture</title><label>Search<input type="search"></label><div style="height:3000px">Test page</div>' }));
  const page = await context.newPage(); await page.goto('https://handsfree.test/'); await page.bringToFront();
  await message(control, { target: 'background', type: 'RUN_TEXT', text: 'pin this tab then fill the search box with stars then open a new tab' });
  await expect.poll(async () => (await state(control)).recovery?.kind).toBe('site-access');
  expect((await state(control)).progress?.steps.map(step => step.status)).toEqual(['completed', 'failed', 'skipped']);
  await preapproveHost(context, extensionId, 'https://handsfree.test/*');
  await control.bringToFront();
  await control.locator('#recovery-allow-site').click();
  await expect(control.locator('#recovery-resume')).toBeVisible({ timeout: 15_000 });
  await control.locator('#recovery-resume').click();
  await expect.poll(async () => (await state(control)).hud.phase).toBe('success');
  await expect(page.locator('input')).toHaveValue('stars');
  expect((await worker.evaluate(() => chrome.permissions.getAll())).origins).toContain('https://handsfree.test/*');
});

test('blocks a retained numbered target after optional site access is revoked', async ({ control, context, worker, extensionId }) => {
  await context.route('https://handsfree.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Revocation fixture</title><button onclick="document.body.dataset.clicked = \'yes\'">Action</button>' }));
  const page = await context.newPage(); await page.goto('https://handsfree.test/'); await page.bringToFront();
  // Do not trigger the extension action: that would add a separate activeTab grant.
  await message(control, { target: 'background', type: 'RUN_TEXT', text: 'show links' });
  await expect.poll(async () => (await state(control)).recovery?.kind).toBe('site-access');
  await preapproveHost(context, extensionId, 'https://handsfree.test/*'); await control.bringToFront();
  await control.locator('#recovery-allow-site').click(); await expect(control.locator('#recovery-resume')).toBeVisible(); await control.locator('#recovery-resume').click();
  await expect.poll(async () => (await state(control)).hud.phase).toBe('success');
  await expect(page.locator('#handsfree-page-overlay')).toBeAttached();
  expect(await worker.evaluate(() => chrome.permissions.remove({ origins: ['https://handsfree.test/*'] }))).toBe(true);
  expect(await worker.evaluate(() => chrome.permissions.contains({ origins: ['https://handsfree.test/*'] }))).toBe(false);
  await page.bringToFront(); await message(control, { target: 'background', type: 'RUN_TEXT', text: 'click number one' });
  await expect.poll(async () => (await state(control)).recovery?.kind).toBe('site-access');
  await expect(page.locator('body')).not.toHaveAttribute('data-clicked');
});

test('stops dictated chunks after site access is revoked without changing the field', async ({ control, context, worker, extensionId }) => {
  await context.route('https://handsfree.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Dictation access</title><label>Notes<textarea></textarea></label>' }));
  const engine = await installSpeechFixture(control);
  const page = await context.newPage(); await page.goto('https://handsfree.test/dictation-access'); await page.bringToFront();
  await message(control, { target: 'background', type: 'RUN_TEXT', text: 'focus the Notes field' });
  await expect.poll(async () => (await state(control)).recovery?.kind).toBe('site-access');
  await preapproveHost(context, extensionId, 'https://handsfree.test/*'); await control.bringToFront();
  await control.locator('#recovery-allow-site').click(); await expect(control.locator('#recovery-resume')).toBeVisible(); await control.locator('#recovery-resume').click();
  await expect.poll(async () => (await state(control)).hud.phase).toBe('success'); await page.bringToFront();
  await message(control, { target: 'background', type: 'MICROPHONE_READY' }); await message(control, { target: 'background', type: 'TOGGLE_LISTENING' });
  await emitSpeech(engine, 'start dictation'); await expect.poll(async () => !!(await state(control)).dictation).toBe(true);
  await emitSpeech(engine, 'before removal'); await expect(page.locator('textarea')).toHaveValue('before removal');
  expect(await worker.evaluate(() => chrome.permissions.remove({ origins: ['https://handsfree.test/*'] }))).toBe(true);
  expect(await worker.evaluate(() => chrome.permissions.contains({ origins: ['https://handsfree.test/*'] }))).toBe(false);
  await emitSpeech(engine, 'must not enter after removal'); await expect.poll(async () => (await state(control)).dictation).toBeNull();
  await expect(page.locator('textarea')).toHaveValue('before removal');
  await message(control, { target: 'background', type: 'INTERRUPT_COMMAND', stopListening: true }); await engine.detach();
});
