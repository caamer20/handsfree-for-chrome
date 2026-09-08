import './popup.css';
import { element as el } from './dom';
import { send, errorText } from '../common/messaging';
import { COMMAND_EXAMPLES } from '../common/constants';
import type { ChromeAction, Message } from '../common/schema';
import type { AppState } from '../common/types';

let state: AppState | undefined;
let initialized = false;
let pendingRequest = false;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
const command = el<HTMLInputElement>('command');
function showPane(name: string): void {
  document.querySelectorAll<HTMLElement>('.pane').forEach(pane => { pane.hidden = pane.id !== name; });
  document.querySelectorAll<HTMLElement>('[data-pane]').forEach(tab => {
    const active = tab.dataset.pane === name;
    tab.classList.toggle('active', active);
    if (active) tab.setAttribute('aria-current', 'page'); else tab.removeAttribute('aria-current');
  });
}
function showError(text: string): void { const error = el('error'); error.textContent = text; error.hidden = !text; }
function describe(action: ChromeAction): string {
  switch (action.action) {
    case 'create_tab': return `Open ${action.params.url === 'chrome://newtab/' ? 'a new tab' : action.params.url}`;
    case 'find_tab': return `Find tab containing “${action.params.query}”`;
    case 'close_tab': return `Close ${action.params.target === 'all_others' ? 'all other tabs in this window' : action.params.target === 'left' || action.params.target === 'right' ? `tabs to the ${action.params.target} in this window` : 'the current tab'}`;
    case 'window_state': return `Set window to ${action.params.state}`;
    case 'zoom': return `Zoom ${action.params.mode === 'set' ? `${Math.round((action.params.factor ?? 1) * 100)}%` : action.params.mode}`;
    case 'open_bookmark': return `Open bookmark ${action.params.query ?? `number ${action.params.index ?? 1}`}`;
    case 'bookmark_page': return `Bookmark page${action.params.folder ? ` in ${action.params.folder}` : ''}`;
    case 'navigate_history': return `Go ${action.params.direction}`;
    case 'mute_tab': return action.params.toggle ? 'Toggle tab audio' : action.params.mute === false ? 'Unmute tab' : 'Mute tab';
    case 'pin_tab': return action.params.toggle ? 'Toggle tab pin' : action.params.pin === false ? 'Unpin tab' : 'Pin tab';
    case 'reload_tab': return action.params.bypass_cache ? 'Reload without cache' : 'Reload tab';
    case 'duplicate_tab': return 'Duplicate tab';
  }
}
function render(next: AppState): void {
  state = next;
  const phase = next.hud.phase;
  const busy = phase === 'listening' || phase === 'thinking';
  el('voice-card').className = `voice-card ${phase}`;
  el('status-label').textContent = phase === 'idle' ? 'READY WHEN YOU ARE' : phase === 'success' ? 'ALL DONE' : phase === 'error' ? 'LET’S TRY AGAIN' : phase === 'review' ? 'YOUR GO-AHEAD' : `${phase.toUpperCase()}…`;
  const title = el('hero-title'); title.replaceChildren();
  if (phase === 'idle') title.append('Your browser.', document.createElement('br'), 'At your word.');
  else title.textContent = phase === 'listening' ? 'I’m listening.' : phase === 'thinking' ? 'One moment.' : phase === 'success' ? 'Consider it done.' : phase === 'review' ? 'Does this look right?' : 'A small hiccup.';
  el('status-text').textContent = phase === 'idle' ? 'Tabs, search, and more. Just ask.' : next.hud.text;
  el('shortcut').textContent = next.shortcut || 'Set a shortcut in Settings';
  const listen = el<HTMLButtonElement>('listen');
  listen.textContent = busy ? 'Cancel command' : next.settings.micGranted ? 'Start listening  ↗' : 'Set up microphone  ↗';
  listen.disabled = pendingRequest || !!next.pending;
  command.disabled = busy || !!next.pending || pendingRequest;
  el<HTMLButtonElement>('run-text').disabled = command.disabled;
  el<HTMLButtonElement>('approve').disabled = pendingRequest;
  el<HTMLButtonElement>('dismiss').disabled = pendingRequest;
  el('engine-state').textContent = next.engineOpen ? 'Engine ready' : 'Engine asleep';
  el('review').hidden = !next.pending;
  const plans = el('plan-list'); plans.replaceChildren();
  next.pending?.actions.forEach(action => { const li = document.createElement('li'); li.textContent = describe(action); plans.append(li); });
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
    el<HTMLSelectElement>('mode').value = next.settings.mode;
    el<HTMLInputElement>('trigger').value = next.settings.triggerPhrase;
    el<HTMLSelectElement>('language').value = next.settings.language;
    el<HTMLInputElement>('ai').checked = next.settings.aiEnabled;
    el<HTMLInputElement>('save-transcripts').checked = next.settings.saveTranscripts;
    initialized = true;
  }
}
async function refresh(): Promise<void> {
  const reply = await send({ target: 'background', type: 'GET_STATE' });
  if (!reply.ok) throw new Error(reply.error);
  if (reply.state) render(reply.state);
}
async function perform(message: Message): Promise<void> {
  if (pendingRequest) return;
  showError(''); pendingRequest = true;
  if (state) render(state);
  try { const reply = await send(message); if (!reply.ok) throw new Error(reply.error); }
  catch (error) { showError(errorText(error)); }
  finally { pendingRequest = false; await refresh().catch(error => showError(errorText(error))); }
}
document.querySelectorAll<HTMLElement>('[data-pane]').forEach(tab => tab.addEventListener('click', () => showPane(tab.dataset.pane ?? 'control')));
el('listen').addEventListener('click', () => { void perform({ target: 'background', type: 'TOGGLE_LISTENING' }); });
el('command-form').addEventListener('submit', event => { event.preventDefault(); const text = command.value.trim(); if (text) void perform({ target: 'background', type: 'RUN_TEXT', text }); });
el('approve').addEventListener('click', () => { if (state?.pending) void perform({ target: 'background', type: 'REVIEW_PLAN', requestId: state.pending.request.id, approved: true }); });
el('dismiss').addEventListener('click', () => { if (state?.pending) void perform({ target: 'background', type: 'REVIEW_PLAN', requestId: state.pending.request.id, approved: false }); });
el('clear-log').addEventListener('click', () => { void perform({ target: 'background', type: 'CLEAR_LOG' }); });
el('settings-form').addEventListener('submit', event => {
  event.preventDefault(); if (!state) return;
  const mode = el<HTMLSelectElement>('mode').value === 'standby' ? 'standby' : 'power-saver';
  const language = el<HTMLSelectElement>('language').value as AppState['settings']['language'];
  void (async () => {
    await perform({ target: 'background', type: 'SAVE_SETTINGS', settings: { ...state.settings, mode, language, triggerPhrase: el<HTMLInputElement>('trigger').value.trim(), aiEnabled: el<HTMLInputElement>('ai').checked, saveTranscripts: el<HTMLInputElement>('save-transcripts').checked } });
    el('saved').textContent = el('error').hidden ? 'Preferences saved.' : '';
  })();
});
el('microphone-setup').addEventListener('click', () => { void perform({ target: 'background', type: 'OPEN_PAGE', page: 'onboarding' }); });
el('change-shortcut').addEventListener('click', () => { void perform({ target: 'background', type: 'OPEN_PAGE', page: 'shortcuts' }); });
el('sleep').addEventListener('click', () => { void perform({ target: 'background', type: 'SLEEP_ENGINE' }); });

function examples(): void {
  const container = el('examples'); container.replaceChildren();
  const query = el<HTMLInputElement>('filter').value.toLowerCase();
  const groups = [...new Set(COMMAND_EXAMPLES.map(example => example.group))];
  for (const group of groups) {
    const rows = COMMAND_EXAMPLES.filter(example => example.group === group && `${example.text} ${example.hint}`.toLowerCase().includes(query));
    if (!rows.length) continue;
    const label = document.createElement('h3'); label.className = 'group-label'; label.textContent = group; container.append(label);
    for (const example of rows) {
      const button = document.createElement('button'); button.className = 'command-example';
      const title = document.createElement('strong'); title.textContent = `“${example.text}”`;
      const hint = document.createElement('small'); hint.textContent = example.hint; button.append(title, hint);
      button.addEventListener('click', () => { command.value = example.text; showPane('control'); command.focus(); });
      container.append(button);
    }
  }
  if (!container.children.length) { const empty = document.createElement('p'); empty.className = 'empty-state'; empty.textContent = 'No matching examples. Try tabs, zoom, or search.'; container.append(empty); }
}
el('filter').addEventListener('input', examples);
const onStorage = (): void => { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => { void refresh().catch(() => undefined); }, 70); };
chrome.storage.onChanged.addListener(onStorage);
window.addEventListener('pagehide', () => { clearTimeout(refreshTimer); chrome.storage.onChanged.removeListener(onStorage); }, { once: true });
examples();
if (new URLSearchParams(location.search).has('settings')) showPane('settings');
void refresh().catch(error => showError(errorText(error)));
