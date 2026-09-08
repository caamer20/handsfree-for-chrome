import { messageSchema, type HudState, type Message } from '../common/schema';
import { send, withTimeout, errorText } from '../common/messaging';
import { IDLE_ALARM, IDLE_MS, MAX_COMMAND_MS, OFFSCREEN_PATH, WATCHDOG_ALARM } from '../common/constants';
import type { ActiveRequest, AppState, Reply } from '../common/types';
import { dispatchActions, requiresReview } from './dispatcher';
import { closeOffscreen, ensureOffscreen, hasOffscreen } from './offscreen-manager';
import { addLog, getLog, getSession, getSettings, setSession } from './store';

// Serialize state transitions, not inference. Heavy work lives in the offscreen document.
let transitions: Promise<unknown> = Promise.resolve();
function serialize<T>(task: () => Promise<T>): Promise<T> {
  const result = transitions.then(task, task);
  transitions = result.then(() => undefined, () => undefined);
  return result;
}
async function hud(state: HudState, tabId?: number): Promise<void> {
  await setSession({ hud: state });
  const label = state.phase === 'listening' ? '●' : state.phase === 'thinking' ? '…' : state.phase === 'error' ? '!' : state.phase === 'review' ? '?' : '';
  await chrome.action.setBadgeText({ text: label });
  await chrome.action.setBadgeBackgroundColor({ color: state.phase === 'error' ? '#b54c39' : '#117c72' });
  await chrome.action.setTitle({ title: `HandsFree · ${state.text}` });
  if (tabId === undefined) return;
  const message: Message = { target: 'content', type: 'HUD_STATE', state };
  try { await chrome.tabs.sendMessage(tabId, message); }
  catch {
    try {
      // activeTab grant from the popup or keyboard shortcut; no broad host permissions.
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      await chrome.tabs.sendMessage(tabId, message);
    } catch { /* Chrome internal pages / store pages cannot host a HUD. Badge and popup still work. */ }
  }
}
async function touch(): Promise<void> {
  await setSession({ lastActivity: Date.now() });
  if ((await getSettings()).mode === 'power-saver') await chrome.alarms.create(IDLE_ALARM, { when: Date.now() + IDLE_MS });
  else await chrome.alarms.clear(IDLE_ALARM);
}
async function finish(state: HudState, request?: ActiveRequest, transcript?: string): Promise<void> {
  await setSession({ active: null });
  await chrome.alarms.clear(WATCHDOG_ALARM);
  await hud(state, request?.tabId);
  if (state.phase === 'success' || state.phase === 'error') await addLog(state.text, state.phase === 'success', transcript);
  await touch();
}
async function openPage(page: 'onboarding' | 'settings' | 'shortcuts'): Promise<void> {
  const url = page === 'shortcuts' ? 'chrome://extensions/shortcuts' : chrome.runtime.getURL(page === 'onboarding' ? 'src/popup/onboarding.html' : 'src/popup/popup.html?settings=1');
  await chrome.tabs.create({ url });
}
async function start(text?: string): Promise<void> {
  const session = await getSession();
  if (session.active) {
    if (text !== undefined) throw new Error('A command is already running. Cancel it before starting another.');
    await setSession({ active: null, pending: null }); // Invalidate results before disposing the old context.
    await closeOffscreen();
    await finish({ phase: 'idle', text: 'Cancelled. Ready when you are.' }, session.active);
    return;
  }
  if (session.pending) throw new Error('Review or dismiss the pending command first.');
  const settings = await getSettings();
  if (text === undefined && !settings.micGranted) { await openPage('onboarding'); return; }
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id === undefined) throw new Error('No active Chrome tab found.');
  const request: ActiveRequest = { id: crypto.randomUUID(), tabId: tab.id, windowId: tab.windowId, startedAt: Date.now() };
  await setSession({ active: request, pending: null });
  await chrome.alarms.create(WATCHDOG_ALARM, { when: Date.now() + MAX_COMMAND_MS });
  await touch();
  await hud({ phase: text === undefined ? 'listening' : 'thinking', text: text === undefined ? 'Listening…' : 'Interpreting your command…' }, tab.id);
  try {
    await ensureOffscreen();
    const reply = await withTimeout(send(text === undefined
      ? { target: 'offscreen', type: 'START_LISTENING', requestId: request.id, settings }
      : { target: 'offscreen', type: 'PARSE_TEXT', requestId: request.id, settings, text }), 10_000, 'The voice engine did not respond. Try again.');
    if (!reply?.ok) throw new Error(reply && !reply.ok ? reply.error : 'The voice engine did not respond.');
  } catch (error) {
    await closeOffscreen();
    await finish({ phase: 'error', text: errorText(error) }, request);
    throw error;
  }
}
async function snapshot(): Promise<AppState> {
  const [session, settings, log, commands, engineOpen] = await Promise.all([getSession(), getSettings(), getLog(), chrome.commands.getAll(), hasOffscreen()]);
  return { settings, log, hud: session.hud, pending: session.pending, shortcut: commands.find(c => c.name === 'toggle-listening')?.shortcut ?? '', engineOpen };
}
async function handle(message: Message): Promise<Reply> {
  if (message.target !== 'background') return { ok: false, error: 'Wrong destination' };
  switch (message.type) {
    case 'GET_STATE': return { ok: true, state: await snapshot() };
    case 'TOGGLE_LISTENING': await start(); break;
    case 'RUN_TEXT': await start(message.text); break;
    case 'OPEN_PAGE': await openPage(message.page); break;
    case 'CLEAR_LOG': await chrome.storage.local.set({ log: [] }); break;
    case 'SAVE_SETTINGS': {
      const previous = await getSettings();
      await chrome.storage.local.set({ settings: message.settings });
      if (previous.saveTranscripts && !message.settings.saveTranscripts) {
        const log = (await getLog()).map(entry => ({ id: entry.id, at: entry.at, text: entry.text, ok: entry.ok }));
        await chrome.storage.local.set({ log });
      }
      await touch(); break;
    }
    case 'SLEEP_ENGINE': {
      const { active } = await getSession();
      await setSession({ active: null, pending: null });
      await closeOffscreen();
      await finish({ phase: 'idle', text: 'Engine asleep. Press the shortcut to wake it.' }, active ?? undefined);
      break;
    }
    case 'REVIEW_PLAN': {
      const { pending } = await getSession();
      if (!pending || pending.request.id !== message.requestId) throw new Error('This plan has expired. Try the command again.');
      await setSession({ pending: null }); // A repeated approval cannot execute it twice.
      if (!message.approved) { await finish({ phase: 'idle', text: 'Command dismissed' }, pending.request); break; }
      if (Date.now() - pending.request.startedAt > 5 * 60_000) {
        await finish({ phase: 'error', text: 'This plan expired. Try the command again.' }, pending.request);
        break;
      }
      try {
        const result = await dispatchActions(pending.actions, pending.request);
        await finish({ phase: 'success', text: result.text }, { ...pending.request, ...result.context }, pending.transcript);
      } catch (error) { await finish({ phase: 'error', text: errorText(error) }, pending.request, pending.transcript); }
      break;
    }
    case 'VOICE_TRANSCRIPT':
    case 'ENGINE_STATUS':
    case 'ENGINE_ERROR':
    case 'EXECUTE_ACTIONS': {
      const { active } = await getSession();
      if (!active || active.id !== message.requestId) break; // Drop results from cancelled/expired sessions.
      if (message.type === 'VOICE_TRANSCRIPT') {
        await hud({ phase: message.final ? 'thinking' : 'listening', text: message.final ? 'Thinking…' : message.text }, active.tabId);
      } else if (message.type === 'ENGINE_STATUS') {
        await hud({ phase: 'thinking', text: message.text }, active.tabId);
      } else if (message.type === 'ENGINE_ERROR') {
        await setSession({ active: null });
        await closeOffscreen();
        await finish({ phase: 'error', text: message.error }, active);
      } else if (requiresReview(message.actions, message.source)) {
        await setSession({ active: null, pending: { request: active, actions: message.actions, transcript: message.transcript } });
        await finish({ phase: 'review', text: 'Open HandsFree to review this command' }, active);
      } else {
        // Claim this request before dispatch so duplicate model replies cannot replay it.
        await setSession({ active: null });
        try {
          const result = await dispatchActions(message.actions, active);
          await finish({ phase: 'success', text: result.text }, { ...active, ...result.context }, message.transcript);
        } catch (error) { await finish({ phase: 'error', text: errorText(error) }, active, message.transcript); }
      }
      break;
    }
  }
  return { ok: true };
}

const engineTypes = new Set(['VOICE_TRANSCRIPT', 'ENGINE_STATUS', 'ENGINE_ERROR', 'EXECUTE_ACTIONS']);
chrome.runtime.onMessage.addListener((raw: unknown, sender, respond: (reply: Reply) => void): boolean => {
  const parsed = messageSchema.safeParse(raw);
  if (!parsed.success || parsed.data.target !== 'background' || sender.id !== chrome.runtime.id) return false;
  const message = parsed.data;
  const path = sender.url?.split('?')[0];
  const trusted = engineTypes.has(message.type)
    ? path === chrome.runtime.getURL(OFFSCREEN_PATH)
    : [chrome.runtime.getURL('src/popup/popup.html'), chrome.runtime.getURL('src/popup/onboarding.html')].includes(path ?? '');
  if (!trusted) { respond({ ok: false, error: 'Untrusted message source' }); return false; }
  void serialize(() => handle(message)).then(respond, (error: unknown) => respond({ ok: false, error: errorText(error) }));
  return true;
});
chrome.commands.onCommand.addListener(command => {
  if (command === 'toggle-listening') void serialize(() => start()).catch(async error => { await hud({ phase: 'error', text: errorText(error) }); });
});
chrome.alarms.onAlarm.addListener(alarm => {
  if (![IDLE_ALARM, WATCHDOG_ALARM].includes(alarm.name)) return;
  void serialize(async () => {
    const session = await getSession();
    if (alarm.name === WATCHDOG_ALARM) {
      if (!session.active) return;
      if (Date.now() - session.active.startedAt < MAX_COMMAND_MS) { await chrome.alarms.create(WATCHDOG_ALARM, { when: session.active.startedAt + MAX_COMMAND_MS }); return; }
      await setSession({ active: null });
      await closeOffscreen();
      await finish({ phase: 'error', text: 'The command timed out. Try a shorter phrase.' }, session.active);
    } else if ((await getSettings()).mode === 'power-saver') {
      if (session.active || Date.now() - session.lastActivity < IDLE_MS) { await chrome.alarms.create(IDLE_ALARM, { when: Math.max(Date.now() + 30_000, session.lastActivity + IDLE_MS) }); return; }
      await closeOffscreen();
      if (!session.pending) await hud({ phase: 'idle', text: 'Engine asleep. Ready when you are.' });
    }
  }).catch(error => console.error('HandsFree lifecycle:', errorText(error)));
});
chrome.runtime.onInstalled.addListener(details => {
  void serialize(async () => {
    await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    await chrome.storage.local.set({ settings: await getSettings() });
    await setSession({ active: null, pending: null });
    await hud({ phase: 'idle', text: 'Ready when you are' });
    if (details.reason === 'install') await openPage('onboarding');
  });
});
chrome.runtime.onStartup.addListener(() => {
  void serialize(async () => {
    await setSession({ active: null, pending: null });
    await hud({ phase: 'idle', text: 'Ready when you are' });
    await touch();
  });
});
