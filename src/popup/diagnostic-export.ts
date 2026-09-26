import { buildDiagnosticReport, type DiagnosticReport } from '../common/diagnostic-report';
import { send, errorText } from '../common/messaging';
import { providerOrigin } from '../common/providers';
import { element as el } from './dom';

async function savedAccess(origin: string | undefined): Promise<DiagnosticReport['access']['currentWebsiteSavedGrant']> {
  if (!origin) return 'not-applicable';
  try { return await chrome.permissions.contains({ origins: [origin] }) ? 'allowed' : 'not-granted'; }
  catch { return 'unavailable'; }
}
async function microphonePermission(): Promise<DiagnosticReport['setup']['microphonePermission']> {
  try { return (await navigator.permissions.query({ name: 'microphone' as PermissionName })).state; }
  catch { return 'unavailable'; }
}
async function platformInfo(): Promise<chrome.runtime.PlatformInfo | undefined> {
  try { return await chrome.runtime.getPlatformInfo(); } catch { return undefined; }
}
export async function collectDiagnosticReport(): Promise<DiagnosticReport> {
  const reply = await send({ target: 'background', type: 'GET_STATE' });
  if (!reply.ok) throw new Error(reply.error);
  if (!reply.state) throw new Error('The extension status is unavailable. Try again.');
  const state = reply.state;
  let apiOrigin: string | undefined;
  if (state.settings.aiEnabled && state.settings.aiProvider !== 'local') {
    try { apiOrigin = providerOrigin(state.settings); } catch { /* Report unavailable configuration without its private endpoint. */ }
  }
  const [platform, microphoneAccess, siteAccess, providerAccess] = await Promise.all([
    platformInfo(), microphonePermission(),
    savedAccess(state.activeSiteOrigin),
    state.settings.aiEnabled && state.settings.aiProvider !== 'local' && !apiOrigin ? Promise.resolve('unavailable' as const) : savedAccess(apiOrigin),
  ]);
  return buildDiagnosticReport(state, { extensionVersion: chrome.runtime.getManifest().version, platform, userAgent: navigator.userAgent, microphonePermission: microphoneAccess, siteAccess, providerAccess });
}

export class DiagnosticExport {
  private pending = false;
  constructor(private prefix: string) {
    el(`${prefix}-export`).addEventListener('click', () => { void this.download(); });
  }
  private async download(): Promise<void> {
    if (this.pending) return;
    this.pending = true;
    const button = el<HTMLButtonElement>(`${this.prefix}-export`); button.disabled = true;
    const status = el(`${this.prefix}-export-status`); status.textContent = 'Preparing diagnostic report…';
    el(`${this.prefix}-report`).textContent = 'Preparing report…';
    try {
      const report = await collectDiagnosticReport();
      const json = JSON.stringify(report, null, 2);
      el(`${this.prefix}-report`).textContent = json;
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      try {
        const link = document.createElement('a'); link.href = url;
        link.download = `handsfree-diagnostics-${report.generatedAt.slice(0, 10)}.json`; link.click();
      } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
      status.textContent = 'Diagnostic report downloaded. You can inspect the report below before sharing it.';
    } catch (error) { el(`${this.prefix}-report`).textContent = 'No report was created.'; status.textContent = `Could not export diagnostics: ${errorText(error)}`; }
    finally { this.pending = false; button.disabled = false; }
  }
}
