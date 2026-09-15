import { test as base, chromium, expect, type BrowserContext, type Worker, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import type { Message } from '../../src/common/schema';
import type { Reply } from '../../src/common/types';

export const test = base.extend<{ context: BrowserContext; extensionId: string; worker: Worker; control: Page; mediaPermission: 'allow' | 'prompt'; extensionPath: string; profilePath: string }>({
  mediaPermission: ['prompt', { option: true }],
  profilePath: ['', { option: true }],
  extensionPath: [resolve(process.env.HANDSFREE_TEST_BUILD ?? 'dist'), { option: true }],
  context: async ({ headless, mediaPermission, extensionPath: extension, profilePath }, use) => {
    const context = await chromium.launchPersistentContext(profilePath, {
      channel: 'chromium', headless,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--enable-unsafe-extension-debugging', '--use-fake-device-for-media-stream', ...(mediaPermission === 'allow' ? ['--use-fake-ui-for-media-stream'] : [])],
    });
    try { await use(context); } finally { await context.close(); }
  },
  worker: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    await use(worker);
  },
  extensionId: async ({ worker }, use) => { await use(new URL(worker.url()).host); },
  control: async ({ context, extensionId }, use) => {
    // onInstalled opens this page only after storage/session initialization.
    // Wait before creating controls so a late welcome tab cannot steal focus.
    await expect.poll(() => context.pages().some(page => page.url().endsWith('/onboarding.html'))).toBe(true);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
    await expect(page.locator('#listen')).toContainText('Set up microphone');
    await page.bringToFront();
    await use(page);
  },
});
export { expect };
export async function message(page: Page, request: Message): Promise<Reply> {
  return page.evaluate(async value => chrome.runtime.sendMessage(value), request) as Promise<Reply>;
}
export async function state(page: Page) {
  const reply = await message(page, { target: 'background', type: 'GET_STATE' });
  if (!reply.ok || !reply.state) throw new Error(reply.ok ? 'Missing extension state' : reply.error);
  return reply.state;
}
/** Exercise Chrome's normal action gesture, including its temporary activeTab grant. */
export async function activateExtension(page: Page, extensionId: string): Promise<void> {
  await page.bringToFront();
  const browser = page.context().browser(); if (!browser) throw new Error('This test requires a locally launched Chromium browser.');
  const browserConnection = await browser.newBrowserCDPSession();
  try {
    // CDP distinguishes a browser tab from its child page target. This command needs the former.
    const { targetInfos } = await browserConnection.send('Target.getTargets', { filter: [{ type: 'tab' }] });
    const target = targetInfos.find(info => info.type === 'tab' && info.url === page.url());
    if (!target) throw new Error(`No Chrome tab target for ${page.url()}`);
    await browserConnection.send('Extensions.triggerAction', { id: extensionId, targetId: target.targetId });
  } finally { await browserConnection.detach(); }
}
