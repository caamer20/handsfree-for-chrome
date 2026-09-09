HandsFree for Chrome is an open-source extension for voice control, dictation, and reusable browser routines.

This developer preview includes guided setup and local microphone checks, parameterized routines with import/export and step reordering, and live progress that distinguishes confirmed completions from stopped or skipped work.

### Install

Download and extract `handsfree-for-chrome.zip`. Open `chrome://extensions`, enable Developer mode, select **Load unpacked**, and choose the extracted folder containing `manifest.json`. Do not select the GitHub source ZIP unless you intend to build it first. Existing users should replace their unpacked build and reload the extension.

### Validation and limits

The application tests, strict TypeScript, lint, production build, MV3 package checks, and ZIP integrity checks pass. The UI has been exercised with explicitly simulated Chrome responses. Live installed-Chrome microphone behavior, native permissions, and complex third-party websites still require beta testing.

AI is off by default. The bundled small model is experimental and has a documented intent-quality failure. Chrome’s speech service may send audio to Google even when command interpretation is local. Optional cloud AI uses your own key and provider billing.

The ZIP is approximately 212 MiB because it includes local model weights and runtime files. `SHA256SUMS` contains its checksum. See the README and validation record for details.
