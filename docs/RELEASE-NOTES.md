HandsFree for Chrome 1.9 adds voice text correction, page-outline navigation, portable libraries, and more faithful workspace restoration.

- Select or replace a phrase in the focused field, move its cursor, and say “scratch that” during dictation to restore the last unchanged insertion.
- Optional spoken punctuation; “literal …” keeps reserved words as text. Dictation verifies editor updates and stops when they are rejected.
- Navigate headings and page regions by name, number, or next/previous. Find phrases across inline formatting and scroll horizontal panels.
- Export/import site nicknames, both routine types, and workspaces through a reviewed merge that preserves existing data.
- Restore the active workspace tab and distinct named or unnamed groups, including color and collapsed state.
- Conflicting speech cannot silently confirm a review, select another target, or execute a replacement correction. Recover unfinished commands by voice.
- Stable batch tab moves, chronological undo that respects manual changes, and confirmed per-target progress through partial failures.
- Current website access is checked before reusing a page controller or sending another dictated chunk. Deep and large page scans are bounded.

### Install or update

Extract `handsfree-for-chrome.zip`, enable Developer mode at `chrome://extensions`, and load the folder containing `manifest.json`. To update, replace the contents of the existing unpacked folder at the same path and select Reload. Check the 1.9 badge. Version 1.9 adds no new extension permissions. See [installation instructions](https://github.com/caamer20/handsfree-for-chrome/blob/main/INSTALL.md).

`handsfree-for-chrome-local-ai.zip` is the optional model edition. `SHA256SUMS` lists both archives. The standard edition remains under 1 MiB unpacked; the optional local-AI package includes the model weights and runtime.

### Validation and limits

See the [validation record](https://github.com/caamer20/handsfree-for-chrome/blob/main/docs/VALIDATION.md) for executed application, installed-browser, upgrade, packaging, and platform checks. Synthetic speech tests do not establish real microphone or accent accuracy. Native OS permission prompts, physical microphone changes, sleep/wake, hardware battery use, and complex third-party editors still need human testing.

AI remains off by default. The optional local model still fails the recorded 12-case native-q8 exact-plan benchmark and remains experimental. No model-quality expectations were weakened for this release. Chrome speech recognition may send audio to Google; cloud AI uses your own provider key and billing. This is a developer preview, not a Chrome Web Store release.
