// Explicit fixture data for visual QA; this script cannot control Chrome.
const fixtureListeners = new Set();
const fixture = {
  settings: { mode: 'power-saver', triggerPhrase: '', language: 'en-US', aiEnabled: false, saveTranscripts: false, micGranted: true },
  hud: { phase: 'idle', text: 'Ready when you are' }, log: [], pending: null, shortcut: '⌘ ⇧ Space', engineOpen: false,
};
globalThis.chrome = {
  storage: { onChanged: { addListener: fn => fixtureListeners.add(fn), removeListener: fn => fixtureListeners.delete(fn) } },
  runtime: { sendMessage: async message => {
    if (message.type === 'GET_STATE') return { ok: true, state: structuredClone(fixture) };
    if (message.type === 'SAVE_SETTINGS') fixture.settings = message.settings;
    if (message.type === 'CLEAR_LOG') fixture.log = [];
    if (message.type === 'SLEEP_ENGINE') { fixture.engineOpen = false; fixture.hud = { phase: 'idle', text: 'Engine asleep' }; }
    if (message.type === 'OPEN_PAGE') location.href = message.page === 'onboarding' ? '/src/popup/onboarding.html' : '/src/popup/popup.html?settings=1';
    if (message.type === 'RUN_TEXT' || message.type === 'TOGGLE_LISTENING') {
      fixture.engineOpen = true;
      fixture.hud = { phase: message.type === 'RUN_TEXT' ? 'thinking' : 'listening', text: message.type === 'RUN_TEXT' ? 'Interpreting your command locally…' : 'Listening…' };
      setTimeout(() => {
        fixture.hud = { phase: 'success', text: 'Opened a new tab (UI preview)' };
        fixture.log.unshift({ id: crypto.randomUUID(), at: Date.now(), text: 'Opened a new tab (UI preview)', ok: true });
        fixtureListeners.forEach(fn => fn());
      }, 1800);
    }
    fixtureListeners.forEach(fn => fn());
    return { ok: true };
  } },
};
