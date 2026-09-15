import { CommandFailure } from '../common/recovery';
import { isSetupCommand } from '../common/setup';
import { speechChoices, spokenCorrection } from '../common/speech-intent';
import { LOCAL_AI_AVAILABLE } from '../common/build';
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
  await setSession({ active: null, ...(transcript ? { transcript } : {}) });
  await chrome.alarms.clear(WATCHDOG_ALARM);
  await hud(state, request?.tabId);
  if (state.phase === 'success' || state.phase === 'error') await addLog(state.text, state.phase === 'success', transcript);
  await touch();
  const settings = await getSettings();
  if (settings.feedback !== 'none' && ['success', 'error', 'clarify'].includes(state.phase) && await hasOffscreen()) void send({ target: 'offscreen', type: 'FEEDBACK', text: state.text.slice(0, 500), mode: settings.feedback }).catch(() => undefined);
}
async function stop(text = 'Microphone off. Ready when you are.', phase: HudState['phase'] = 'idle'): Promise<void> {
  abortRunning();
  const { active, pending, question, conversation, progress, voiceSetup } = await getSession();
  const interruptedId = active?.id ?? pending?.request.id ?? question?.request.id ?? (progress?.status === 'running' ? progress.id : undefined);
  if (interruptedId) await pauseProgress(interruptedId, 'cancelled', 'Stopped. Confirmed completed steps remain completed.');
  await cancelPage(conversation.dictation ?? conversation.page);
  conversation.dictation = null; conversation.page = null;
  await setSession({ active: null, pending: null, question: null, capture: null, recovery: null, conversation, ...(voiceSetup?.status === 'running' ? { voiceSetup: { ...voiceSetup, status: phase === 'error' ? 'failed' : 'cancelled', detail: text } } : {}) });
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
  await setSession({ active: request, transcript: null, recovery: null, ...(progress?.id !== request.id ? { progress: null } : {}) });
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
    if (error instanceof CommandFailure) await setSession({ recovery: {
      id: crypto.randomUUID(), at: Date.now(), kind: error.kind, detail: error.message,
      request, transcript, source, actions: error.remaining, context: error.context ?? context, overrides,
      origin: error.origin, targetUrl: error.targetUrl, choiceKey: error.choiceKey,
    } });
    await finish({ phase: 'error', text: errorText(error) }, request, transcript);
  } finally { await persistExecution(env); executing.delete(request.id); }
  return { ok: true };
}
async function handleTranscript(request: ActiveRequest, raw: string, spoken = false, alternatives: string[] = []): Promise<Reply> {
  const session = await getSession();
  if (session.voiceSetup?.id === request.id) {
    const setup = { ...session.voiceSetup, transcript: raw };
    if (!isSetupCommand(raw) || alternatives.some(text => !isSetupCommand(text))) {
      const detail = `I heard “${raw}”. For this practice, say only “open a new tab”. No command was run.`;
      await setSession({ voiceSetup: { ...setup, status: 'failed', stage: 'interpretation', detail } });
      await finish({ phase: 'error', text: detail.slice(0, 500) }, request);
      return { ok: true, handled: true };
    }
    await setSession({ voiceSetup: { ...setup, stage: 'browser', detail: 'Speech understood. Opening and checking the practice tab…' } });
    await executePlan([{ action: 'create_tab', params: { url: 'chrome://newtab/', active: false } }], 'grammar', request, raw);
    const result = await getSession(); const created = result.conversation.targets[0];
    const tab = created ? await chrome.tabs.get(created.id).catch(() => undefined) : undefined;
    if (result.hud.phase !== 'success' || !tab?.id || tab.id === request.tabId || tab.windowId !== request.windowId || (tab.url ?? tab.pendingUrl) !== 'chrome://newtab/') {
      const detail = result.hud.phase === 'error' ? result.hud.text : 'Speech was understood, but the practice tab could not be verified. Check the opened tabs before trying again.';
      await setSession({ voiceSetup: { ...setup, status: 'failed', stage: 'browser', detail } });
      await finish({ phase: 'error', text: detail }, request); return { ok: true, handled: true };
    }
    await chrome.storage.local.set({ settings: { ...await getSettings(), setupCommandPassed: true, setupVoicePassed: true, micGranted: true } });
    await setSession({ voiceSetup: { ...setup, status: 'passed', stage: 'complete', tabId: tab.id, detail: 'You did it. Your spoken command opened a new tab, and Chrome confirmed it. The microphone is off.' } });
    return { ok: true, handled: true };
  }
  if (isNegatedCommand(raw)) { await finish({ phase: 'idle', text: 'No changes made. Say the action you want to run.' }, request); return { ok: true, handled: true }; }
  const routines = await getRoutines(); const macros = await getMacros();
  if (spoken) {
    const choices = speechChoices(raw, alternatives, text => {
      const routine = matchRoutine(routines, text); if (routine) return `routine:${routine.routine.id}:${JSON.stringify(routine.values)}`;
      const macro = findMacro(macros, text); if (macro) return `macro:${macro.id}`;
      const actions = parseCommand(text); return actions ? JSON.stringify(actions) : undefined;
    });
    if (choices.length) {
      const prompt = `I heard more than one possible command. Which did you mean?`;
      await setSession({ question: { id: crypto.randomUUID(), speechChoice: true, kind: 'speech', key: 'speech', prompt, choices: choices.map((value, i) => ({ id: `speech-${i}`, label: value, value })), request, actions: [], context: request, overrides: {}, at: Date.now() } });
      await finish({ phase: 'clarify', text: `${prompt} ${choices.map((text, i) => `${i + 1}. ${text}`).join('; ')}`.slice(0, 500) }, request);
      return { ok: true, handled: true, needsClarification: true };
    }
  }
  // A saved exact phrase retains precedence over conversational rewriting.
  const text = spoken && !matchRoutine(routines, raw) && !findMacro(macros, raw) ? spokenCorrection(raw) : raw;
  const intent = interruptIntent(text); if (intent) return interrupt(intent.replacement, intent.stopListening);
  const routine = matchRoutine(routines, text);
  if (routine) return previewRoutine(routine.routine, request, routine.values);
  const macro = findMacro(macros, text);
  if (macro) { await executeMacro(macro, request, text); return { ok: true, handled: true }; }
  const actions = parseCommand(text);
  if (actions) { const result = await executePlan(actions, 'grammar', request, text); return { ...result, ...(result.ok ? { handled: true } : {}) }; }
  return { ok: true };
}
async function answer(questionId: string, text: string): Promise<Reply> {
  const { question } = await getSession();
  if (!question || question.id !== questionId || Date.now() - question.at > 5 * 60_000) throw new Error('That question expired. Try the command again.');
  const choice = answerChoice(question, text);
  if (!choice) { await hud({ phase: 'clarify', text: 'Say an option number or a more specific title, or choose below.' }, question.request.tabId); return { ok: true, handled: true, needsClarification: true }; }
  await setSession({ question: null }); await begin({ ...question.request, startedAt: Date.now() });
  if (question.speechChoice && choice.value) {
    await setSession({ transcript: choice.value });
    return handleTranscript(question.request, choice.value, true);
  }
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
  const permissionTab = activeTab?.url?.startsWith('http') ? activeTab : activeTab?.url?.startsWith(chrome.runtime.getURL('src/popup/')) && session.permissionTabId ? await chrome.tabs.get(session.permissionTabId).catch(() => undefined) : undefined;
  let activeSiteOrigin: string | undefined; try { if (permissionTab?.url && isSafeUrl(permissionTab.url)) activeSiteOrigin = new URL(permissionTab.url).origin + '/*'; } catch { /* No website permission target. */ }
  const recovery = session.recovery;
  const recoveryView = recovery && Date.now() - recovery.at < 5 * 60_000 ? {
    id: recovery.id, kind: recovery.kind, detail: recovery.detail, origin: recovery.origin,
    canResume: recovery.kind === 'site-access' && recovery.actions.length > 0 && !!recovery.origin && await chrome.permissions.contains({ origins: [recovery.origin] }),
    canChooseTab: recovery.kind === 'missing-target' && recovery.actions[0]?.action === 'find_tab' && !!recovery.choiceKey,
  } : null;
  return { recovery: recoveryView, voiceSetup: session.voiceSetup, localAiAvailable: LOCAL_AI_AVAILABLE, transcript: session.transcript, currentWindowId: activeTab?.windowId, activeTabTitle: activeTab?.title, progress: session.progress, routines: await getRoutines(), library, question: session.question, dictation: session.conversation.dictation, contextTargets: session.conversation.targets, activeSiteOrigin, settings, macros, log, hud: session.hud, pending: session.pending, shortcut: commands.find(c => c.name === 'toggle-listening')?.shortcut ?? '', engineOpen, listening: !!session.capture || (session.hud.phase === 'listening' && !!session.active), hasApiKey: !!(await getApiKey(settings)) };
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
    case 'RESUME_COMMAND':
    case 'CHOOSE_RECOVERY_TAB': {
      const session = await getSession(); const recovery = session.recovery;
      if (!recovery || recovery.id !== message.id || Date.now() - recovery.at > 5 * 60_000) throw new Error('That recovery expired. Edit the command and review completed steps before trying again.');
      if (session.active || session.pending || session.question) throw new Error('Finish the current command first.');
      if (message.type === 'CHOOSE_RECOVERY_TAB') {
        if (recovery.kind !== 'missing-target' || recovery.actions[0]?.action !== 'find_tab' || !recovery.choiceKey) throw new Error('This command cannot be retargeted safely. Edit it instead.');
        const tabs = (await chrome.tabs.query({})).filter(tab => tab.id !== undefined).sort((a, b) => Number(b.windowId === recovery.context.windowId) - Number(a.windowId === recovery.context.windowId)).slice(0, 50);
        if (!tabs.length) throw new Error('No open tabs are available.');
        await setSession({ recovery: null, question: { id: crypto.randomUUID(), prompt: 'Choose an open tab for the remaining command. Completed steps will stay completed.', kind: 'tabs', key: recovery.choiceKey, choices: tabs.map(tab => ({ id: String(tab.id), label: tab.title || 'Untitled tab', detail: `Window ${tab.windowId}`, tabs: [{ id: tab.id!, windowId: tab.windowId, title: tab.title ?? '', url: tab.url ?? '' }] })), request: recovery.request, actions: recovery.actions, context: recovery.context, overrides: recovery.overrides, at: Date.now() } });
        await finish({ phase: 'clarify', text: 'Choose a tab below, or say its option number. Completed steps will stay completed.' }, recovery.request);
        break;
      }
      if (recovery.kind !== 'site-access' || !recovery.actions.length || !recovery.origin || !recovery.targetUrl) throw new Error('This command cannot be resumed safely. Review what happened and edit it instead.');
      if (!(await chrome.permissions.contains({ origins: [recovery.origin] }))) throw new Error('Allow the requested site before resuming.');
      const target = await chrome.tabs.get(recovery.context.tabId).catch(() => undefined);
      if (!target || target.windowId !== recovery.context.windowId || target.url !== recovery.targetUrl || target.pendingUrl) throw new Error('The target page changed. Edit a fresh command instead of resuming this one.');
      // Consume the recovery once, preserving the original target and completed steps.
      await setSession({ recovery: null }); await begin({ ...recovery.request, startedAt: Date.now() });
      await setSession({ transcript: recovery.transcript });
      return executePlan(recovery.actions, recovery.source, recovery.request, recovery.transcript, recovery.context, recovery.overrides);
    }
    case 'START_VOICE_SETUP': {
      const session = await getSession();
      if (session.active || session.capture || session.pending || session.question) throw new Error('Finish the current command or stop listening before the spoken practice.');
      const settings = await getSettings();
      if (!settings.micGranted) throw new Error('Enable the microphone in this setup guide before the spoken practice.');
      const request = await newRequest(); await begin(request);
      await chrome.storage.local.set({ settings: { ...settings, voicePace: message.pace ?? settings.voicePace, setupVoicePassed: false } });
      await setSession({ voiceSetup: { id: request.id, status: 'running', stage: 'microphone', detail: 'Starting the microphone…' } });
      await hud({ phase: 'listening', text: 'Say “open a new tab”.' }, request.tabId);
      try {
        await ensureOffscreen();
        const reply = await withTimeout(send({ target: 'offscreen', type: 'START_LISTENING', requestId: request.id, settings: { ...settings, voicePace: message.pace ?? settings.voicePace, aiEnabled: false, triggerPhrase: '', listeningMode: 'single' } }), 10_000, 'The voice engine did not respond. Try again.');
        if (!reply.ok) throw new Error(reply.error);
      } catch (error) { await stop(errorText(error), 'error'); throw error; }
      break;
    }
    case 'CANCEL_VOICE_SETUP': {
      const session = await getSession();
      if (session.voiceSetup?.id === message.id && session.voiceSetup.status === 'running') await stop('Spoken practice stopped.');
      break;
    }
    case 'ENGINE_LISTENING': {
      const session = await getSession();
      if (session.active?.id !== message.requestId) return { ok: true, handled: true };
      if (session.voiceSetup?.id === message.requestId) await setSession({ voiceSetup: { ...session.voiceSetup, stage: 'speech', detail: 'Listening. Say “open a new tab”.' } });
      await hud({ phase: 'listening', text: session.voiceSetup?.id === message.requestId ? 'Say “open a new tab”.' : 'Listening…' }, session.active.tabId);
      break;
    }
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
      if (message.settings.aiEnabled || message.apiKey) validateProvider(message.settings);
      if (message.settings.aiEnabled && message.settings.aiProvider === 'local' && !LOCAL_AI_AVAILABLE) throw new Error('Local AI is not included in this edition. Choose a cloud provider or leave AI off.');
      if ((message.settings.aiEnabled || message.apiKey) && message.settings.aiProvider !== 'local' && !(await chrome.permissions.contains({ origins: [providerOrigin(message.settings)] }))) throw new Error('Allow access to your API provider when saving preferences.');
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
        else if (!session.active && !session.pending && !session.question && session.hud.phase !== 'error') {
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
        await setSession({ transcript: message.text });
        if (message.final) {
          const result = await handleTranscript(active, message.text, message.spoken, message.alternatives);
          if (!result.ok || result.handled || result.pendingReview || result.needsClarification) return result;
        } else {
          const { voiceSetup } = await getSession();
          if (voiceSetup?.id === active.id) await setSession({ voiceSetup: { ...voiceSetup, stage: 'speech', transcript: message.text, detail: 'Listening… finish with “open a new tab”.' } });
        }
        await hud({ phase: message.final ? 'thinking' : 'listening', text: message.final ? 'Thinking…' : message.text }, active.tabId);
      } else if (message.type === 'ENGINE_STATUS') await hud({ phase: 'thinking', text: message.text }, active.tabId);
      else if (message.type === 'ENGINE_ERROR') {
        const { voiceSetup } = await getSession();
        if (voiceSetup?.id === active.id) await setSession({ voiceSetup: { ...voiceSetup, status: 'failed', detail: message.error } });
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
const engineTypes = new Set(['ENGINE_LISTENING', 'VOICE_TRANSCRIPT', 'ENGINE_STATUS', 'ENGINE_ERROR', 'EXECUTE_ACTIONS', 'PARSE_CLOUD', 'BEGIN_VOICE_COMMAND', 'CAPTURE_HEARTBEAT', 'CAPTURE_STATUS', 'DICTATION_TEXT']);
chrome.runtime.onMessage.addListener((raw: unknown, sender, respond: (reply: Reply) => void): boolean => {
  const parsed = messageSchema.safeParse(raw);
  if (!parsed.success || parsed.data.target !== 'background' || sender.id !== chrome.runtime.id) return false;
  const message = parsed.data; const path = sender.url?.split('?')[0];
  const trusted = message.type === 'INTERRUPT_COMMAND' ? [chrome.runtime.getURL(OFFSCREEN_PATH), chrome.runtime.getURL('src/popup/popup.html'), chrome.runtime.getURL('src/popup/sidepanel.html'), chrome.runtime.getURL('src/popup/onboarding.html')].includes(path ?? '') : engineTypes.has(message.type) ? path === chrome.runtime.getURL(OFFSCREEN_PATH)
    : [chrome.runtime.getURL('src/popup/popup.html'), chrome.runtime.getURL('src/popup/sidepanel.html'), chrome.runtime.getURL('src/popup/onboarding.html')].includes(path ?? '');
  if (!trusted) { respond({ ok: false, error: 'Untrusted message source' }); return false; }
  if (message.type === 'CANCEL_VOICE_SETUP') {
    void (async () => {
      const session = await getSession();
      if (session.voiceSetup?.id !== message.id || session.voiceSetup.status !== 'running') return { ok: true } as Reply;
      abortRunning(); return serialize(() => handle(message));
    })().then(respond, (error: unknown) => respond({ ok: false, error: errorText(error) }));
    return true;
  }
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
chrome.tabs.onUpdated?.addListener((tabId, change) => {
  if (!change.url && change.status !== 'loading') return;
  void serialize(async () => {
    const { recovery } = await getSession();
    if (recovery?.kind === 'site-access' && recovery.context.tabId === tabId) await setSession({ recovery: null });
  });
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
