# Privacy policy

Effective September 8, 2026.

HandsFree for Chrome has no account system, analytics, advertising, or application backend. It does not send your transcripts, tab list, bookmarks, or action history to a HandsFree service.

## Microphone and transcription

The microphone is requested on the visible setup page only after you select Enable microphone. Setup immediately stops its media tracks. After setup, the shortcut or Start listening button starts Chrome's Web Speech recognition for one command, for at most 20 seconds. Pressing the shortcut again cancels the command. The extension aborts recognition and releases listeners when it finishes or fails.

Chrome's Web Speech implementation may send audio to Google's speech service and require internet. Transcription is therefore **not guaranteed to be offline**. Audio handling by Chrome/Google is governed by their policies and your browser settings. You can use typed commands without microphone permission.

## Local interpretation and browser access

Common commands are parsed on the device. Optional experimental AI uses packaged SmolLM2 weights locally through WebGPU or WebAssembly. No model or executable code is downloaded by the installed extension. Developers download model files from Hugging Face while building.

The background worker reads tab titles and URLs to find tabs and performs requested actions on tabs, windows, and bookmarks. It navigates a tab's own back/forward history without reading or searching your global browsing history. The floating display is injected only under Chrome's activeTab grant, without reading page content.

## Storage and removal

Preferences and up to 30 action summaries are stored in `chrome.storage.local`. Summaries may include a page or bookmark title used in the action. Raw command transcripts are saved only if you enable Save command transcripts. Turning that setting off removes saved transcripts; Clear in Recent activity removes the log. In-progress status and review plans are held in session storage and are cleared on restart or replacement.

No raw audio is recorded or saved by HandsFree. Browser speech recognition itself is managed by Chrome. Uninstalling the extension removes its extension storage. Microphone access can be revoked through Chrome's site/extension settings.

For questions, use this repository's issues without including private browsing information.
