# Privacy policy

Effective September 15, 2026.

HandsFree for Chrome has no account system, analytics, advertising, or application backend. It does not send your transcripts, tab list, bookmarks, or action history to a HandsFree service.

## Microphone and transcription

The microphone is requested on the visible setup page only after you select Enable microphone. That permission check immediately stops its media tracks. Selecting Start spoken practice then starts Chrome speech recognition to hear “open a new tab”; it stops when the practice completes, fails, is cancelled, or times out. The regular shortcut or Start listening button also starts Chrome's Web Speech recognition. By default it keeps listening for successive commands until you press the shortcut again or select Stop listening. Chrome may restart its recognizer during the session. Fatal microphone errors stop the session. Optional single-command mode stops after one complete utterance or a timeout of 20 seconds (40 seconds with relaxed pace). Stopping invalidates queued commands, aborts active API requests, and releases recognition listeners and audio. A trigger phrase filters recognized text; it does not prevent Chrome from hearing other audio while listening.

Chrome's Web Speech implementation may send audio to Google's speech service and require internet. Transcription is therefore **not guaranteed to be offline**. Audio handling by Chrome/Google is governed by their policies and your browser settings. You can use typed commands without microphone permission.

## Local interpretation and browser access

Common commands are parsed on the device. The standard edition contains no local model or inference runtime. The optional local-AI edition uses packaged SmolLM2 weights through WebGPU or WebAssembly. Neither edition downloads model files or executable code after installation. Developers download verified model files from Hugging Face when building the optional edition.

The background worker reads tab titles and URLs to find tabs and performs requested actions on tabs, windows, and bookmarks. It navigates a tab's own back/forward history without reading or searching your global browsing history. When you request reopening a closed tab, the sessions permission reads up to 25 recently closed tab/window entries and restores the most recent individual tab. It does not access synced sessions on other devices. These recent-session details are not sent to AI providers or stored in the activity log. The floating display and page controller use Chrome’s activeTab grant or optional website access explicitly granted in Settings. Page commands inspect visible controls, labels, editable fields, and HTML media in accessible frames. Page text and field values are used locally for the requested action and are not sent to an AI provider. Dictated text is inserted into the selected website’s field, where that website can process it just like typed input. Password fields are excluded.

## Personal sites, workspaces, and reading list

Saved nicknames include their names, website addresses, and optional search templates. Saved workspaces contain tab URLs/titles, pin states, and named group metadata. They live in local extension storage and can be edited or deleted through Library. The optional Learn my sites feature requests Chrome’s topSites permission only after you enable it; suggestions retain site origins, not visited paths, queries, or titles. Suggestions are not automatically used as nicknames. Turning learning off clears suggestions; manually saved nicknames remain.

The tabGroups permission supports requested group creation, updates, and movement. The readingList permission supports saving, listing, opening, updating, and removing entries in Chrome’s reading list. Reading-list data is stored by Chrome and may follow the browser profile’s sync settings; HandsFree does not copy the full list into its persistent storage. These collections are not sent to AI providers.

Recent target IDs, titles/URLs, clarification choices, and undo values are held in session storage to support follow-ups. Reference prompts expire after five minutes; undo retains at most ten command records. Browser restart clears this conversation state. Stopping listening clears pending questions and reviews, while recent targets and supported undo records remain until restart or expiry. Brief spoken feedback uses a local speech-synthesis voice; a sound is used if no suitable local voice is available.

## Optional cloud AI and API keys

AI is off by default. Advanced settings offers OpenAI, Anthropic Claude, Google Gemini, an OpenAI-compatible HTTPS API, and, in the optional local-AI edition, the bundled on-device model. Built-in commands and saved routines are resolved locally first. With cloud AI enabled, an unmatched command sends only that command's text, instructions, and the action schema to the selected provider. The extension does not send tab lists, page contents, bookmarks, browsing history, routines, or audio to the LLM API. Chrome's separate speech service may receive audio for transcription.

The background worker sends the user's key directly to the selected API over HTTPS. Chrome asks for optional access to that API origin when saving its configuration. Keys are bound to a provider and origin, preventing reuse at a changed API host; redirects are refused. No cloud API is called on Save. The explicit Test saved connection action sends a small sample command for validation without executing it. Both tests and command requests may incur charges under the user's provider account. Provider retention and processing are governed by that provider's policies. OpenAI requests set `store: false`; this does not override other provider policies.

Keys are stored separately from preferences in `chrome.storage.local`, restricted to trusted extension contexts. They are not synced or encrypted by HandsFree and are never returned in the popup's state snapshot, activity log, or HUD. Remove saved key deletes the key for the currently saved provider; switching providers leaves previously saved keys available until individually removed or the extension is uninstalled. No key is bundled with the extension.

## Storage and removal

Preferences, website routines (previously called macros: names, command phrases, and URLs), and up to 30 action summaries are stored in `chrome.storage.local`. Website routines can be edited or deleted in Library → Routines → Open websites. Invoking one opens its saved addresses as ordinary Chrome tabs; those websites receive the normal requests associated with visiting them. Summaries may include a routine, page, or bookmark title. Raw command transcripts are saved in the persistent activity log only if you enable Save command transcripts. Turning that setting off removes those saved transcripts; Clear in Recent activity removes the log. Current transcripts, in-progress status, and review plans are held in session storage for Control and the optional side panel and are cleared on restart or replacement.

No raw audio is recorded or saved by HandsFree. Browser speech recognition itself is managed by Chrome. Uninstalling the extension removes its extension storage. Microphone access can be revoked through Chrome's site/extension settings.

For questions, use the [project’s issues](https://github.com/caamer20/handsfree-for-chrome/issues) without including private browsing information.

## Saved command routines (1.6)

Routine names, spoken phrases, and written steps stay in local extension storage until deleted in Library → Routines or the extension is removed. Any literal text saved in a step is retained as part of that routine. Routine compilation and missing-search-word prompts run locally without cloud inference. Form controls inspect accessible labels and act in the permitted page; HandsFree does not send page field values to an AI provider. Opening Chrome History or Downloads displays the browser’s own page and does not add history or downloads API permissions.

## Setup checks, routine inputs, and progress (1.7)

The optional five-second microphone check measures sound amplitude locally using Web Audio. It does not record, play back, transcribe, or send that audio. Its stream and audio context close on completion or cancellation. A saved flag records successful microphone setup and another records completion of the practice browser command. Readiness checks inspect local configuration and permission state; they do not make provider API requests.

Run-specific routine inputs and action progress, including target titles and confirmed results, are held in extension session storage. Routine inputs are cleared when their pending question is resolved, cancelled, or replaced; resolved actions may remain in the current session’s review or progress display until replaced or the browser restarts. Exported JSON contains the saved routine names, phrases, and full step text, including literal text saved by the user. It does not include API credentials or run-specific input values. Imported templates are validated and previewed without execution.

HandsFree’s use and transfer of information received from Google APIs adheres to the Chrome Web Store User Data Policy, including its Limited Use requirements.

## Spoken setup, alternatives, and recovery (1.8)

A local flag records whether the guided spoken command was recognized, interpreted, executed, and verified. Setup's transcript and stage details stay in session storage. Recognition alternatives are bounded and used locally to ask a choice when supported meanings differ; unchosen alternatives are not independently sent to cloud AI. Dictation uses the primary transcript literally.

Recovery retains the command, completed-step progress, remaining actions, and target IDs/URLs in session storage. Eligible permission failures can resume only after explicit permission and Resume actions. Navigation, replacement commands, cancellation, browser restart, or a five-minute expiry invalidate a pending recovery. The side panel uses the same local state as the popup and does not add analytics or external data sharing.
