# Contributing

Thanks for helping make HandsFree useful and dependable. Check [open issues](https://github.com/caamer20/handsfree-for-chrome/issues) before starting a large change. Bug fixes, accessibility improvements, clearer commands, and live-browser test reports are especially useful during the developer preview.

## Set up locally

Use Node.js 24, then run:

```bash
npm ci
npm run check
npx playwright install chromium
npm run test:browser
```

Load `dist` as an unpacked extension at `chrome://extensions`. Never load the repository root. Run `npm run dev` while editing and reload the extension to use rebuilt files.

## Where things live

| Directory | Responsibility |
| --- | --- |
| `src/common` | Typed action/message contracts, deterministic parsing, routines, and shared models. |
| `src/background` | Chrome actions, session state, review/clarification, cancellation, and provider requests. |
| `src/content` | Page controls and the floating status display. |
| `src/offscreen` | Speech recognition and optional local inference. |
| `src/popup` | Control, Library, Settings, and guided setup. |
| `tests` | Parser, DOM, stateful Chrome fixtures, provider, and lifecycle tests. |
| `scripts` | Build, model download/checksums, package checks, and explicit UI fixtures. |

## Before opening a pull request

- Describe the user-visible problem and resulting behavior.
- Run `npm run check`. Add meaningful coverage for new behavior, especially ambiguous targets, cancellation, data-only routine inputs, and partial failures.
- Keep the full action plan validated before mutation. Preserve request identity and never replay completed steps when resuming a question.
- Make new access explicit and narrow. Do not add analytics, remote executable code, or automatic permission grants.
- Treat API keys and private page contents as secrets. Use invented fixture data in tests and screenshots.
- State whether you tested an installed extension or a simulated browser fixture. A fixture pass does not establish microphone or real-site reliability.
- Update user documentation when behavior or limits change. Keep optional AI limitations and speech-network disclosures accurate.

The local model-quality evaluation (`npm run eval:model`) is separate from the application test suite and has a documented failure. Do not weaken the expected result merely to make the evaluation pass.

The standard edition needs no weights. For the optional edition, run `npm run models:download`, `npm run check:local-ai`, and `npm run package:local-ai`. Browser tests use disposable profiles and controlled pages. The ASR fixture replaces only speech-recognition output in the test's offscreen context; it does not measure microphone accuracy. Native consent seeding, when used, is confined to disposable Chrome Settings and excluded from builds. Do not run multiple browser suites against the same output directory at once.

For native popup/panel geometry on Linux, use `npm run test:browser:headed` in a desktop session or `xvfb-run --auto-servernum npm run test:browser -- --headed` on a server. Headless Chrome can report transient popup viewport geometry independently of the rendered document.

To test the real prior release, download `handsfree-for-chrome.zip` from `v1.7.0-preview.1`, verify its published checksum, and set `HANDSFREE_UPGRADE_ZIP` before `npm run test:upgrade`. The test replaces files at the same unpacked path and checks settings and both routine types after reload and browser restart. See [manual voice testing](docs/VOICE-TESTING.md) for the hardware-dependent checks.

## Reporting problems

Use the bug template with your version, OS, steps, and a redacted example. For a vulnerability, follow [SECURITY.md](SECURITY.md). Please do not put credentials or private browsing data into public issues.

Contributions are licensed under the repository’s [Apache 2.0 license](LICENSE).
