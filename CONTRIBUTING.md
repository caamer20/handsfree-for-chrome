# Contributing

Thanks for helping make HandsFree useful and dependable. Check [open issues](https://github.com/caamer20/handsfree-for-chrome/issues) before starting a large change. Bug fixes, accessibility improvements, clearer commands, and live-browser test reports are especially useful during the developer preview.

## Set up locally

Use Node.js 24, then run:

```bash
npm ci
npm run models:download
npm run check
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

## Reporting problems

Use the bug template with your version, OS, steps, and a redacted example. For a vulnerability, follow [SECURITY.md](SECURITY.md). Please do not put credentials or private browsing data into public issues.

Contributions are licensed under the repository’s [Apache 2.0 license](LICENSE).
