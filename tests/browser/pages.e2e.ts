import { test, expect, message, state, activateExtension } from './fixtures';

test('edits a real page using the temporary grant from Chrome’s extension action', async ({ context, control, extensionId }) => {
  await context.route('https://handsfree.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Form fixture</title><label>Search<input type="search"></label>' }));
  const page = await context.newPage(); await page.goto('https://handsfree.test/');
  await activateExtension(page, extensionId);
  await message(control, { target: 'background', type: 'RUN_TEXT', text: 'fill the search box with black holes' });
  await expect.poll(async () => (await state(control)).hud.phase).toBe('success');
  await expect(page.locator('input')).toHaveValue('black holes');
});
