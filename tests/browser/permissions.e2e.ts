import { test, expect, message, state } from './fixtures';
import { preapproveHost } from './permission-fixture';

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
