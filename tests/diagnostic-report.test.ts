import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { buildDiagnosticReport, diagnosticReportSchema, type DiagnosticEnvironment } from '../src/common/diagnostic-report';
import { collectDiagnosticReport } from '../src/popup/diagnostic-export';
import { defaultSettings } from '../src/common/schema';
import type { AppState } from '../src/common/types';

const baseline = (): AppState => ({ settings: { ...defaultSettings }, macros: [], routines: [], library: { aliases: [], workspaces: [], suggestions: [] }, hud: { phase: 'idle', text: 'Ready' }, log: [], pending: null, shortcut: 'Ctrl+Shift+Space', engineOpen: false, listening: false, hasApiKey: false, localAiAvailable: false });
const environment: DiagnosticEnvironment = { extensionVersion: '1.9.0', platform: { os: 'mac' as chrome.runtime.PlatformOs, arch: 'x86-64' as chrome.runtime.PlatformArch }, userAgent: 'Mozilla/5.0 (PRIVATE DEVICE DETAILS) Chrome/153.0.8010.12 Safari/537.36', microphonePermission: 'prompt', siteAccess: 'not-granted', providerAccess: 'not-applicable' };
const now = new Date('2026-09-26T10:00:00.000Z');

it('exports a versioned status snapshot with useful flags and no freeform browser metadata', () => {
  const state = baseline();
  const report = buildDiagnosticReport(state, environment, now);
  expect(report).toMatchObject({ format: 'handsfree-diagnostics', version: 1, generatedAt: now.toISOString(), extension: { version: '1.9.0', edition: 'standard' }, environment: { os: 'mac', arch: 'x86-64', chromiumVersion: '153.0.8010.12' }, setup: { shortcutAssigned: true, microphonePermission: 'prompt' }, access: { currentWebsiteSavedGrant: 'not-granted' }, runtime: { engineOpen: false, phase: 'idle', issueCategory: null }, savedItemCounts: { workspaces: 0 } });
  expect(JSON.stringify(report)).not.toContain('PRIVATE DEVICE DETAILS');
  expect(report.preferences).not.toHaveProperty('triggerPhrase');
  expect(report.preferences).not.toHaveProperty('siteDefaults');
});

it('excludes credentials, URLs, transcripts, library contents, page references, errors and raw prompt text', () => {
  const secret = 'PRIVATE-FIXTURE'; const state = baseline();
  state.settings = { ...state.settings, triggerPhrase: secret, aiBaseUrl: `https://${secret}.test/v1`, aiModel: secret, siteDefaults: { email: secret } };
  state.hud = { phase: 'error', text: `Network error on https://${secret}.test with key ${secret}` };
  state.transcript = secret; state.activeTabTitle = secret; state.activeSiteOrigin = `https://${secret}.test/*`;
  state.macros = [{ id: crypto.randomUUID(), name: secret, phrase: secret, urls: [`https://${secret}.test/`] }];
  state.routines = [{ id: crypto.randomUUID(), name: secret, phrase: secret, steps: [`type ${secret}`] }];
  state.library!.aliases = [{ id: crypto.randomUUID(), name: secret, url: `https://${secret}.test/`, searchUrl: '' }];
  state.library!.workspaces = [{ id: crypto.randomUUID(), name: secret, createdAt: 1, tabs: [{ title: secret, url: `https://${secret}.test/`, pinned: false }] }];
  state.log = [{ id: secret, at: 1, text: secret, transcript: secret, ok: false }];
  state.contextTargets = [{ id: 42, windowId: 43, title: secret, url: `https://${secret}.test/` }];
  Object.assign(state, { futurePrivateField: secret, apiKey: secret });
  const unchanged = JSON.stringify(state); const report = buildDiagnosticReport(state, environment, now);
  expect(JSON.stringify(report)).not.toContain(secret);
  expect(report.savedItemCounts).toEqual({ siteNicknames: 1, websiteRoutines: 1, commandRoutines: 1, workspaces: 1 });
  expect(report.runtime.issueCategory).toBe('ai-configuration');
  expect(JSON.stringify(state)).toBe(unchanged);
});

it('reports unavailable platform and browser data without copying arbitrary metadata', () => {
  const report = buildDiagnosticReport(baseline(), { ...environment, platform: { os: 'private-machine', arch: 'private-processor' } as unknown as DiagnosticEnvironment['platform'], userAgent: 'private-custom-browser' }, now);
  expect(report.environment).toEqual({ os: 'unknown', arch: 'unknown', chromiumVersion: null });
});
it('refuses accidental extra fields in the portable report schema', () => {
  const report = buildDiagnosticReport(baseline(), environment, now);
  expect(diagnosticReportSchema.safeParse({ ...report, transcript: 'private' }).success).toBe(false);
  expect(diagnosticReportSchema.safeParse({ ...report, runtime: { ...report.runtime, key: 'private' } }).success).toBe(false);
});

let state: AppState;
const sendMessage = vi.fn(); const contains = vi.fn(); const getPlatformInfo = vi.fn(); const queryPermission = vi.fn(); const getUserMedia = vi.fn(); const requestPermission = vi.fn(); const fetchMock = vi.fn(); const setStorage = vi.fn();
beforeEach(() => {
  vi.clearAllMocks(); state = baseline();
  sendMessage.mockImplementation(async () => ({ ok: true, state })); contains.mockResolvedValue(false); getPlatformInfo.mockResolvedValue(environment.platform); queryPermission.mockResolvedValue({ state: 'denied' });
  vi.stubGlobal('chrome', { runtime: { sendMessage, getManifest: () => ({ version: '1.9.0' }), getPlatformInfo }, permissions: { contains, request: requestPermission }, storage: { local: { set: setStorage } } });
  vi.stubGlobal('navigator', { userAgent: environment.userAgent, permissions: { query: queryPermission }, mediaDevices: { getUserMedia } }); vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());
it('collects existing permission status without audio, permission prompts, provider requests or storage writes', async () => {
  state.activeSiteOrigin = 'https://private-website.test/*';
  state.settings = { ...state.settings, aiEnabled: true, aiProvider: 'compatible', aiBaseUrl: 'https://private-provider.test/v1', aiModel: 'private-model' };
  const report = await collectDiagnosticReport();
  expect(sendMessage).toHaveBeenCalledExactlyOnceWith({ target: 'background', type: 'GET_STATE' });
  expect(contains).toHaveBeenCalledWith({ origins: ['https://private-provider.test/*'] });
  expect(report.setup.microphonePermission).toBe('denied'); expect(report.access.aiProviderSavedGrant).toBe('not-granted');
  expect(JSON.stringify(report)).not.toMatch(/private-/);
  for (const effect of [getUserMedia, requestPermission, fetchMock, setStorage]) expect(effect).not.toHaveBeenCalled();
});
it('keeps permission and platform-query failures useful and private', async () => {
  state.activeSiteOrigin = 'https://private-website.test/*';
  contains.mockRejectedValue(new Error('private-provider.test failed')); getPlatformInfo.mockRejectedValue(new Error('private machine')); queryPermission.mockRejectedValue(new Error('private device'));
  const report = await collectDiagnosticReport();
  expect(report.access.currentWebsiteSavedGrant).toBe('unavailable'); expect(report.setup.microphonePermission).toBe('unavailable'); expect(report.environment.os).toBe('unknown'); expect(JSON.stringify(report)).not.toContain('private');
});
it('does not misreport an invalid enabled provider endpoint as an unnecessary grant', async () => {
  state.settings = { ...state.settings, aiEnabled: true, aiProvider: 'compatible', aiBaseUrl: 'bad private endpoint', aiModel: 'private model' };
  expect((await collectDiagnosticReport()).access.aiProviderSavedGrant).toBe('unavailable');
});
it('fails without a state snapshot instead of exporting an empty successful report', async () => {
  sendMessage.mockResolvedValue({ ok: true }); await expect(collectDiagnosticReport()).rejects.toThrow('status is unavailable');
});
