// Explicit fixture data for visual QA; this script cannot control Chrome.
const fixtureListeners = new Set();
const fixture = {
  settings: { mode: 'power-saver', triggerPhrase: '', language: 'en-US', aiEnabled: false, aiProvider: 'local', aiModel: '', aiBaseUrl: '', reviewAiActions: false, listeningMode: 'continuous', saveTranscripts: false, micGranted: true, setupCommandPassed: false, reuseTabs: true, learnTopSites: false, feedback: 'none', siteDefaults: {} },
  routines: [],
  macros: JSON.parse(localStorage.getItem('handsfree-preview-macros') ?? '[]'),
  library: { aliases: [], suggestions: [], workspaces: [{ id: '5fba5c60-17d4-4e32-bbc8-cf39a5aa102a', name: 'Research · fixture', createdAt: Date.now(), tabs: [{ url: 'https://example.com/', title: 'Project notes', pinned: true }, { url: 'https://en.wikipedia.org/', title: 'Reference library', pinned: false, group: 'Reading', color: 'blue' }] }] }, question: null, dictation: null, activeSiteOrigin: 'https://example.com/*',
  hud: { phase: 'idle', text: 'Ready when you are' }, log: [], pending: null, shortcut: '⌘ ⇧ Space', engineOpen: false, listening: false, hasApiKey: false,
};
globalThis.chrome = {
  permissions: { request: async () => true },
  storage: { onChanged: { addListener: fn => fixtureListeners.add(fn), removeListener: fn => fixtureListeners.delete(fn) } },
  runtime: { sendMessage: async message => {
    if (message.type === 'MICROPHONE_READY') fixture.settings.micGranted = true;
    if (message.type === 'GET_DIAGNOSTICS') return { ok: true, diagnostics: [{ title: 'Keyboard shortcut', status: 'ready', detail: '⌘ ⇧ Space is assigned · fixture' }, { title: 'Current website access', status: 'attention', detail: 'Allow this site in Settings for repeated page controls · fixture', action: 'settings' }, { title: 'Voice engine', status: 'ready', detail: 'Asleep to save memory · fixture' }] };
    if (message.type === 'RUN_SETUP_COMMAND') { fixture.settings.setupCommandPassed = true; return { ok: true, message: 'Practice passed · UI fixture only; no Chrome tab was opened.' }; }
    if (message.type === 'IMPORT_ROUTINES') fixture.routines = [...fixture.routines, ...message.routines];
    if (message.type === 'GET_READING_LIST') return { ok: true, readingList: [{ url: 'https://example.com/article', title: 'An article saved for later · fixture', creationTime: Date.now(), lastUpdateTime: Date.now(), hasBeenRead: false }] };
    if (message.type === 'SAVE_ROUTINE') fixture.routines = [...fixture.routines.filter(item => item.id !== message.routine.id), message.routine];
    if (message.type === 'DELETE_ROUTINE') fixture.routines = fixture.routines.filter(item => item.id !== message.id);
    if (message.type === 'RUN_ROUTINE') {
      const routine = fixture.routines.find(item => item.id === message.id);
      fixture.pending = { request: { id: crypto.randomUUID() }, actions: [{ action: 'audio_action', params: { operation: 'mute_others' } }, { action: 'zoom', params: { mode: 'set', factor: 1.25 } }, { action: 'page_action', params: { operation: 'scroll', direction: 'top' } }] };
      fixture.hud = { phase: 'review', text: `Review ${routine.name} · fixture plan, no Chrome actions` };
    }
    if (message.type === 'REVIEW_PLAN') {
      fixture.pending = null;
      fixture.hud = { phase: message.approved ? 'error' : 'idle', text: message.approved ? 'Field was not ready after 15 seconds · simulated result' : 'Routine preview dismissed · fixture only' };
      if (message.approved) fixture.progress = { id: crypto.randomUUID(), name: 'Research starter · fixture', status: 'failed', updatedAt: Date.now(), steps: [{ label: 'Search Wikipedia for black holes', status: 'completed', target: 'New tab', result: 'Opened the search results', completedTargets: [] }, { label: 'Wait for the Notes field', status: 'failed', target: 'Wikipedia', result: 'The field did not appear. Remaining steps were stopped.', completedTargets: [] }, { label: 'Fill Notes with black holes', status: 'skipped', completedTargets: [] }] };
    }
    if (message.type === 'SAVE_ALIAS') { fixture.library.aliases = [...fixture.library.aliases.filter(alias => alias.id !== message.alias.id), message.alias]; }
    if (message.type === 'DELETE_ALIAS') fixture.library.aliases = fixture.library.aliases.filter(alias => alias.id !== message.id);
    if (message.type === 'DELETE_WORKSPACE') fixture.library.workspaces = fixture.library.workspaces.filter(workspace => workspace.id !== message.id);
    if (message.type === 'REFRESH_SITE_SUGGESTIONS') fixture.library.suggestions = [{ id: crypto.randomUUID(), name: 'dashboard.example', url: 'https://dashboard.example/', searchUrl: '' }];
    if (message.type === 'ANSWER_CLARIFICATION') { fixture.question = null; fixture.hud = { phase: 'success', text: 'Pinned Work Gmail (UI fixture)' }; }
    if (message.type === 'GET_STATE') return { ok: true, state: structuredClone(fixture) };
    if (message.type === 'SAVE_SETTINGS') { fixture.settings = message.settings; if (message.apiKey) fixture.hasApiKey = true; fixture.listening = false; }
    if (message.type === 'REMOVE_API_KEY') fixture.hasApiKey = false;
    if (message.type === 'TEST_AI_CONNECTION') return { ok: true, message: 'UI preview: connection status only. No API request was sent.' };
    if (message.type === 'SAVE_MACRO') {
      const index = fixture.macros.findIndex(item => item.id === message.macro.id);
      if (index < 0) fixture.macros.push(message.macro); else fixture.macros[index] = message.macro;
      localStorage.setItem('handsfree-preview-macros', JSON.stringify(fixture.macros));
    }
    if (message.type === 'DELETE_MACRO') {
      fixture.macros = fixture.macros.filter(item => item.id !== message.id);
      localStorage.setItem('handsfree-preview-macros', JSON.stringify(fixture.macros));
    }
    if (message.type === 'RUN_MACRO') {
      const macro = fixture.macros.find(item => item.id === message.id);
      if (!macro) return { ok: false, error: 'This macro no longer exists.' };
      fixture.hud = { phase: 'success', text: `${macro.name} · Opened ${macro.urls.length} sites (UI preview)` };
      fixture.log.unshift({ id: crypto.randomUUID(), at: Date.now(), text: fixture.hud.text, ok: true });
    }
    if (message.type === 'CLEAR_LOG') fixture.log = [];
    if (message.type === 'SLEEP_ENGINE') { fixture.engineOpen = false; fixture.listening = false; fixture.hud = { phase: 'idle', text: 'Engine asleep' }; }
    if (message.type === 'OPEN_PAGE') location.href = message.page === 'onboarding' ? '/src/popup/onboarding.html' : '/src/popup/popup.html?settings=1';
    if (message.type === 'TOGGLE_LISTENING') {
      fixture.listening = !fixture.listening; fixture.engineOpen = fixture.listening;
      fixture.hud = { phase: fixture.listening ? 'listening' : 'idle', text: fixture.listening ? 'Listening… press the shortcut again to stop. (UI preview)' : 'Microphone off. (UI preview)' };
    }
    if (message.type === 'RUN_TEXT' && /pin gmail/i.test(message.text)) {
      fixture.question = { id: crypto.randomUUID(), prompt: 'Two Gmail tabs match. Which one?', kind: 'tabs', choices: [{ id: '1', label: 'Personal Gmail', detail: 'This window · mail.google.com' }, { id: '2', label: 'Work Gmail', detail: 'Another window · mail.google.com' }] };
      fixture.hud = { phase: 'clarify', text: fixture.question.prompt }; fixtureListeners.forEach(fn => fn()); return { ok: true };
    }
    if (message.type === 'RUN_TEXT') {
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
