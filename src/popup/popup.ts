import './popup.css';
import { element as el } from './dom';
import { send, errorText } from '../common/messaging';
import { COMMAND_EXAMPLES } from '../common/constants';
import { describeAction } from '../common/action-labels';
import type { Message } from '../common/schema';
import type { AppState } from '../common/types';
import { providerOrigin, validateProvider, PROVIDER_LABELS, type Provider } from '../common/providers';
import { DiagnosticsPanel } from './diagnostics';
import { recoveryAdvice } from '../common/diagnostics';
import { contextExamples } from '../common/suggestions';
import { LibraryPanel } from './library';
import { RoutinesPanel } from './routines';
import { MacrosPanel } from './macros';

let state: AppState | undefined;
let initialized = false;
let lastQuestionId: string | null = null;
let pendingRequest = false;
let requestingSite = false;
let testingConnection = false;
let lastRecoveryId: string | undefined;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
const command = el<HTMLInputElement>('command');
const isPanel = location.pathname.endsWith('/sidepanel.html');
document.body.dataset.surface = isPanel ? 'panel' : 'popup';
el('open-panel').hidden = isPanel;
el('panel-stop').hidden = !isPanel;
new DiagnosticsPanel('diagnostics', perform);
const libraryPanel = new LibraryPanel(perform, () => showPane('control'));
const routinesPanel = new RoutinesPanel(perform, () => showPane('control'));
const macrosPanel = new MacrosPanel(perform, () => showPane('control'));
function showPane(name: string): void {
  if (name === 'macros') { name = 'library'; libraryPanel.show('macros'); }
  document.querySelectorAll<HTMLElement>('.pane').forEach(pane => { pane.hidden = pane.id !== name; });
  document.querySelectorAll<HTMLElement>('[data-pane]').forEach(tab => {
    const active = tab.dataset.pane === name;
    tab.classList.toggle('active', active);
    if (active) tab.setAttribute('aria-current', 'page'); else tab.removeAttribute('aria-current');
  });
}
function showError(text: string): void { const error = el('error'); error.textContent = text; error.hidden = !text; }
function render(next: AppState): void {
  state = next;
  const suggested = el('context-examples');
  const suggestionKey = next.activeSiteOrigin ?? 'browser';
  if (suggested.dataset.site !== suggestionKey) {
    suggested.dataset.site = suggestionKey; suggested.replaceChildren();
    for (const example of contextExamples(next.activeSiteOrigin)) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary'; button.textContent = example.text;
      button.addEventListener('click', () => { command.value = example.text; command.focus(); }); suggested.append(button);
    }
  }
  el('settings-shortcut').textContent = next.shortcut ? `Press ${next.shortcut} to start or stop listening.` : 'Choose an available keyboard shortcut to start listening from a website.';
  el('local-edition-note').hidden = next.localAiAvailable !== false;
  const localOption = el<HTMLSelectElement>('ai-provider').querySelector<HTMLOptionElement>('option[value="local"]');
  if (localOption) { localOption.disabled = next.localAiAvailable === false; localOption.textContent = next.localAiAvailable === false ? 'Choose a cloud provider…' : 'On-device SmolLM2 · experimental'; }
  el('transcript-card').hidden = !next.transcript;
  el('last-transcript').textContent = next.transcript ?? '';
  el('current-tab-label').textContent = next.activeTabTitle ? `Tab: ${next.activeTabTitle}` : 'Ready';
  el<HTMLButtonElement>('open-panel').disabled = next.currentWindowId === undefined;
  el<HTMLButtonElement>('panel-stop').disabled = !next.listening && !next.pending && !next.question && !['thinking', 'listening'].includes(next.hud.phase);
  const phase = next.hud.phase;
  const busy = next.listening || phase === 'listening' || phase === 'thinking';
  macrosPanel.render(next.macros, busy || pendingRequest || !!next.pending || !!next.question);
  libraryPanel.render(next);
  routinesPanel.render(next.routines ?? [], busy || pendingRequest || !!next.pending || !!next.question);
  el('voice-card').className = `voice-card ${phase}${next.progress ? ' has-progress' : ''}`;
  el('status-label').textContent = phase === 'idle' ? 'READY WHEN YOU ARE' : phase === 'success' ? 'ALL DONE' : phase === 'error' ? 'LET’S TRY AGAIN' : phase === 'clarify' ? 'ONE QUICK DETAIL' : phase === 'review' ? 'YOUR GO-AHEAD' : `${phase.toUpperCase()}…`;
  const title = el('hero-title'); title.replaceChildren();
  if (phase === 'idle') title.append('Your browser.', document.createElement('br'), 'At your word.');
  else title.textContent = phase === 'listening' ? 'I’m listening.' : phase === 'thinking' ? 'One moment.' : phase === 'success' ? 'Consider it done.' : phase === 'clarify' ? 'Which did you mean?' : phase === 'review' ? 'Does this look right?' : 'A small hiccup.';
  el('status-text').textContent = phase === 'idle' ? 'Tabs, search, and more. Just ask.' : next.hud.text;
  el('shortcut').textContent = next.shortcut || 'Set a shortcut in Settings';
  const listen = el<HTMLButtonElement>('listen');
  listen.textContent = next.listening ? 'Stop listening  ■' : busy || next.pending || next.question || pendingRequest ? 'Cancel command' : next.settings.micGranted ? 'Start listening  ↗' : 'Set up microphone  ↗';
  listen.disabled = false;
  command.disabled = (next.question ? false : busy || !!next.pending) || pendingRequest;
  command.placeholder = next.question?.kind === 'text' ? 'Type your answer…' : next.question?.kind === 'name' ? 'Type a name…' : next.question ? 'Type an option number or title…' : 'Try “open a new tab”';
  el<HTMLButtonElement>('run-text').disabled = command.disabled;
  el<HTMLButtonElement>('approve').disabled = pendingRequest;
  el<HTMLButtonElement>('dismiss').disabled = pendingRequest;
  el('engine-state').textContent = next.listening ? '● Mic on' : next.engineOpen ? 'Engine ready' : 'Engine asleep';
  el('processing-provider').textContent = next.settings.aiEnabled ? PROVIDER_LABELS[next.settings.aiProvider] : 'Local commands';
  el('voice-review-hint').hidden = !next.listening;
  el('review').hidden = !next.pending;
  el('execution-progress').hidden = !next.progress;
  el('progress-heading').textContent = next.progress?.name ?? 'Command progress';
  el('progress-state').textContent = next.progress?.status ?? '';
  const steps = el('progress-steps'); steps.replaceChildren();
  next.progress?.steps.forEach((step, index) => {
    const row = document.createElement('li'); row.className = `progress-step ${step.status}`;
    const title = document.createElement('strong'); title.textContent = `${index + 1}. ${step.label}`;
    const status = document.createElement('span'); status.className = 'step-status'; status.textContent = step.status; row.append(title, status);
    if (step.target) { const target = document.createElement('small'); target.textContent = `Target: ${step.target}`; row.append(target); }
    if (step.result) { const result = document.createElement('p'); result.textContent = step.result; row.append(result); }
    if (step.completedTargets.length) { const confirmed = document.createElement('ul'); for (const target of step.completedTargets) { const item = document.createElement('li'); item.textContent = `Completed: ${target}`; confirmed.append(item); } row.append(confirmed); }
    steps.append(row);
  });
  el('recovery-card').hidden = next.hud.phase !== 'error';
  if (next.hud.phase === 'error') { const advice = recoveryAdvice(next.hud.text); el('recovery-title').textContent = advice.title; el('recovery-detail').textContent = advice.detail; const button = el<HTMLButtonElement>('recovery-action'); button.hidden = !advice.action; button.textContent = advice.action === 'sleep' ? 'Release engine' : advice.action === 'settings' ? 'Open settings' : 'Open setup guide'; }
  if (next.recovery) {
    const labels = { 'site-access': 'Allow this website to continue', 'restricted-page': 'Open a regular website', 'missing-target': 'Choose the intended tab', 'page-changed': 'The page changed', 'unknown-outcome': 'Check what changed before retrying' };
    el('recovery-title').textContent = labels[next.recovery.kind]; el('recovery-detail').textContent = next.recovery.detail; el('recovery-action').hidden = true;
  }
  if (lastRecoveryId !== next.recovery?.id) el('recovery-permission').textContent = '';
  lastRecoveryId = next.recovery?.id;
  el('recovery-allow-site').hidden = !next.recovery?.origin || next.recovery.canResume;
  el('recovery-allow-site').textContent = next.recovery?.origin ? `Allow ${new URL(next.recovery.origin).hostname}` : 'Allow this site';
  el('recovery-resume').hidden = !next.recovery?.canResume;
  el('recovery-choose-tab').hidden = !next.recovery?.canChooseTab;
  el('recovery-edit').textContent = next.transcript ? 'Edit what I heard' : 'Try typing';
  for (const id of ['recovery-allow-site', 'recovery-resume', 'recovery-choose-tab', 'recovery-edit']) el<HTMLButtonElement>(id).disabled = pendingRequest || requestingSite;

  const plans = el('plan-list'); plans.replaceChildren();
  for (const target of next.pending?.targets ?? []) { const li = document.createElement('li'); li.textContent = target.title; li.title = target.url; plans.append(li); }
  for (const url of next.pending?.urls ?? []) { const li = document.createElement('li'); li.textContent = url; plans.append(li); }
  next.pending?.actions.forEach(action => { const li = document.createElement('li'); li.textContent = describeAction(action); plans.append(li); });
  if (next.question && next.question.id !== lastQuestionId) command.value = '';
  lastQuestionId = next.question?.id ?? null;
  el('clarification').hidden = !next.question;
  el('dictation-state').hidden = !next.dictation;
  el('question-prompt').textContent = next.question?.prompt ?? '';
  const choices = el('question-choices'); choices.replaceChildren();
  next.question?.choices.forEach((choice, index) => {
    const button = document.createElement('button'); button.className = 'command-example'; button.disabled = pendingRequest;
    const label = document.createElement('strong'); label.textContent = `${index + 1}. ${choice.label}`; button.append(label);
    if (choice.detail) { const detail = document.createElement('small'); detail.textContent = choice.detail; button.append(detail); }
    button.addEventListener('click', () => { if (state?.question) void perform({ target: 'background', type: 'ANSWER_CLARIFICATION', questionId: state.question.id, answer: `choice:${choice.id}` }); }); choices.append(button);
  });
  el<HTMLButtonElement>('allow-site').disabled = !next.activeSiteOrigin;
  el('allow-site').textContent = next.activeSiteOrigin ? `Allow ${new URL(next.activeSiteOrigin).hostname}` : 'Open a website first';
  const activity = el('activity'); activity.replaceChildren();
  el('empty-log').hidden = next.log.length > 0;
  el('clear-log').hidden = next.log.length === 0;
  for (const item of next.log.slice(0, 8)) {
    const li = document.createElement('li');
    const result = document.createElement('span'); result.className = item.ok ? 'result' : 'failed'; result.textContent = item.ok ? '✓' : '!'; result.setAttribute('aria-label', item.ok ? 'Completed' : 'Failed');
    const text = document.createElement('span'); text.className = 'log-text'; text.textContent = item.text;
    if (item.transcript) text.title = item.transcript;
    const time = document.createElement('time'); time.dateTime = new Date(item.at).toISOString(); time.textContent = new Date(item.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    li.append(result, text, time); activity.append(li);
  }
  if (!initialized) {
    el<HTMLSelectElement>('feedback').value = next.settings.feedback;
    el<HTMLInputElement>('reuse-tabs').checked = next.settings.reuseTabs;
    el<HTMLInputElement>('learn-sites').checked = next.settings.learnTopSites;
    el<HTMLSelectElement>('mode').value = next.settings.mode;
    el<HTMLInputElement>('trigger').value = next.settings.triggerPhrase;
    el<HTMLSelectElement>('language').value = next.settings.language;
    el<HTMLInputElement>('ai').checked = next.settings.aiEnabled;
    el<HTMLSelectElement>('listening-mode').value = next.settings.listeningMode;
    el<HTMLSelectElement>('voice-pace').value = next.settings.voicePace;
    el<HTMLSelectElement>('ai-provider').value = next.settings.aiProvider;
    el<HTMLInputElement>('ai-model').value = next.settings.aiModel;
    el<HTMLInputElement>('ai-base-url').value = next.settings.aiBaseUrl;
    el<HTMLInputElement>('review-ai').checked = next.settings.reviewAiActions;
    el<HTMLInputElement>('save-transcripts').checked = next.settings.saveTranscripts;
    el<HTMLDetailsElement>('advanced-settings').open = next.settings.aiEnabled;
    initialized = true;
  }
  providerFields();
}
async function refresh(): Promise<void> {
  const reply = await send({ target: 'background', type: 'GET_STATE' });
  if (!reply.ok) throw new Error(reply.error);
  if (reply.state) render(reply.state);
}
async function perform(message: Message): Promise<boolean> {
  if (message.type === 'TOGGLE_LISTENING' || message.type === 'INTERRUPT_COMMAND' || message.type === 'SLEEP_ENGINE') {
    try { const reply = await send(message); if (!reply.ok) throw new Error(reply.error); await refresh(); return true; } catch (error) { showError(errorText(error)); return false; }
  }
  if (pendingRequest) return false;
  let ok = false;
  showError(''); pendingRequest = true;
  if (state) render(state);
  try { const reply = await send(message); if (!reply.ok) throw new Error(reply.error); ok = true; }
  catch (error) { showError(errorText(error)); }
  finally { pendingRequest = false; await refresh().catch(error => showError(errorText(error))); }
  return ok;
}
document.querySelectorAll<HTMLElement>('[data-pane]').forEach(tab => tab.addEventListener('click', () => showPane(tab.dataset.pane ?? 'control')));
el('listen').addEventListener('click', () => { void perform({ target: 'background', type: 'TOGGLE_LISTENING' }); });
el('open-panel').addEventListener('click', () => {
  if (state?.currentWindowId === undefined) return;
  // Invoke directly from the click so Chrome retains the user's activation.
  void chrome.sidePanel.open({ windowId: state.currentWindowId }).catch(error => showError(errorText(error)));
});
el('panel-stop').addEventListener('click', () => { void perform({ target: 'background', type: 'INTERRUPT_COMMAND', stopListening: true }); });
el('edit-transcript').addEventListener('click', () => {
  const text = state?.transcript; if (!text) return;
  void perform({ target: 'background', type: 'INTERRUPT_COMMAND', stopListening: true }).then(ok => {
    if (ok) { command.value = text; showPane('control'); command.focus(); }
  });
});
el('recovery-edit').addEventListener('click', () => {
  const text = state?.transcript ?? command.value;
  void perform({ target: 'background', type: 'INTERRUPT_COMMAND', stopListening: true }).then(ok => {
    if (ok) { command.value = text; showPane('control'); command.focus(); }
  });
});
el('recovery-allow-site').addEventListener('click', () => {
  const origin = state?.recovery?.origin; if (!origin || requestingSite) return;
  requestingSite = true; el('recovery-permission').textContent = 'Choose Allow in Chrome’s permission prompt to continue.';
  if (state) render(state);
  void chrome.permissions.request({ origins: [origin] }).then(async granted => {
    el('recovery-permission').textContent = granted ? 'Site access allowed. Choose Resume to run only the remaining steps.' : 'Site access was not granted. Your command is still available.';
    await refresh();
  }).catch(error => showError(errorText(error))).finally(() => { requestingSite = false; if (state) render(state); });
});
el('recovery-resume').addEventListener('click', () => { if (state?.recovery) void perform({ target: 'background', type: 'RESUME_COMMAND', id: state.recovery.id }); });
el('recovery-choose-tab').addEventListener('click', () => { if (state?.recovery) void perform({ target: 'background', type: 'CHOOSE_RECOVERY_TAB', id: state.recovery.id }); });
el('command-form').addEventListener('submit', event => { event.preventDefault(); const text = command.value.trim(); if (text) void perform({ target: 'background', type: 'RUN_TEXT', text }); });
el('approve').addEventListener('click', () => { if (state?.pending) void perform({ target: 'background', type: 'REVIEW_PLAN', requestId: state.pending.request.id, approved: true }); });
el('dismiss').addEventListener('click', () => { if (state?.pending) void perform({ target: 'background', type: 'REVIEW_PLAN', requestId: state.pending.request.id, approved: false }); });
el('clear-log').addEventListener('click', () => { void perform({ target: 'background', type: 'CLEAR_LOG' }); });
function selectedProvider(): { aiProvider: Provider; aiModel: string; aiBaseUrl: string } {
  return { aiProvider: el<HTMLSelectElement>('ai-provider').value as Provider, aiModel: el<HTMLInputElement>('ai-model').value.trim(), aiBaseUrl: el<HTMLInputElement>('ai-base-url').value.trim() };
}
function providerFields(): void {
  const config = selectedProvider(); const cloud = config.aiProvider !== 'local';
  const enabled = el<HTMLInputElement>('ai').checked;
  el('ai-controls').hidden = !enabled;
  el('cloud-settings').hidden = !cloud; el('local-ai-note').hidden = cloud;
  el('base-url-setting').hidden = config.aiProvider !== 'compatible';
  el<HTMLInputElement>('ai-model').required = cloud && enabled;
  el<HTMLInputElement>('ai-model').disabled = !cloud || !enabled;
  el<HTMLInputElement>('ai-base-url').required = config.aiProvider === 'compatible' && enabled;
  el<HTMLInputElement>('ai-base-url').disabled = config.aiProvider !== 'compatible' || !enabled;
  const saved = !!state && config.aiProvider === state.settings.aiProvider && config.aiBaseUrl === state.settings.aiBaseUrl;
  el<HTMLInputElement>('api-key').placeholder = saved && state?.hasApiKey ? 'Key saved · leave blank to keep it' : 'Paste your API key';
  el<HTMLButtonElement>('remove-key').disabled = pendingRequest || !saved || !state?.hasApiKey;
  el<HTMLButtonElement>('test-ai').disabled = testingConnection || pendingRequest || !saved || config.aiModel !== state?.settings.aiModel || !state?.hasApiKey;
}
el('ai-provider').addEventListener('change', () => { el<HTMLInputElement>('api-key').value = ''; el('connection-status').textContent = ''; providerFields(); });
el('ai').addEventListener('change', providerFields);
el('settings-form').addEventListener('invalid', () => { el<HTMLDetailsElement>('advanced-settings').open = true; }, true);
el('ai-base-url').addEventListener('input', providerFields);
el('ai-model').addEventListener('input', providerFields);
el('settings-form').addEventListener('submit', event => {
  event.preventDefault(); if (!state || pendingRequest) return;
  showError(''); el('saved').textContent = ''; el('connection-status').textContent = '';
  const config = selectedProvider();
  const aiEnabled = el<HTMLInputElement>('ai').checked;
  const apiKey = aiEnabled ? el<HTMLInputElement>('api-key').value.trim() : '';
  try {
    if (aiEnabled && config.aiProvider === 'local' && state.localAiAvailable === false) throw new Error('Choose an AI provider in Advanced settings, or leave AI off to use built-in commands.');
    if (aiEnabled || apiKey) validateProvider(config);
  } catch (error) { el<HTMLDetailsElement>('advanced-settings').open = true; showError(errorText(error)); return; }
  const settings = { ...state.settings, ...config, voicePace: el<HTMLSelectElement>('voice-pace').value as AppState['settings']['voicePace'], reuseTabs: el<HTMLInputElement>('reuse-tabs').checked, learnTopSites: el<HTMLInputElement>('learn-sites').checked, feedback: el<HTMLSelectElement>('feedback').value as AppState['settings']['feedback'], siteDefaults: libraryPanel.defaults(), mode: el<HTMLSelectElement>('mode').value as AppState['settings']['mode'], language: el<HTMLSelectElement>('language').value as AppState['settings']['language'], listeningMode: el<HTMLSelectElement>('listening-mode').value as AppState['settings']['listeningMode'], triggerPhrase: el<HTMLInputElement>('trigger').value.trim(), aiEnabled: el<HTMLInputElement>('ai').checked, reviewAiActions: el<HTMLInputElement>('review-ai').checked, saveTranscripts: el<HTMLInputElement>('save-transcripts').checked };
  // Request directly in the submit gesture, before any asynchronous work loses activation.
  const requested: chrome.permissions.Permissions = { ...((aiEnabled || apiKey) && config.aiProvider !== 'local' ? { origins: [providerOrigin(config)] } : {}), ...(settings.learnTopSites ? { permissions: ['topSites'] } : {}) };
  const permission = Object.keys(requested).length ? chrome.permissions.request(requested) : Promise.resolve(true);
  void (async () => {
    try {
      if (!await permission) throw new Error('The requested permission was not granted. Allow it or turn off that feature before saving.');
      const ok = await perform({ target: 'background', type: 'SAVE_SETTINGS', settings, ...(apiKey ? { apiKey } : {}) });
      if (ok) { el<HTMLInputElement>('api-key').value = ''; el('saved').textContent = 'Preferences saved.'; }
    } catch (error) { showError(errorText(error)); }
  })();
});
for (const id of ['allow-site', 'allow-all-sites']) el(id).addEventListener('click', () => {
  const origins = id === 'allow-all-sites' ? ['https://*/*', 'http://*/*'] : state?.activeSiteOrigin ? [state.activeSiteOrigin] : [];
  if (!origins.length) return;
  void chrome.permissions.request({ origins }).then(allowed => { el('site-access-status').textContent = allowed ? 'Page controls enabled for the selected websites.' : 'Website access was not granted.'; }, error => showError(errorText(error)));
});
el('test-ai').addEventListener('click', () => {
  if (pendingRequest || testingConnection) return;
  testingConnection = true; showError(''); providerFields(); el('connection-status').textContent = 'Testing saved connection…';
  void (async () => {
    try { const reply = await send({ target: 'background', type: 'TEST_AI_CONNECTION' }); if (!reply.ok) throw new Error(reply.error); el('connection-status').textContent = reply.message ?? 'Connection test cancelled.'; }
    catch (error) { el('connection-status').textContent = ''; showError(errorText(error)); }
    finally { testingConnection = false; await refresh().catch(() => undefined); }
  })();
});
el('remove-key').addEventListener('click', () => { void perform({ target: 'background', type: 'REMOVE_API_KEY' }).then(ok => { if (ok) { el<HTMLInputElement>('api-key').value = ''; el('connection-status').textContent = 'Saved key removed.'; } }); });
el('microphone-setup').addEventListener('click', () => { void perform({ target: 'background', type: 'OPEN_PAGE', page: 'onboarding' }); });
el('change-shortcut').addEventListener('click', () => { void perform({ target: 'background', type: 'OPEN_PAGE', page: 'shortcuts' }); });
el('recovery-action').addEventListener('click', () => { const action = state ? recoveryAdvice(state.hud.text).action : undefined; if (action) void perform(action === 'sleep' ? { target: 'background', type: 'SLEEP_ENGINE' } : { target: 'background', type: 'OPEN_PAGE', page: action }); });
el('sleep').addEventListener('click', () => { void perform({ target: 'background', type: 'SLEEP_ENGINE' }); });

function examples(): void {
  const container = el('examples'); container.replaceChildren();
  const query = el<HTMLInputElement>('filter').value.toLowerCase();
  const groups = [...new Set(COMMAND_EXAMPLES.map(example => example.group))];
  for (const group of groups) {
    const rows = COMMAND_EXAMPLES.filter(example => example.group === group && `${example.text} ${example.hint} ${example.variations?.join(' ') ?? ''}`.toLowerCase().includes(query));
    if (!rows.length) continue;
    const label = document.createElement('h3'); label.className = 'group-label'; label.textContent = group; container.append(label);
    for (const example of rows) {
      const button = document.createElement('button'); button.className = 'command-example';
      const title = document.createElement('strong'); title.textContent = `“${example.text}”`;
      const hint = document.createElement('small'); hint.textContent = example.hint; button.append(title, hint);
      if (example.variations?.length) { const alternatives = document.createElement('small'); alternatives.className = 'alternative-phrases'; alternatives.textContent = `Also: ${example.variations.map(text => `“${text}”`).join(' · ')}`; button.append(alternatives); }
      button.addEventListener('click', () => { command.value = example.text; showPane('control'); command.focus(); });
      container.append(button);
    }
  }
  if (!container.children.length) { const empty = document.createElement('p'); empty.className = 'empty-state'; empty.textContent = 'No matching examples. Try tabs, zoom, or search.'; container.append(empty); }
}
el('filter').addEventListener('input', examples);
const onStorage = (): void => { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => { void refresh().catch(() => undefined); }, 70); };
chrome.storage.onChanged.addListener(onStorage);
chrome.tabs?.onActivated?.addListener(onStorage);
chrome.tabs?.onUpdated?.addListener(onStorage);
window.addEventListener('pagehide', () => { clearTimeout(refreshTimer); chrome.storage.onChanged.removeListener(onStorage); chrome.tabs?.onActivated?.removeListener(onStorage); chrome.tabs?.onUpdated?.removeListener(onStorage); }, { once: true });
examples();
if (new URLSearchParams(location.search).has('settings')) showPane('settings');
if (new URLSearchParams(location.search).has('macros')) showPane('macros');
void refresh().catch(error => showError(errorText(error)));
