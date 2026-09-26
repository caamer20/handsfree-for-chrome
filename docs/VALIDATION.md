# Validation record — 1.9.0 release candidate

Executed September 26, 2026 UTC on macOS x64 with Node 24.2.0 and Chrome for Testing 153.0.8010.12. Tests use disposable profiles and invented pages. [Earlier release validation](VALIDATION-HISTORY.md) is retained as history.

## Current evidence

| Check | Result |
| --- | --- |
| Final application suite | 845 passing tests across 30 files. |
| Installed extension, excluding two locally blocked audio setup cases | 62 passing tests, including writing, navigation, punctuation, backup/import, stable multi-tab moves and undo, workspace fidelity, and revoked-access regressions. |
| TypeScript, ESLint, both editions’ MV3/CSP/asset checks | Passed. |
| Repeated native surface checks | All 15 checks passed across five repetitions after the pointer-readiness fix. |
| Optional edition installed smoke | Both installation/typed-command and persisted-preference checks passed with AI off. |
| Production dependency audit | Zero reported vulnerabilities. |
| Published 1.7 and 1.8 upgrade journeys | Both passed using verified published ZIPs, including library/preferences after reload and browser restart. |
| Fresh-host Linux/macOS/Windows suite | All 64 browser cases passed on each platform in initial runs. A duplicate Linux run missed one opening side-panel click; its fixture now waits for stable, visible, hit-testable coordinates. The upgrade download tag is corrected. A later duplicate run exposed committed-URL timing and a slow Windows module startup; bounded readiness checks now preserve the same exact outcomes. Final complete CI rerun pending. |
| Optional local-model quality | Recorded native-q8 benchmark remains 0/12 exact plans. No expectations or model validation were weakened. |

This record will be updated as release verification completes. A passing typed command or synthetic SpeechRecognition event is not measured human voice accuracy.

## Covered behavior

The installed standard extension runs through its actual service worker, offscreen engine, Chrome APIs, content scripts, storage, popup, and side panel. New journeys exercise selecting/replacing text across native and contenteditable fields, cursor placement, guarded dictation correction, editor rejection, optional punctuation, disabled controls, shadow labels, heading/landmark focus without clicks, inline phrase search, horizontal scrolling, ambiguity before confirmation, voice recovery without replay, keyboard focus, library export/preview/import, and restoration of active tabs and distinct groups.

Revoked-access tests grant a site using the extension's real Allow control after seeding a consent decision in a disposable Chrome profile. They remove the grant and prove that a retained numbered target cannot click, and another dictated chunk cannot change the field. A separate ordinary toolbar-action test preserves temporary activeTab support. Native consent dialogs and OS privacy prompts are not claimed as tested by this harness.

Unit coverage additionally checks stale sessions and documents, malformed command fallback, literal payloads, grounded AI edit slots, chronological undo and manual tab changes during waits, Stop during reviewed operations and continuation handoff, exact partial-progress reporting, strict backup validation and latest-state conflicts, schema migration, deep DOM traversal limits, and bounded text scanning.

## Local microphone test limitation

The two unchanged native fake-microphone setup journeys stall on this development Mac. Investigation reproduced the same pending getUserMedia audio request on an ordinary HTTPS page, with permission reported as granted and fake input devices enumerated. Fake video resolves. A one-second sample of the task-owned Chrome AudioService showed its main thread waiting inside macOS CoreAudio AudioDeviceCreateIOProcID. Headed mode and disabled audio processing reproduced the stall.

No system audio process was restarted, and no fake readiness signal was substituted to pass these journeys. The real tests remain enabled in CI. The extension's timeout guidance now covers both permission and audio-device startup. This local failure does not establish microphone reliability on other machines; fresh-host results are recorded separately above.

## Size and performance

The standard archive is 199,311 bytes (579,207 bytes unpacked), with no model weights/runtime. The optional local-AI archive is 222,259,608 bytes (377,173,308 bytes unpacked). Both ZIPs passed integrity, version, and package-content checks. [Archive sizes and SHA-256 values](validation/v1.9/packages.json) identify the local installable artifacts; ZIP timestamps mean separately built CI archives may have different hashes.

The [typed-command performance observation](validation/v1.9/performance.json) recorded a 118 ms cold command, 175 ms warm median, 184 ms warm p95 over 20 cycles, and 202,236 bytes of retained offscreen JavaScript heap growth after garbage collection. These observations came from one disposable development session, exclude audio/network recognition, and are not performance guarantees or comparisons with older releases. Heap is not total RSS; engine task duration is not battery use.

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

For upgrades, set HANDSFREE_UPGRADE_VERSION to 1.7.0 or 1.8.0 and HANDSFREE_UPGRADE_ZIP to that published package, then run npm run test:upgrade. The standard ZIP SHA-256 values are:

- 1.7.0-preview.1: `843275f4e6dc897cb1efccb436568246cb453f3c2d0bf0faeb5b531712b2c239`.
- 1.8.0-preview.1: `69813a8cca526bf94da2a847a30ecdf6f554ac794a2294fedaf552c04d46e4e1`.

Real speech accuracy across accents/devices, OS privacy prompts, physical microphone changes, sleep/wake, hardware battery use, paid-provider behavior, and complex third-party editors still need human testing. The optional small model remains experimental; see the retained [1.8 model report](validation/v1.8/model-quality.json) and [manual voice plan](VOICE-TESTING.md).
