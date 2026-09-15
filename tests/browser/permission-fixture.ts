import type { BrowserContext } from '@playwright/test';

/** Seed the native consent decision in a disposable profile, using Chrome Settings' API.
 * The extension must still request the optional permission through its real UI.
 * This does not certify the native consent dialog or OS permission UI.
 * Source: chromium/chromium chrome/browser/resources/extensions/service.ts.
 */
export async function preapproveHost(context: BrowserContext, extensionId: string, origin: string): Promise<void> {
  const settings = await context.newPage();
  try {
    await settings.goto('chrome://extensions/');
    await settings.evaluate(async ({ id, host }) => {
      const api = chrome as unknown as { developerPrivate: { addHostPermission(id: string, host: string): Promise<void> } };
      await api.developerPrivate.addHostPermission(id, host);
    }, { id: extensionId, host: origin });
  } finally { await settings.close(); }
}
