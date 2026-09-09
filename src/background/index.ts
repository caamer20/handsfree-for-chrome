import type { ProgressEvent } from '../common/progress';
import { diagnosticsFor } from '../common/diagnostics';
import { prepareProgress, pauseProgress, completeReviewedProgress } from './progress';
import { getRoutines, saveRoutine, deleteRoutine, addImportedRoutines } from './routine-store';
import { compileRoutine, matchRoutine, routineInputs } from '../common/routines';
import type { Routine } from '../common/routine-schema';
import { messageSchema, type ChromeAction, type HudState, type Message } from '../common/schema';
import { send, withTimeout, errorText } from '../common/messaging';
import { IDLE_ALARM, IDLE_MS, MAX_COMMAND_MS, OFFSCREEN_PATH, WATCHDOG_ALARM } from '../common/constants';
import type { ActiveRequest, AppState, Reply } from '../common/types';
import { dispatchActions, dispatchMacro, requiresReview } from './dispatcher';
import { closeOffscreen, ensureOffscreen, hasOffscreen } from './offscreen-manager';
import { addLog, deleteMacro, getLog, getMacros, getSession, getSettings, saveMacro, setSession } from './store';
import { findMacro, type Macro } from '../common/macros';
import { providerOrigin, validateProvider } from '../common/providers';
import { getApiKey, removeApiKey, saveApiKey } from './credentials';
import { parseCloud } from './cloud-parser';
import { ChoiceRequired, ReviewRequired, checkCancelled, emptyConversation, type ChoiceOverrides, type TargetContext } from '../common/conversation';
import { parseCommand } from '../common/command-parser';
import { isNegatedCommand, reviewIntent } from '../common/language';
import { interruptIntent } from '../common/expanded-parser';
import { getLibrary, saveAlias, deleteAlias, deleteWorkspace, refreshSiteSuggestions, clearSiteSuggestions } from './library-store';
import { applyUndo, finalizeUndo, type ExecutionEnvironment } from './execution';
import { answerChoice } from './choices';
import { cancelPage, dictate } from './page-bridge';
import { isSafeUrl } from '../common/urls';
import { validateGrounding } from '../offscreen/grounding';

const CAPTURE_ALARM = 'handsfree-capture-heartbeat';
const executing = new Map<string, AbortController>();
function abortRunning(): void { for (const controller of [...executing.values(), ...remoteRequests.values()]) controller.abort(); }
const remoteRequests = new Map<string, AbortController>();
// Serialize state changes only. Network inference must never block the stop hotkey.
let transitions: Promise<unknown> = Promise.resolve();
function serialize<T>(task: () => Promise<T>): Promise<T> {
  const result = transitions.then(task, task);
  transitions = result.then(() => undefined, () => undefined);
  return result;
}
async function hud(state: HudState, tabId?: number): Promise<void> {
  const previous = await getSession();
  tabId ??= previous.hudTabId ?? undefined;
  const session = await setSession({ hud: state, hudTabId: tabId ?? null });
  if (previous.hudTabId !== null && tabId !== previous.hudTabId) {
    await chrome.tabs.sendMessage(previous.hudTabId, { target: 'content', type: 'HUD_STATE', state: { phase: 'idle', text: '' } }).catch(() => undefined);
  }
  const label = session.capture || state.phase === 'listening' ? '●' : state.phase === 'thinking' ? '…' : state.phase === 'error' ? '!' : ['review', 'clarify'].includes(state.phase) ? '?' : '';
  await chrome.action.setBadgeText({ text: label });
  await chrome.action.setBadgeBackgroundColor({ color: state.phase === 'error' ? '#b54c39' : '#117c72' });
  await chrome.action.setTitle({ title: `HandsFree${session.capture ? ' · Mic on' : ''} · ${state.text}` });
  if (tabId === undefined) return;
  const message: Message = { target: 'content', type: 'HUD_STATE', state };
  try { await chrome.tabs.sendMessage(tabId, message); }
  catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      await chrome.tabs.sendMessage(tabId, message);
    } catch { /* Restricted pages still have the toolbar badge and popup. */ }
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
  const settings = await getSettings();
  if (settings.feedback !== 'none' && ['success', 'error', 'clarify'].includes(state.phase) && await hasOffscreen()) void send({ target: 'offscreen', type: 'FEEDBACK', text: state.text.slice(0, 500), mode: settings.feedback }).catch(() => undefined);
}
async function stop(text = 'Microphone off. Ready when you are.', phase: HudState['phase'] = 'idle'): Promise<void> {
  abortRunning();
  const { active, pending, question, conversation, progress } = await getSession();
  const interruptedId = active?.id ?? pending?.request.id ?? question?.request.id ?? (progress?.status === 'running' ? progress.id : undefined);
  if (interruptedId) await pauseProgress(interruptedId, 'cancelled', 'Stopped. Confirmed completed steps remain completed.');
  await cancelPage(conversation.dictation ?? conversation.page);
  conversation.dictation = null; conversation.page = null;
  await setSession({ active: null, pending: null, question: null, capture: null, conversation });
  for (const controller of remoteRequests.values()) controller.abort();
  remoteRequests.clear();
  await chrome.alarms.clear(CAPTURE_ALARM);
  await closeOffscreen();
  await finish({ phase, text }, active ?? pending?.request);
}
async function openPage(page: 'onboarding' | 'settings' | 'shortcuts'): Promise<void> {
  if (page === 'settings') { const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); await setSession({ permissionTabId: tab?.id ?? null }); }
  const url = page === 'shortcuts' ? 'chrome://extensions/shortcuts' : chrome.runtime.getURL(page === 'onboarding' ? 'src/popup/onboarding.html' : 'src/popup/popup.html?settings=1');
  await chrome.tabs.create({ url });
}
async function newRequest(): Promise<ActiveRequest> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id === undefined) throw new Error('No active Chrome tab found.');
  return { id: crypto.randomUUID(), tabId: tab.id, windowId: tab.windowId, startedAt: Date.now() };
}
async function begin(request: ActiveRequest): Promise<void> {
  const { progress } = await getSession();
  await setSession({ active: request, ...(progress?.id !== request.id ? { progress: null } : {}) });
  await chrome.alarms.create(WATCHDOG_ALARM, { when: Date.now() + MAX_COMMAND_MS });
  await touch();
}
async function completed(result: Awaited<ReturnType<typeof dispatchActions>>, request: ActiveRequest, transcript: string): Promise<void> {
  const state: HudState = { phase: 'success', text: result.text };
  await finish(state, request, transcript);
  if (result.context.tabId !== request.tabId) await hud(state, result.context.tabId);
}
async function environment(request: ActiveRequest, transcript: string, overrides: ChoiceOverrides = {}, reviewed = false): Promise<ExecutionEnvironment> {
  const [settings, library, macros, session] = await Promise.all([getSettings(), getLibrary(), getMacros(), getSession()]);
  return { settings, library, macros, state: session.conversation, overrides, operationId: request.id, transcript, reviewed };
}
async function persistExecution(env: ExecutionEnvironment): Promise<void> {
  await finalizeUndo(env);
  await setSession({ conversation: env.state });
  if ((await getSession()).capture && await hasOffscreen()) await send({ target: 'offscreen', type: 'DICTATION_MODE', enabled: !!env.state.dictation }).catch(() => undefined);
}
async function previewRoutine(routine: Routine, request: ActiveRequest, values: Record<string, string> = {}): Promise<Reply> {
  try {
    compileRoutine(routine);
    const missing = routineInputs(routine).find(name => !values[name]?.trim());
    if (missing) {
      const prompt = `What should I use for “${missing}” in ${routine.name}?`;
      await setSession({ question: { id: crypto.randomUUID(), prompt, choices: [], kind: 'text', key: `routine:${missing}`, request, actions: [], context: request, overrides: {}, at: Date.now(), routineInput: { routine, values, name: missing } } });
      await finish({ phase: 'clarify', text: prompt }, request); return { ok: true, handled: true, needsClarification: true };
    }
    const actions = compileRoutine(routine, values);
    await setSession({ pending: { request, actions, transcript: `Routine: ${routine.name}`, context: request, routine: true } });
    await finish({ phase: 'review', text: `Review “${routine.name}” in HandsFree. Say “confirm command” to start, or “cancel command”.` }, request);
    return { ok: true, handled: true, pendingReview: true };
  } catch (error) { await finish({ phase: 'error', text: errorText(error) }, request); return { ok: false, error: errorText(error) }; }
}
async function trackExecution(request: ActiveRequest, name: string, actions: ChromeAction[]): Promise<(event: ProgressEvent) => Promise<void>> {
  const update = await prepareProgress(request.id, name, actions);
  return async event => {
    await update(event);
    if (event.status === 'running') {
      const { progress } = await getSession(); if (progress?.id !== request.id) return;
      const index = progress.steps.findIndex(step => step.status === 'running'); const step = progress.steps[index];
      if (step) await hud({ phase: 'thinking', text: `Step ${index + 1} of ${progress.steps.length}: ${step.label}${step.target ? ' · ' + step.target : ''}`.slice(0, 500) }, event.context.tabId);
    }
  };
}
async function executeMacro(macro: Macro, request: ActiveRequest, transcript: string): Promise<void> {
  const controller = new AbortController(); executing.set(request.id, controller);
  const env = await environment(request, transcript); env.signal = controller.signal;
  try {
    env.onProgress = await trackExecution(request, macro.name, macro.urls.map(url => ({ action: 'create_tab', params: { url } })));
    const result = await dispatchMacro(macro, request, env);
    checkCancelled(controller.signal); await completed(result, request, transcript);
  } catch (error) { await pauseProgress(request.id, controller.signal.aborted ? 'cancelled' : 'failed', errorText(error)); if (!controller.signal.aborted) await finish({ phase: 'error', text: errorText(error) }, request, transcript); }
  finally { await persistExecution(env); executing.delete(request.id); }
}
async function executePlan(actions: ChromeAction[], source: 'grammar' | 'model', request: ActiveRequest, transcript: string, context: TargetContext = request, overrides: ChoiceOverrides = {}, reviewed = false, previewed = false): Promise<Reply> {
  if (isNegatedCommand(transcript)) { await finish({ phase: 'idle', text: 'No changes made. Say the action you want to run.' }, request); return { ok: true, handled: true }; }
  if (executing.has(request.id)) return { ok: true, handled: true };
  if (actions.some(action => action.action === 'page_action' && action.params.operation === 'dictate_start') && !(await getSession()).capture) throw new Error('Start continuous listening before starting dictation.');
  if (source === 'model') validateGrounding(actions, transcript);
  if (!reviewed && !previewed && requiresReview(actions, source, (await getSettings()).reviewAiActions)) {
    await setSession({ active: null, pending: { request, actions, transcript, context, overrides } });
    await finish({ phase: 'review', text: 'Review in HandsFree, or say “confirm command” / “cancel command” while listening.' }, request);
    return { ok: true, pendingReview: true };
  }
  const controller = new AbortController(); executing.set(request.id, controller);
  const env = await environment(request, transcript, overrides, reviewed); env.signal = controller.signal;
  try {
    env.onProgress = await trackExecution(request, transcript.startsWith('Routine:') ? transcript : 'Browser command', actions);
    const result = await dispatchActions(actions, context, env);
    checkCancelled(controller.signal); await completed(result, request, transcript);
  } catch (error) {
    if (controller.signal.aborted) { await pauseProgress(request.id, 'cancelled', 'Stopped. Confirmed completed steps remain completed.'); return { ok: true, handled: true }; }
    if (error instanceof ChoiceRequired) {
      await pauseProgress(request.id, 'waiting', error.prompt);
      await setSession({ question: { id: crypto.randomUUID(), prompt: error.prompt, choices: error.choices, kind: error.kind, key: error.key, request, actions: error.remaining, context: error.context ?? context, overrides, at: Date.now() } });
      const spokenChoices = error.choices.slice(0, 3).map((choice, index) => `${index + 1}. ${choice.label.slice(0, 60)}`).join('; ');
      await finish({ phase: 'clarify', text: `${error.prompt}${spokenChoices ? ' ' + spokenChoices : ''}`.slice(0, 500) }, request);
      return { ok: true, needsClarification: true };
    }
    if (error instanceof ReviewRequired) {
      await pauseProgress(request.id, 'waiting', error.prompt);
      await setSession({ pending: { request, actions: error.remaining, transcript, targets: error.targets, operation: error.operation, urls: error.urls, context: error.context ?? context, overrides } });
      await finish({ phase: 'review', text: error.prompt }, request);
      return { ok: true, pendingReview: true };
    }
    await pauseProgress(request.id, 'failed', errorText(error));
    await finish({ phase: 'error', text: errorText(error) }, request, transcript);
  } finally { await persistExecution(env); executing.delete(request.id); }
  return { ok: true };
}
async function answer(questionId: string, text: string): Promise<Reply> {
  const { question } = await getSession();
  if (!question || question.id !== questionId || Date.now() - question.at > 5 * 60_000) throw new Error('That question expired. Try the command again.');
  const choice = answerChoice(question, text);
  if (!choice) { await hud({ phase: 'clarify', text: 'Say an option number or a more specific title, or choose below.' }, question.request.tabId); return { ok: true, handled: true, needsClarification: true }; }
  await setSession({ question: null }); await begin({ ...question.request, startedAt: Date.now() });
  if (question.routineInput) { const { routine, values, name } = question.routineInput; return previewRoutine(routine, question.request, { ...values, [name]: choice.value! }); }
  const reply = await executePlan(question.actions, 'grammar', question.request, `Answered: ${choice.label}`, question.context, { ...question.overrides, [question.key]: choice });
  return { ...reply, ...(reply.ok ? { handled: true } : {}) };
}
async function review(requestId: string, approved: boolean): Promise<void> {
  const { pending } = await getSession();
  if (!pending || pending.request.id !== requestId) throw new Error('This plan has expired. Try the command again.');
  await setSession({ pending: null });
  if (!approved) { await pauseProgress(pending.request.id, 'cancelled', 'Review dismissed.'); await finish({ phase: 'idle', text: 'Command dismissed' }, pending.request); return; }
  if (Date.now() - pending.request.startedAt > 5 * 60_000) { await finish({ phase: 'error', text: 'This plan expired. Try the command again.' }, pending.request); return; }
  await begin(pending.request);
  if (!pending.operation) { await executePlan(pending.actions, 'grammar', pending.request, pending.transcript, pending.context ?? pending.request, pending.overrides, !pending.routine, !!pending.routine); return; }
  const controller = new AbortController(); executing.set(pending.request.id, controller);
  let succeeded = false;
  try {
    if (pending.operation === 'close') {
      const targets = pending.targets ?? [];
      const tabs = await Promise.all(targets.map(target => chrome.tabs.get(target.id)));
      const duplicates = /duplicate|copies/i.test(pending.transcript);
      if (tabs.some((tab, index) => tab.url !== targets[index]?.url || tab.windowId !== targets[index]?.windowId || (duplicates && (tab.active || tab.pinned)))) throw new Error('A reviewed tab changed. Run the command again to review the current targets.');
      checkCancelled(controller.signal); await chrome.tabs.remove(tabs.map(tab => tab.id!));
      await completeReviewedProgress(pending.request.id, `Closed ${tabs.length} reviewed tabs`);
      await finish({ phase: 'success', text: `Closed ${tabs.length} reviewed tabs` }, pending.request, pending.transcript);
    } else {
      let opened = 0;
      for (const url of pending.urls ?? []) { checkCancelled(controller.signal); if (!isSafeUrl(url)) throw new Error('An article URL is invalid.'); await chrome.tabs.create({ url, windowId: pending.request.windowId, active: opened++ === 0 }); }
      await completeReviewedProgress(pending.request.id, `Opened ${opened} unread articles`);
      await finish({ phase: 'success', text: `Opened ${opened} unread articles` }, pending.request, pending.transcript);
    }
    const session = await getSession(); session.conversation.lastUndoId = null; await setSession({ conversation: session.conversation });
    succeeded = true;
  } catch (error) { await pauseProgress(pending.request.id, controller.signal.aborted ? 'cancelled' : 'failed', errorText(error)); if (!controller.signal.aborted) await finish({ phase: 'error', text: errorText(error) }, pending.request, pending.transcript); }
  finally { executing.delete(pending.request.id); }
  if (succeeded && pending.actions.length) {
    await begin({ ...pending.request, startedAt: Date.now() });
    await executePlan(pending.actions, 'grammar', pending.request, pending.transcript, pending.context ?? pending.request, pending.overrides);
  }
}
async function interrupt(replacement?: string, stopListening = false, sessionId?: string): Promise<Reply> {
  const previous = await getSession();
  if (sessionId && previous.capture?.id !== sessionId) return { ok: true, handled: true };
  const settings = await getSettings();
  await stop(stopListening ? 'Microphone off. Ready when you are.' : 'Command cancelled.');
  let reply: Reply = { ok: true, handled: true };
  if (replacement) {
    const request = await newRequest(); await begin(request);
    const env = await environment(request, replacement);
    const currentId = previous.active?.id ?? previous.question?.request.id ?? previous.pending?.request.id;
    if (Date.now() - env.state.at < 60_000 && env.state.lastUndoId && (!currentId || env.state.lastUndoId === currentId)) {
      try { await applyUndo(env); await persistExecution(env); } catch { /* Keep newer manual changes. */ }
    }
    let actions = parseCommand(replacement.replace(/\s+instead[.!?]*$/i, ''));
    let context: TargetContext = request;
    if (actions?.[0]?.action === 'reference_tabs' && previous.question) {
      const selector = previous.question.actions[0];
      if (selector && ['find_tab', 'select_tab', 'reference_tabs', 'select_tabs', 'tab_set'].includes(selector.action)) { actions = [selector, ...actions.slice(1)]; context = previous.question.context; }
      else { await finish({ phase: 'error', text: 'Name the tab to correct, such as “pin the Gmail tab”.' }, request); actions = null; }
    }
    if (actions?.[0]?.action === 'reference_tabs' && previous.pending?.targets?.length) { env.state.targets = previous.pending.targets; env.state.at = Date.now(); await persistExecution(env); }
    if (actions) reply = await executePlan(actions, 'grammar', request, replacement, context, previous.question?.overrides);
    else await finish({ phase: 'error', text: 'Try the correction as a complete command, such as “pin it instead”.' }, request);
  }
  if (previous.capture && !stopListening) {
    const id = crypto.randomUUID(); await setSession({ capture: { id, startedAt: Date.now(), lastSeen: Date.now() } });
    await chrome.alarms.create(CAPTURE_ALARM, { periodInMinutes: 0.5 }); await ensureOffscreen();
    await send({ target: 'offscreen', type: 'START_LISTENING', requestId: id, settings });
    const current = await getSession(); if (!current.pending && !current.question) await hud({ phase: 'listening', text: replacement ? current.hud.text : 'Command cancelled. Listening…' });
  }
  return reply;
}
async function start(text?: string, macroId?: string, routineId?: string): Promise<void> {
  const session = await getSession();
  if (text !== undefined) {
    const intent = interruptIntent(text); if (intent) { await interrupt(intent.replacement, intent.stopListening); return; }
    if (session.question) { await answer(session.question.id, text); return; }
    if (session.pending && reviewIntent(text) !== undefined) { await review(session.pending.request.id, reviewIntent(text)!); return; }
  }
  if (session.active || session.capture || session.pending || session.question) {
    if (text !== undefined || macroId !== undefined || routineId !== undefined) throw new Error('Stop listening or finish the current command before starting another.');
    await stop(); return;
  }
  const settings = await getSettings();
  const routines = await getRoutines();
  const invocation = text !== undefined ? matchRoutine(routines, text) : undefined;
  const routine = routineId ? routines.find(item => item.id === routineId) : invocation?.routine;
  if (routineId && !routine) throw new Error('This routine no longer exists.');
  if (routine) { const request = await newRequest(); await begin(request); await previewRoutine(routine, request, invocation?.values); return; }
  const macros = await getMacros();
  const macro = macroId !== undefined ? macros.find(item => item.id === macroId) : text !== undefined ? findMacro(macros, text) : undefined;
  if (macroId !== undefined && !macro) throw new Error('This macro no longer exists.');
  if (text === undefined && !macro && !settings.micGranted) { await openPage('onboarding'); return; }
  const request = await newRequest();
  const continuous = text === undefined && !macro && settings.listeningMode === 'continuous';
  if (continuous) {
    await setSession({ capture: { id: request.id, startedAt: Date.now(), lastSeen: Date.now() } });
    await chrome.alarms.create(CAPTURE_ALARM, { periodInMinutes: 0.5 });
    await touch();
  } else await begin(request);
  await hud({ phase: text === undefined && !macro ? 'listening' : 'thinking', text: macro ? `Opening ${macro.name}…` : text === undefined ? 'Listening… press the shortcut again to stop.' : 'Interpreting your command…' }, request.tabId);
  if (macro) { await executeMacro(macro, request, text ?? macro.phrase); return; }
  try {
    await ensureOffscreen();
    const reply = await withTimeout(send(text === undefined
      ? { target: 'offscreen', type: 'START_LISTENING', requestId: request.id, settings }
      : { target: 'offscreen', type: 'PARSE_TEXT', requestId: request.id, settings, text }), 10_000, 'The voice engine did not respond. Try again.');
    if (!reply?.ok) throw new Error(reply && !reply.ok ? reply.error : 'The voice engine did not respond.');
  } catch (error) { await stop(errorText(error), 'error'); throw error; }
}
async function snapshot(readOnly = false): Promise<AppState> {
  const [session, settings, macros, log, commands, engineOpen, library] = await Promise.all([getSession(), getSettings(), getMacros(), getLog(), chrome.commands.getAll(), hasOffscreen(), getLibrary()]);
  if (session.capture && !engineOpen && !readOnly) { await stop('The microphone stopped. Press the shortcut to start again.', 'error'); return snapshot(); }
  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const permissionTab = activeTab?.url?.startsWith('http') ? activeTab : session.permissionTabId ? await chrome.tabs.get(session.permissionTabId).catch(() => undefined) : undefined;
  let activeSiteOrigin: string | undefined; try { if (permissionTab?.url && isSafeUrl(permissionTab.url)) activeSiteOrigin = new URL(permissionTab.url).origin + '/*'; } catch { /* No website permission target. */ }
  return { progress: session.progress, routines: await getRoutines(), library, question: session.question, dictation: session.conversation.dictation, contextTargets: session.conversation.targets, activeSiteOrigin, settings, macros, log, hud: session.hud, pending: session.pending, shortcut: commands.find(c => c.name === 'toggle-listening')?.shortcut ?? '', engineOpen, listening: !!session.capture || (session.hud.phase === 'listening' && !!session.active), hasApiKey: !!(await getApiKey(settings)) };
}
async function cloud(message: Extract<Message, { type: 'PARSE_CLOUD' | 'TEST_AI_CONNECTION' }>): Promise<Reply> {
  const id = message.type === 'PARSE_CLOUD' ? message.requestId : 'connection-test';
  const setup = await serialize(async () => {
    const active = (await getSession()).active;
    if (message.type === 'PARSE_CLOUD' && active?.id !== id) return undefined;
    const settings = await getSettings();
    if (message.type === 'PARSE_CLOUD' && !settings.aiEnabled) throw new Error('Enable AI in Settings first.');
    if (remoteRequests.has(id)) return undefined;
    const controller = new AbortController(); remoteRequests.set(id, controller);
    return { settings, controller };
  });
  if (!setup) return { ok: true, handled: true };
  try {
    const actions = await parseCloud(setup.settings, message.type === 'PARSE_CLOUD' ? message.text : 'open a new tab', setup.controller.signal);
    return await serialize(async () => {
      if (setup.controller.signal.aborted) return { ok: true, handled: true };
      if (message.type === 'TEST_AI_CONNECTION') return { ok: true, message: 'Connection works. The model returned a valid browser plan; no command was run.' };
      const { active } = await getSession();
      if (active?.id !== id) return { ok: true, handled: true };
      return executePlan(actions, 'model', active, message.text);
    });
  } catch (error) {
    return await serialize(async () => {
      if (setup.controller.signal.aborted) return { ok: true, handled: true };
      const { active } = await getSession();
      if (message.type === 'PARSE_CLOUD' && active?.id === id) await finish({ phase: 'error', text: errorText(error) }, active);
      return { ok: false, error: errorText(error) };
    });
  } finally { if (remoteRequests.get(id) === setup.controller) remoteRequests.delete(id); }
}
async function handle(message: Message): Promise<Reply> {
  if (message.target !== 'background') return { ok: false, error: 'Wrong destination' };
  switch (message.type) {
    case 'IMPORT_ROUTINES': await addImportedRoutines(message.routines); break;
    case 'SAVE_ROUTINE': await saveRoutine(message.routine); break;
    case 'DELETE_ROUTINE': await deleteRoutine(message.id); break;
    case 'RUN_ROUTINE': await start(undefined, undefined, message.id); break;
    case 'SAVE_ALIAS': await saveAlias(message.alias); break;
    case 'DELETE_ALIAS': await deleteAlias(message.id); break;
    case 'DELETE_WORKSPACE': await deleteWorkspace(message.id); break;
    case 'RESTORE_WORKSPACE': {
      if ((await getSession()).active) throw new Error('Finish the current command first.');
      const request = await newRequest(); await begin(request);
      return executePlan([{ action: 'workspace_action', params: { operation: 'restore', name: message.id } }], 'grammar', request, 'Restore saved workspace');
    }
    case 'REFRESH_SITE_SUGGESTIONS': if (!(await getSettings()).learnTopSites) throw new Error('Enable Learn my sites first.'); await refreshSiteSuggestions(); break;
    case 'ANSWER_CLARIFICATION': return answer(message.questionId, message.answer);
    case 'INTERRUPT_COMMAND': return interrupt(message.replacement, message.stopListening, message.sessionId);
    case 'GET_READING_LIST': return { ok: true, readingList: await chrome.readingList.query({}) };
    case 'UPDATE_READING_ITEM':
      if (message.operation === 'open') await chrome.tabs.create({ url: message.url });
      else if (message.operation === 'remove') await chrome.readingList.removeEntry({ url: message.url });
      else await chrome.readingList.updateEntry({ url: message.url, hasBeenRead: message.operation === 'read' });
      break;
    case 'DICTATION_TEXT': {
      const session = await getSession(); if (session.capture?.id !== message.sessionId || !session.conversation.dictation) return { ok: true, handled: true };
      try { const result = await dictate(session.conversation.dictation, message.text); if (!result.ok) throw new Error(result.text); }
      catch (error) { await cancelPage(session.conversation.dictation); session.conversation.dictation = null; await setSession({ conversation: session.conversation }); await send({ target: 'offscreen', type: 'DICTATION_MODE', enabled: false }); await hud({ phase: 'error', text: errorText(error) }); }
      return { ok: true, handled: true };
    }
    case 'MICROPHONE_READY': await chrome.storage.local.set({ settings: { ...await getSettings(), micGranted: true } }); break;
    case 'GET_DIAGNOSTICS': {
      const state = await snapshot();
      const siteAllowed = !!state.activeSiteOrigin && await chrome.permissions.contains({ origins: [state.activeSiteOrigin] });
      let providerAllowed = false;
      if (state.settings.aiProvider !== 'local') { try { providerAllowed = await chrome.permissions.contains({ origins: [providerOrigin(state.settings)] }); } catch { /* Invalid configuration is reported by the check. */ } }
      return { ok: true, diagnostics: diagnosticsFor(state, siteAllowed, providerAllowed) };
    }
    case 'RUN_SETUP_COMMAND': {
      const session = await getSession(); if (session.active || session.capture || session.pending || session.question) throw new Error('Stop listening or finish the current command before the practice step.');
      const request = await newRequest(); await begin(request);
      await executePlan([{ action: 'create_tab', params: { url: 'chrome://newtab/', active: false } }], 'grammar', request, 'Open a practice tab');
      const completed = await getSession(); if (completed.hud.phase !== 'success') return { ok: false, error: completed.hud.text };
      await chrome.storage.local.set({ settings: { ...await getSettings(), setupCommandPassed: true } });
      return { ok: true, message: 'Practice passed. A blank tab opened in the background. You can close it when finished.' };
    }
    case 'GET_STATE': return { ok: true, state: await snapshot() };
    case 'TOGGLE_LISTENING': await start(); break;
    case 'RUN_TEXT': await start(message.text); break;
    case 'RUN_MACRO': await start(undefined, message.id); break;
    case 'SAVE_MACRO': {
      if (matchRoutine(await getRoutines(), message.macro.phrase)) throw new Error('A routine already uses that spoken phrase. Choose another.');
      await saveMacro(message.macro); break;
    }
    case 'DELETE_MACRO': await deleteMacro(message.id); break;
    case 'OPEN_PAGE': await openPage(message.page); break;
    case 'CLEAR_LOG': await chrome.storage.local.set({ log: [] }); break;
    case 'SAVE_SETTINGS': {
      validateProvider(message.settings);
      if (message.settings.aiProvider !== 'local' && !(await chrome.permissions.contains({ origins: [providerOrigin(message.settings)] }))) throw new Error('Allow access to your API provider when saving preferences.');
      const previous = await getSettings();
      const session = await getSession();
      if (session.active || session.capture || session.pending || remoteRequests.size) await stop('Preferences changed. Press the shortcut to start listening again.');
      if (message.apiKey) await saveApiKey(message.settings, message.apiKey);
      await chrome.storage.local.set({ settings: message.settings });
      if (previous.saveTranscripts && !message.settings.saveTranscripts) {
        const log = (await getLog()).map(entry => ({ id: entry.id, at: entry.at, text: entry.text, ok: entry.ok }));
        await chrome.storage.local.set({ log });
      }
      if (message.settings.learnTopSites) await refreshSiteSuggestions();
      else if (previous.learnTopSites) await clearSiteSuggestions();
      await touch(); break;
    }
    case 'REMOVE_API_KEY': await stop('API key removed.'); await removeApiKey(await getSettings()); break;
    case 'SLEEP_ENGINE': await stop('Engine asleep. Press the shortcut to wake it.'); break;
    case 'REVIEW_PLAN': await review(message.requestId, message.approved); break;
    case 'BEGIN_VOICE_COMMAND': {
      const session = await getSession();
      if (session.capture?.id !== message.sessionId) return { ok: true, handled: true };
      if (session.question) return answer(session.question.id, message.text);
      const intent = interruptIntent(message.text); if (intent) return interrupt(intent.replacement, intent.stopListening, message.sessionId);
      if (session.pending) {
        const approval = reviewIntent(message.text);
        if (approval !== undefined) await review(session.pending.request.id, approval);
        else return { ok: true, handled: true, pendingReview: true };
        return { ok: true, handled: true };
      }
      if (session.active) return { ok: false, error: 'A command is already running. Please wait.' };
      const request = await newRequest(); await begin(request);
      await hud({ phase: 'thinking', text: 'Interpreting your command…' }, request.tabId);
      return { ok: true, request };
    }
    case 'CAPTURE_HEARTBEAT':
    case 'CAPTURE_STATUS': {
      const session = await getSession();
      if (session.capture?.id !== message.sessionId) return { ok: true, handled: true };
      await setSession({ capture: { ...session.capture, lastSeen: Date.now() } });
      if (message.type === 'CAPTURE_STATUS') {
        if (message.fatal) await stop(message.text, 'error');
        else if (!session.active && !session.pending && !session.question) {
          const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
          await hud({ phase: 'listening', text: message.text }, tab?.id);
        }
      }
      break;
    }
    case 'VOICE_TRANSCRIPT':
    case 'ENGINE_STATUS':
    case 'ENGINE_ERROR':
    case 'EXECUTE_ACTIONS': {
      const { active, capture } = await getSession();
      if (!active || active.id !== message.requestId) return { ok: true, handled: true };
      if (message.type === 'VOICE_TRANSCRIPT') {
        if (message.final) {
          if (isNegatedCommand(message.text)) { await finish({ phase: 'idle', text: 'No changes made. Say the action you want to run.' }, active); return { ok: true, handled: true }; }
          const intent = interruptIntent(message.text); if (intent) return interrupt(intent.replacement, intent.stopListening);
          const routine = matchRoutine(await getRoutines(), message.text);
          if (routine) return previewRoutine(routine.routine, active, routine.values);
          const macro = findMacro(await getMacros(), message.text);
          if (macro) { await executeMacro(macro, active, message.text); return { ok: true, handled: true }; }
          const actions = parseCommand(message.text);
          if (actions) { const result = await executePlan(actions, 'grammar', active, message.text); return { ...result, ...(result.ok ? { handled: true } : {}) }; }
        }
        await hud({ phase: message.final ? 'thinking' : 'listening', text: message.final ? 'Thinking…' : message.text }, active.tabId);
      } else if (message.type === 'ENGINE_STATUS') await hud({ phase: 'thinking', text: message.text }, active.tabId);
      else if (message.type === 'ENGINE_ERROR') {
        if (!capture) await closeOffscreen();
        await finish({ phase: 'error', text: message.error }, active);
      } else {
        try { return await executePlan(message.actions, message.source, active, message.transcript); }
        catch (error) { await finish({ phase: 'error', text: errorText(error) }, active); return { ok: false, error: errorText(error) }; }
      }
      break;
    }
  }
  return { ok: true };
}
const engineTypes = new Set(['VOICE_TRANSCRIPT', 'ENGINE_STATUS', 'ENGINE_ERROR', 'EXECUTE_ACTIONS', 'PARSE_CLOUD', 'BEGIN_VOICE_COMMAND', 'CAPTURE_HEARTBEAT', 'CAPTURE_STATUS', 'DICTATION_TEXT']);
chrome.runtime.onMessage.addListener((raw: unknown, sender, respond: (reply: Reply) => void): boolean => {
  const parsed = messageSchema.safeParse(raw);
  if (!parsed.success || parsed.data.target !== 'background' || sender.id !== chrome.runtime.id) return false;
  const message = parsed.data; const path = sender.url?.split('?')[0];
  const trusted = message.type === 'INTERRUPT_COMMAND' ? [chrome.runtime.getURL(OFFSCREEN_PATH), chrome.runtime.getURL('src/popup/popup.html')].includes(path ?? '') : engineTypes.has(message.type) ? path === chrome.runtime.getURL(OFFSCREEN_PATH)
    : [chrome.runtime.getURL('src/popup/popup.html'), chrome.runtime.getURL('src/popup/onboarding.html')].includes(path ?? '');
  if (!trusted) { respond({ ok: false, error: 'Untrusted message source' }); return false; }
  if (message.type === 'INTERRUPT_COMMAND') {
    void (async () => {
      if (message.sessionId && (await getSession()).capture?.id !== message.sessionId) return { ok: true, handled: true } as Reply;
      abortRunning(); return serialize(() => handle(message));
    })().then(respond, (error: unknown) => respond({ ok: false, error: errorText(error) }));
    return true;
  }
  if (message.type === 'TOGGLE_LISTENING' || message.type === 'SLEEP_ENGINE' || (message.type === 'RUN_TEXT' && interruptIntent(message.text))) abortRunning();
  const result = message.type === 'GET_STATE' && executing.size > 0 ? snapshot(true).then(state => ({ ok: true as const, state })) : message.type === 'PARSE_CLOUD' || message.type === 'TEST_AI_CONNECTION' ? cloud(message) : serialize(() => handle(message));
  void result.then(respond, (error: unknown) => respond({ ok: false, error: errorText(error) }));
  return true;
});
chrome.commands.onCommand.addListener(command => {
  if (command === 'toggle-listening') { abortRunning(); void serialize(() => start()).catch(async error => { await hud({ phase: 'error', text: errorText(error) }); }); }
});
chrome.alarms.onAlarm.addListener(alarm => {
  if (![IDLE_ALARM, WATCHDOG_ALARM, CAPTURE_ALARM].includes(alarm.name)) return;
  void serialize(async () => {
    const session = await getSession();
    if (alarm.name === CAPTURE_ALARM) {
      if (!session.capture) { await chrome.alarms.clear(CAPTURE_ALARM); return; }
      if (Date.now() - session.capture.lastSeen > 60_000 || !(await hasOffscreen())) await stop('The microphone stopped responding. Press the shortcut to restart it.', 'error');
    } else if (alarm.name === WATCHDOG_ALARM) {
      if (!session.active) return;
      if (Date.now() - session.active.startedAt < MAX_COMMAND_MS) { await chrome.alarms.create(WATCHDOG_ALARM, { when: session.active.startedAt + MAX_COMMAND_MS }); return; }
      await stop('The command timed out. Press the shortcut to try again.', 'error');
    } else if ((await getSettings()).mode === 'power-saver') {
      if (session.capture || session.active || Date.now() - session.lastActivity < IDLE_MS) { await chrome.alarms.create(IDLE_ALARM, { when: Math.max(Date.now() + 30_000, session.lastActivity + IDLE_MS) }); return; }
      await closeOffscreen();
      if (!session.pending && !session.question) await hud({ phase: 'idle', text: 'Engine asleep. Ready when you are.' });
    }
  }).catch(error => console.error('HandsFree lifecycle:', errorText(error)));
});
chrome.runtime.onInstalled.addListener(details => {
  void serialize(async () => {
    await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    await chrome.storage.local.set({ settings: await getSettings() });
    await stop('Ready when you are'); await setSession({ conversation: emptyConversation() });
    if (details.reason === 'install') await openPage('onboarding');
  });
});
chrome.runtime.onStartup.addListener(() => { void serialize(async () => { await stop('Ready when you are'); await setSession({ conversation: emptyConversation() }); }); });
