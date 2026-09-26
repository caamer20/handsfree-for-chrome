# Validation record — 1.10.0 release candidate

Executed September 26, 2026 UTC on macOS x64 with Node 24.2.0 and Chrome for Testing 153.0.8010.12. Tests use disposable profiles and invented pages. [Earlier release validation](VALIDATION-HISTORY.md) is retained as history.

## Current evidence

| Check | Result |
| --- | --- |
| Application suite | 1,082 passing tests across 36 files. |
| TypeScript, ESLint, both editions’ MV3/CSP/asset checks | Passed. |
| Production dependency audit | Zero reported vulnerabilities. |
| New installed journeys | Conversation, workspace history, diagnostic download, backup, and phrase-relative caret checks passed. All 74 locally runnable browser cases passed, followed by four native-surface checks, five native decision-control repeats, and six presentation regressions after the final layout/name changes. |
| Upgrade journeys | Published 1.7 and 1.8 packages and the preserved 1.9 candidate passed locally, including reload and full browser restart. |
| Fresh-host CI | Initial candidate: all 76 cases passed on Linux and Windows; macOS passed 75 and missed a Previous-choices pointer click. The widened controls are being checked in the final run. |
| Both installable packages | Built and packaged; both optional-edition installation/preference smoke checks passed with AI off. |
| Optional local-model quality | Updated native-q8 benchmark failed all 12 exact-plan cases. The evaluation intentionally returned failure; no expectations or plan validation were weakened. |

A passing typed command or synthetic SpeechRecognition event is not measured human voice accuracy. The final evidence files will identify the exact source revision and outcomes.

## Covered behavior

The installed extension runs through its actual service worker, offscreen engine, Chrome APIs, content scripts, storage, popup, and side panel. New 1.10 journeys cover single-command follow-up listening, complete paged readback with stable option numbers, conflicting confirmation alternatives, inspected diagnostic downloads, multiline writing and node-preserving undo, phrase-relative caret placement, page changes during beforeinput, reviewed workspace replacement and previous-version recovery, and changing source tabs after review.

Application tests additionally cover preserved decision targets and expiry, stale readback callbacks, local speech failures/timeouts, rejected answer transport, Unicode-safe readback boundaries, complete workspace proposal previews, concurrent library writes, strict version 1 and 2 backups, unchanged-update history preservation, old-workspace compatibility, editor boundaries, and exact undo guards. Existing regression coverage for site permissions, native surfaces, routine inputs, action progress, cancellation, recovery, tab operations, and navigation remains enabled.

## Local microphone test limitation

The two unchanged native fake-microphone setup journeys stall on this development Mac. Prior investigation reproduced the same pending getUserMedia audio request on an ordinary HTTPS page, with permission reported as granted and fake input devices enumerated. Fake video resolves. A one-second sample of the task-owned Chrome AudioService showed its main thread waiting inside macOS CoreAudio AudioDeviceCreateIOProcID. Headed mode and disabled audio processing reproduced the stall.

No system audio process was restarted, and no fake readiness signal was substituted to pass these journeys. The real tests remain enabled in CI. Fresh-host results are recorded separately from this local limitation.

## Reproduce

```bash
npm ci
npm run check
npm audit --omit=dev
npx playwright install chromium
npm run test:browser
npm run package
npm run models:download
npm run check:local-ai
npm run package:local-ai
```

For upgrades, set HANDSFREE_UPGRADE_VERSION and HANDSFREE_UPGRADE_ZIP, then run npm run test:upgrade. The published standard ZIP SHA-256 values are:

- 1.7.0-preview.1: `843275f4e6dc897cb1efccb436568246cb453f3c2d0bf0faeb5b531712b2c239`.
- 1.8.0-preview.1: `69813a8cca526bf94da2a847a30ecdf6f554ac794a2294fedaf552c04d46e4e1`.

The 1.9 candidate is also exercised. CI builds its old code from pinned commit `98d2f540db2c32af1e0129b1f54fcf0ecd23abeb`; local testing uses the preserved verified 1.9 ZIP identified in [its package record](validation/v1.9/packages.json). It is not represented as a published release. The old extension creates its own settings and saved data before the candidate replaces its installed files; preferences and library are then checked after reload and a full browser restart.

Real speech accuracy across accents/devices, OS privacy prompts, physical microphone changes, sleep/wake, hardware battery use, paid-provider behavior, and complex third-party editors still need human testing. The optional small model remains experimental; see the [current model report](validation/v1.10/model-quality.json) and retained [1.8 model report](validation/v1.8/model-quality.json) and [manual voice plan](VOICE-TESTING.md).
