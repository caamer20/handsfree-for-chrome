HandsFree for Chrome 1.8 adds spoken setup, a persistent side panel, more forgiving speech, and recovery that preserves completed work.

- The guided spoken practice shows what was heard and verifies that “open a new tab” created a real tab.
- Natural and relaxed speaking pace, explicit corrections, and short choices for conflicting transcription alternatives.
- Persistent controls with transcript, target, progress, clarification, and Stop.
- Allow a blocked site, choose a missing tab, or edit the command. Eligible resumption runs only unfinished steps after an explicit choice.
- Voice settings first, AI under Advanced, and website-opening macros grouped with routines.
- A lightweight standard package without model weights/runtime; a separate optional local-AI package.

### Install or update

Extract `handsfree-for-chrome.zip`, enable Developer mode at `chrome://extensions`, and load the folder containing `manifest.json`. For an update, replace the contents of the existing unpacked folder at the same path and reload. Keep Developer mode enabled. Version 1.8 adds the side-panel permission. See [installation instructions](https://github.com/caamer20/handsfree-for-chrome/blob/main/INSTALL.md).

`handsfree-for-chrome-local-ai.zip` is the optional model edition. `SHA256SUMS` lists both archives. The standard package is about 0.5 MiB unpacked, while the local-AI ZIP remains about 212 MiB.

### Validation and limits

The application tests, installed-browser command/lifecycle tests, strict TypeScript, lint, build checks, and package checks are described in the [validation record](https://github.com/caamer20/handsfree-for-chrome/blob/main/docs/VALIDATION.md). Automated speech tests use synthetic ASR output and fake microphone devices; they do not measure live voice accuracy. OS permission prompts, physical microphone changes, sleep/wake, real battery use, and complex third-party sites need human testing.

AI is off by default. The optional local model failed all 12 exact-plan benchmark cases and remains experimental. Chrome speech recognition may send audio to Google even with local interpretation. Cloud AI uses your own provider key and billing. This is a developer preview, not a Chrome Web Store release.
