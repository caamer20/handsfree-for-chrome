# Validation record — 1.8.0

Executed September 15, 2026 UTC, on macOS x64 with Node 24.2.0 and Chrome for Testing 153.0.8010.12. Installed tests used disposable profiles and invented web pages; they did not modify the user's existing Chrome profile. [Earlier release validation](VALIDATION-HISTORY.md) is retained as history.

## Executed checks

| Check | Result |
| --- | --- |
| Application unit/integration suite | 520 passing tests across 21 files. |
| Installed standard-extension suite | 46 passing Playwright tests, including 30 common commands. |
| Actual prior-release upgrade | 1 passing test: published 1.7.0 code → 1.8.0 at the same unpacked path → Chrome restart. Preferences and both routine types preserved. |
| TypeScript, ESLint, manifest/CSP/asset checks | Passed for the standard and optional local-AI builds. |
| Production dependency audit | Zero reported vulnerabilities. |
| Both release ZIPs | CRC/integrity, version, asset, test-code exclusion, and SHA-256 checks passed. |
| Separate local-model quality benchmark | **0 of 12 exact JSON plans matched.** Inference ran successfully; model quality failed. |

The [browser summary](validation/v1.8/browser-summary.json) contains case names and pass results. A 30/30 automated typed-command result is not a measured first-attempt voice success rate.

The optional local-AI package also passed the two installed-browser smoke tests for a real typed command and preference persistence. CI exposed popup autosizing changes and races in fixture setup. The popup body now has an explicit width; native tests wait for initialization, settled dimensions, and multiple frames. Test pages attach before their first navigation. Windows CI uses native desktop windows; Linux runs Chrome windows under Xvfb so popup geometry is measured with a display server.

## Installed-browser coverage

Tests load the production MV3 extension with its real service worker, offscreen engine, storage, and Chrome APIs. Thirty commands verify native tab properties, selection, movement, closing/reopening, bookmarks, groups, workspaces, reading list, and actual form/scroll outcomes. Separate journeys cover installation, saved settings, temporary activeTab access from the native toolbar action, blocked-site recovery, explicit remaining-step resumption, engine sleep/recreation, service-worker termination/wake, native popup dimensions, and the persistent side panel. The panel test keeps a draft across tab changes, runs a command, and stops recognition through its actual button.

Spoken setup tests use a fake media device and synthetic SpeechRecognition events in the actual offscreen context, then verify that Chrome created exactly one new tab. They also reject a different spoken action. Speech-transport tests cover conflicting candidates before any mutation, a required trigger, discarded partial speech after a network error, reconnecting, denied/unavailable microphone errors, typed recovery, and Stop. Unit tests cover relaxed pauses, correction boundaries, literal text, overflow, cancellation, stale targets, controlled-input reversion, and one-time recovery without replay.

For optional-host recovery, the harness seeds a consent decision through Chrome Settings in a disposable profile, then clicks the extension's real Allow button to activate the grant. It **does not test the native consent dialog or OS privacy prompt**. All test-only speech and permission helpers are excluded from both packages. See [Chrome's end-to-end guidance](https://developer.chrome.com/docs/extensions/how-to/test/end-to-end-testing), the [CDP Extensions domain](https://chromedevtools.github.io/devtools-protocol/tot/Extensions/), and [Chromium's Settings implementation](https://github.com/chromium/chromium/blob/main/chrome/browser/resources/extensions/service.ts) for the harness mechanisms.

Inspected screenshots: [native popup](validation/v1.8/native-popup.png), [persistent side panel](validation/v1.8/side-panel.png), and [spoken setup using synthetic ASR](validation/v1.8/spoken-setup.png).

## Size and performance

| Edition | ZIP | Unpacked |
| --- | --- | --- |
| Standard | 182,986 bytes (179 KiB) | 524,605 bytes (0.50 MiB) |
| Optional local AI | 222,243,084 bytes (211.9 MiB) | 377,118,569 bytes (359.65 MiB) |

The standard ZIP is over 99.9% smaller than the published 1.7 ZIP (222,226,504 bytes). It contains no ONNX weights, WASM runtime, or model directory. Build verification enforces a 5 MiB unpacked budget. Both editions retain optional cloud AI; local AI stays optional and off by default.

The [recorded performance run](validation/v1.8/performance.json) measured a cold typed command at **620 ms**, and 20 warm cycles at **402 ms median**, **830 ms p95**. Retained offscreen JavaScript heap grew **183,184 bytes** after GC; engine task duration was **1.27 seconds** across the measured warm interval. Engine release was also verified. These timings include test/control messaging and polling on one development machine. They are observations, not performance guarantees, and are distinct from speech-recognition/network latency. Heap is not whole-process RSS or GPU memory; task duration is not battery consumption. No hardware battery benchmark was performed.

The [model report](validation/v1.8/model-quality.json) deliberately bypasses grammar and records all raw generated outputs against 12 fixed expected plans, using native CPU INT8 and the production prompt. It exits nonzero on quality failure. Its timings came from a development session with other workloads and are not a controlled model-latency benchmark. Native CPU results do not certify browser WebGPU/WASM performance. The failed quality result is why the small model is an experimental option rather than part of the standard install.

## Reproduce

```bash
npm ci
npm run check
npx playwright install chromium
npm run test:browser
npm run package
npm run models:download
npm run check:local-ai
npm run package:local-ai
npm run eval:model
```

The final command currently exits **1** for the documented quality failures. To test migration, set `HANDSFREE_UPGRADE_ZIP` to the actual published `v1.7.0-preview.1` ZIP before `npm run test:upgrade`. Its SHA-256 is `843275f4e6dc897cb1efccb436568246cb453f3c2d0bf0faeb5b531712b2c239`. Chrome Developer mode is enabled only in the test's disposable profile. Browser fixtures use isolated profiles; do not point them at personal Chrome data.

The CI workflow adds installed-browser jobs for Linux, macOS, and Windows and checks the prior-release upgrade on Linux. This local record does not itself claim those remote jobs have passed; inspect the corresponding GitHub run.

## Still requires hardware and human testing

Actual speech-to-text accuracy across voices/accents and microphones, OS permission prompts, physical device changes, computer sleep/wake, long-session battery/total process/GPU memory, live paid providers, and complex third-party editors remain unverified. The [manual voice and hardware plan](VOICE-TESTING.md) supplies a repeatable 30-command matrix and measurement procedure. Proposed 90% setup and 95% first-attempt success targets remain unmeasured. Do not present synthetic ASR callbacks, these parser tests, or the model benchmark as human voice accuracy.
