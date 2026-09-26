# Validation record — 1.10.0 release candidate

Executed September 26, 2026 UTC on macOS x64 with Node 24.2.0 and Chrome for Testing 153.0.8010.12. Tests use disposable profiles and invented pages. [Earlier release validation](VALIDATION-HISTORY.md) is retained as history.

## Current evidence

| Check | Result |
| --- | --- |
| Application suite | 1,102 passing tests across 36 files. |
| TypeScript, ESLint, both editions’ MV3/CSP/asset checks | Passed. |
| Production dependency audit | Zero reported vulnerabilities. |
| New installed journeys | Conversation, workspace history, diagnostic download, backup, and phrase-relative caret checks passed. All 75 locally runnable browser cases passed before the final popup-sizing fix, including all eight writing cases. After that CSS fix, twelve repeated native-surface checks passed with trusted-click verification. Earlier targeted checks also passed: five native decision-control repeats, six presentation regressions, and optional-edition installation. |
| Upgrade journeys | Published 1.7 and 1.8 packages and the preserved 1.9 candidate passed locally, including reload and full browser restart. |
| Fresh-host CI | All 77 browser cases passed on each of Linux, macOS, and Windows, with no skipped or flaky cases. Linux also passed all three upgrade journeys and both package builds. |
| Both installable packages | Built and packaged; both optional-edition installation/preference smoke checks passed with AI off. |
| Optional local-model quality | Updated native-q8 benchmark failed all 12 exact-plan cases. The evaluation intentionally returned failure; no expectations or plan validation were weakened. |

The [final cross-platform run](https://github.com/caamer20/handsfree-for-chrome/actions/runs/36238861524) passed on commit `360aa5adfb9540e688048ac8bf77fde6835ae5ab`. [Local browser evidence](validation/v1.10/browser-summary.json) records the 75-case application source revision, twelve final popup-sizing checks, earlier targeted presentation checks and native-control repetitions, optional-edition installation, and upgrade results. [Cross-platform evidence](validation/v1.10/ci-summary.json) includes native microphone and popup outcomes plus upgrade results. A passing typed command or synthetic SpeechRecognition event is not measured human voice accuracy.

The [popup sizing regression evidence](validation/v1.10/popup-sizing-regression.json) preserves the diagnosis and verified fix. The first two macOS runs failed after native decision-control pointer clicks. A third run captured the cause: the native viewport grew from 570 to 800 pixels between pointer-down and mouse-down, activating desktop styles and moving the button before release; its size check also detected horizontal overflow. The popup now constrains the HTML root to 390 pixels, applies compact spacing independently of viewport width, and excludes popup content from desktop media styles. Its width assertion is stricter (410 pixels including scrollbar allowance); both earlier microphone cases remain intact. The decision controls use two rows with larger primary buttons. The native helper now settles the real pointer before pressing, rechecks its hit target, and requires a trusted DOM click with passive geometry/event diagnostics. The final macOS run held a 405-pixel viewport (390-pixel root plus scrollbar) across all recorded frames.

A subsequent Windows trace showed startup consuming 41.28 seconds of a shared 45-second deadline; the command was sent after timeout. [Startup regression evidence](validation/v1.10/windows-startup-regression.json) records the fix: separate bounded 30/30/45-second startup fixture slots, preserving the 45-second test-body deadline. Seven local navigation/native checks passed after this change. The behavior expectations remain unchanged; no click retries, scripted DOM clicks, or skipped cases were added.

## Covered behavior

The installed extension runs through its actual service worker, offscreen engine, Chrome APIs, content scripts, storage, popup, and side panel. New 1.10 journeys cover single-command follow-up listening, complete paged readback with stable option numbers, conflicting confirmation alternatives, inspected diagnostic downloads, multiline writing and node-preserving undo, phrase-relative caret placement, page changes during beforeinput, reviewed workspace replacement and previous-version recovery, and changing source tabs after review.

Application tests additionally cover preserved decision targets and expiry, stale readback callbacks, local speech failures/timeouts, rejected answer transport, Unicode-safe readback boundaries, complete workspace proposal previews, concurrent library writes, strict version 1 and 2 backups, unchanged-update history preservation, old-workspace compatibility, editor boundaries, safe refusal of partial ancestor/descendant paragraph joins, cancellation during continuous-listening restart, and exact undo guards. Existing regression coverage for site permissions, native surfaces, routine inputs, action progress, cancellation, recovery, tab operations, and navigation remains enabled.

## Local microphone test limitation

The two unchanged native fake-microphone setup journeys stall on this development Mac. Prior investigation reproduced the same pending getUserMedia audio request on an ordinary HTTPS page, with permission reported as granted and fake input devices enumerated. Fake video resolves. A one-second sample of the task-owned Chrome AudioService showed its main thread waiting inside macOS CoreAudio AudioDeviceCreateIOProcID. Headed mode and disabled audio processing reproduced the stall.

No system audio process was restarted, and no fake readiness signal was substituted to pass these journeys. The real tests remain enabled in CI. Fresh-host results are recorded separately from this local limitation.

## Size and performance

The standard archive is 213,003 bytes (630,276 bytes unpacked), with no model weights/runtime. The optional local-AI archive is 222,273,406 bytes (377,224,729 bytes unpacked). Both passed ZIP integrity, version, and package-content checks. [Archive sizes and SHA-256 values](validation/v1.10/packages.json) identify the local installable artifacts; ZIP timestamps mean separately built CI archives may have different hashes.

The [typed-command observation](validation/v1.10/performance.json) recorded a 124 ms cold command, 175 ms warm median, 181 ms warm p95 over 20 cycles, and 226,508 bytes of retained offscreen JavaScript heap growth after garbage collection. These are one disposable development session's observations, excluding audio/network recognition; they are not performance guarantees or comparisons with earlier releases. Heap is not total process memory, and engine task duration is not battery use.

Editor regression tests additionally count style lookups at several tree depths and forbid repeated subtree text reads. This verifies linear index construction without relying on timing thresholds. The plain-editor size/depth limits and guards against hidden or noneditable content remain enforced.

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
