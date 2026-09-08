# Validation record

Date: September 8, 2026. Build environment: macOS, Node 24.2.0. This document distinguishes executed tests from checks that still need the installed extension in Chrome.

## Executed

- Strict TypeScript type checking and ESLint; no explicit `any` types in project TypeScript.
- 37 passing Vitest tests covering command/action contracts, safe URLs, compound search encoding, sequences, fuzzy tab scoring, malformed JSON, grounding, dispatcher behavior, speech cleanup, offscreen concurrency, background origin checks, stale-request rejection, cancellation, and one-time plan approval.
- Production Vite/Rollup build and manifest/asset/CSP checks. All scripts are local; there are no inline script handlers or JavaScript eval calls in project code.
- Both packaged model weight files downloaded from the pinned official revision and checked against SHA-256 values.
- Production dependency audit: zero vulnerabilities after overriding sharp to patched 0.35.4. Sharp is not in the extension browser bundle.
- Popup and onboarding inspected in the browser. Command examples fill the input; typed-command state transitions, activity display, and preference saving were exercised with explicit UI fixtures. Those fixture interactions do not execute Chrome APIs.
- The **real built offscreen engine**, under the extension's self-only script/connect CSP and COOP/COEP, executed a deterministic command in the in-app Chromium browser harness and emitted the expected `create_tab` action.
- The same browser harness loaded INT4 weights through WebGPU, completed prewarming and generation, and rejected an invented tab name using the grounding guard.
- With WebGPU disabled in the harness, the real engine loaded INT8 weights through WASM in a cross-origin-isolated context (up to four threads), completed prewarming and generation, and again rejected the invented name.
- Native INT8 ONNX model load/prewarm completed (about 807 ms in the initial run) and inference generated output. **The semantic check failed:** “Could you silence this tab?” copied the preceding “design notes” example. This is a model-quality failure, not a claim of successful intent extraction. The reliable parser now handles that audio phrasing directly. AI is opt-in, labeled experimental, guarded against invented slots, and always requires review.

## Memory/lifecycle audit

Automated tests verify that speech final results, cancellation, and timeout call abort, detach handlers, and leave no timer behind; that concurrent offscreen requests create one document; and that close/recreate is serialized. Background integration tests verify cancellation invalidates a request before disposal and replayed results cannot execute twice.

Code inspection verifies a one-token prewarm, no dynamic KV cache stored across commands, no `return_dict_in_generate` cache retention, bounded logs, session disposal after errors, listener cleanup, and a bounded graceful-shutdown period before hard document closure. Transformers.js 3.8.1's generation cleanup disposes GPU result/cache tensors when returning sequences. Unloading an offscreen document releases its context, including remaining worker/GPU allocations.

This does **not** certify zero leaks or a stable physical GPU-memory plateau. Chrome Task Manager/DevTools measurements in an installed extension are still required. JavaScript heap alone would not prove GPU-memory release.

## Installed-Chrome checks still required

The task's browser connection exposed only the Codex in-app browser. Local Google Chrome is installed but was not available to the browser-control tool. Consequently this run did not load the extension into that Chrome profile, grant its microphone permission, verify a live spoken utterance, or measure installed-extension memory.

1. Load `dist/` in `chrome://extensions` and confirm no manifest/service-worker errors.
2. Confirm the shortcut is assigned. Exercise it on an HTTPS page, then on `chrome://newtab` (badge-only feedback is expected on restricted pages).
3. Allow the setup microphone, confirm the recording indicator turns off immediately, then test final speech, no-speech timeout, permission denial, cancellation, and a network error.
4. Exercise every action in the README, including multi-window fuzzy lookup and no-match feedback. Use disposable tabs/bookmarks for close/create tests.
5. Trigger repeated hotkeys and cancel during model startup. Verify no duplicate offscreen context and no actions execute after cancellation.
6. In Power Saver, wait three idle minutes and inspect `runtime.getContexts`/Chrome Task Manager for offscreen closure. Repeat 20 cold starts and compare process/GPU memory after garbage collection and shutdown.
7. Repeat on a GPU-disabled browser and verify WASM fallback. On a non-isolated context verify single-thread behavior; this latter fallback was inspected in code but not exercised in this run.
8. Check reduced motion, keyboard navigation, and the popup in Chrome's actual maximum popup dimensions. The in-app browser did not apply its requested viewport override, so popup sizing still needs native verification.

## Reproduce model evaluation

`npm run eval:model` deliberately exits nonzero when the specified model fails its semantic case. It is an optional model-quality evaluation, separate from deterministic app tests and CI. Do not remove or weaken that expectation to make the model appear reliable. Improving the default AI experience requires representative evaluation and likely a task-tuned or larger model.

The source includes a localhost-only browser harness in `scripts/`. Open the preview server's `/src/offscreen/offscreen.html` to test real WebGPU inference with simulated Chrome transport, or add `?cpu=1` for WASM. Harness files and fixtures are excluded from the extension ZIP.
