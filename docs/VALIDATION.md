# Validation record

Date: September 9, 2026. Build environment: macOS, Node 24.2.0. This document distinguishes executed tests from checks that still need the installed extension in Chrome.

## Executed

- Strict TypeScript type checking and ESLint; no explicit `any` types in project TypeScript.
- 474 passing Vitest tests covering command/action contracts, safe URLs, compound search encoding, sequences, fuzzy tab scoring, malformed JSON, grounding, dispatcher behavior, speech cleanup, offscreen concurrency, background origin checks, stale-request rejection, cancellation, one-time plan approval, and personal website macros.
- Production Vite/Rollup build and manifest/asset/CSP checks. All scripts are local; there are no inline script handlers or JavaScript eval calls in project code.
- Both packaged model weight files downloaded from the pinned official revision and checked against SHA-256 values.
- Full dependency audit: zero vulnerabilities after updating Vitest to patched 4.1.11 and retaining the sharp override at 0.35.4. Sharp is not in the extension browser bundle.
- Popup and onboarding inspected in the browser. Command examples fill the input; typed-command state transitions, activity display, and preference saving were exercised with explicit UI fixtures. Those fixture interactions do not execute Chrome APIs.
- The **real built offscreen engine**, under version 1.0’s self-only script/connect CSP and COOP/COEP, executed a deterministic command in the in-app Chromium browser harness and emitted the expected `create_tab` action.
- The same browser harness loaded INT4 weights through WebGPU, completed prewarming and generation, and rejected an invented tab name using the grounding guard.
- With WebGPU disabled in the harness, the real engine loaded INT8 weights through WASM in a cross-origin-isolated context (up to four threads), completed prewarming and generation, and again rejected the invented name.
- Native INT8 ONNX model load/prewarm completed (about 807 ms in the initial run) and inference generated output. **The semantic check failed:** “Could you silence this tab?” copied the preceding “design notes” example. This is a model-quality failure, not a claim of successful intent extraction. The reliable parser now handles that audio phrasing directly. AI is opt-in, labeled experimental, guarded against invented slots, and supports optional review.

## Website macros (version 1.1.0)

- Macro schema tests cover address normalization, unsupported schemes/credentials, empty/oversized collections, duplicate sites, and duplicate phrases after case/punctuation/polite-framing normalization.
- Dispatcher tests verify more than eight sites open in saved order in the original window, only the first tab is selected, every address is validated before side effects, and partial failures stop/report accurately.
- Background integration tests verify individual saves/deletes preserve other macros/settings, stored routines survive a worker restart, typed macros take priority over built-in commands without an offscreen engine, and deleted IDs cannot run.
- The voice handoff test verifies the configured global trigger phrase is stripped and a handled macro bypasses grammar/AI. Repeated final speech results cannot replay a macro; interim speech never executes it.
- Browser UI fixture checks cover creating a morning routine, viewing normalized site order, editing, invalid-URL rejection without discarding the draft, run feedback, reopening the page, and confirmed deletion. The sample routine was disposable fixture data; it did not open real websites or configure a user's Chrome profile.
- `npm run check`, `npm run package`, and ZIP integrity verification pass for version 1.1.0. Live voice/macro tab-opening verification in the user's Chrome profile still requires Chrome access, as described below.

## AI providers and continuous listening (version 1.2.0)

- Background integration tests verify Power Saver preserves active listening, a missing heartbeat ends stale capture, ordinary validated AI plans execute without popup approval, the review-all preference is honored, AI tab closures still require review, voice confirmation is explicit, and each successive voice command anchors to the then-active tab.
- A slow mocked HTTP response cannot block the stop hotkey; late results after cancellation never execute. Key storage is separate from settings, and popup state exposes only a key-presence boolean.
- Mocked HTTP tests cover OpenAI Responses, Anthropic tool calls, Gemini GenerateContent, and compatible Chat Completions request/response contracts; nullable plan fields, grounding, invalid actions, authentication/quota/server errors, oversized output, timeouts, and origin-bound keys.
- Continuous speech tests verify duplicate final suppression, quiet periods beyond three minutes, automatic recognition restarts, bounded network retries, buffered-speech discard on stop, and complete timer/listener cleanup after denial/cancellation.
- Offscreen integration tests verify trigger filtering, successive command execution, cloud routing, sequential command queuing, stale queued confirmation removal, heartbeat messages, and stopping during slow inference.
- The popup UI fixture verifies provider selection, model/key fields, saving with a cleared password field, key-removal controls, connection-test feedback, invalid HTTP endpoint rejection, and Start/Stop plus the microphone-on indicator. No console errors were reported. These UI fixtures make no API calls or privileged browser actions.
- The production build and manifest/CSP checks pass. Script sources remain local; HTTPS connect access is allowed with optional host grants, requested for the configured API origin.
- Live paid provider requests, optional permission prompts, live continuous microphone capture, and installation/reload in the user's Chrome profile remain unverified. No API key was supplied or taken from another application. Use Test saved connection after entering your own key.

## Expanded tab commands (version 1.3.0)

- Parser tests cover “close xyz tab”, named close/mute/pin/reload/duplicate/switch variants, polite framing, title keywords, explicit tab numbers and ordinals, next/previous/first/last, tab movement, new windows, reopening, and explicit plural closures.
- Named-action integration tests feed real parsed plans into the dispatcher against mocked Chrome state. They verify the targeted tab is changed without activation, the original tab is preserved, cross-window names work, and missing/ambiguous names cause no tab mutations.
- Position tests verify one-based current-window targeting, wraparound, and rejection of invalid/out-of-range positions. Movement tests preserve pinned-tab boundaries and adopt the new window context after detaching a tab.
- Closure tests verify all/matching closures stay within the specified window and retain mandatory review. Literal plural matching excludes typo guesses. Restore tests skip closed-window sessions and restore one individual tab.
- The browser UI fixture verifies the 1.3 header, filtering the Commands screen for “close”, selecting the named YouTube example into the command box, and a clean browser console. No real tabs were closed during UI fixture checks.
- Every one of the 33 command-guide examples is parsed without AI. Cloud and local model action schemas/prompts include the expanded actions and named-tab resolution; existing provider, microphone, and macro tests remain passing.
- These tests use simulated Chrome APIs. Live tab closures, the sessions permission prompt, and restore behavior in the user's installed Chrome remain manual checks.

## Sites, conversation, and page controls (version 1.4.0)

- The full `npm run check` passes: ESLint, 236 tests across 15 files, strict TypeScript, production build, and MV3/CSP/asset checks. The command guide contains 71 examples, all parsed without AI. npm reports zero known dependency vulnerabilities.
- Parser tests cover every phrase in the approved expansion: 37-site dictionary and speech aliases, generic categories, personal nicknames, site searches, reuse/new-site intent, coordinated targets, references, page links/fields, scrolling/find, dictation, media, groups/workspaces, reading list, duplicates, help, and priority cancellation/correction detection.
- Stateful Chrome fixtures verify reuse across windows, ambiguity between existing accounts, app-default choices, private nickname paths, literal site-search encoding, physical tab IDs across focus changes, plural follow-ups, and review before multi-tab closure.
- Clarification tests resume only unfinished actions, resolve ordinal/account-label/UI answers, consume answers once, and change an ambiguous command from mute to pin without touching the unrelated active tab. Duplicate review freezes IDs and URLs and refuses a copy that became active before approval.
- Undo tests cover moves, pin state and position, mute, repeated mutations, specific-kind undo within a compound command, preservation of subsequent manual edits, and cancellation between native API calls. Workspace tests restore the saved URLs, pinning, and named group colors in a new window. Group ambiguity is resolved before any movement.
- DOM tests run the real page controller in Happy DOM: visible and disabled control filtering, open shadow roots, stale numbering and changed URLs, ambiguous labels, plain text field/contenteditable insertion, beforeinput/input events, no implicit form submission, password exclusion, literal dictation and focus-change cancellation, visible-text match traversal, and bounded media seek/volume.
- Offscreen tests verify voice cancellation bypasses pending inference and clears queued speech; dictation sends command-like phrases literally without a trigger; explicit dictation exit remains available; pre-recorded answers cannot answer a question that had not yet appeared. Stopping dictation after switching to a restricted page cancels its original target.
- Browser UI fixture verification covers creating a site nickname with a search template; Library navigation, saved workspace and reading-list controls; saving a preferred music app and sound feedback; and resolving an ambiguous Gmail choice. The rebuilt clarification card is compact and clears the input for an answer. The inspected browser console had no errors or warnings.
- Manifest validation verifies optional HTTP(S) website grants and optional topSites alongside required tabGroups/readingList. Website controls inspect the accessible DOM locally; the provider protocol still sends only command text and its action schema. Suggestions retain origins without visited private paths, queries, or page titles.
- Privileged Chrome APIs are mocked in these tests; the browser preview cannot operate the user's Chrome. Live extension reload/permission prompts, microphone recognition, optional sound/speech feedback, complex third-party editors and cross-origin frames, and paid API calls remain unverified. No actual user tabs or reading-list entries were changed during the fixture checks.

## Natural command wording and tab sets (version 1.5.0)

- The complete `npm run check` passes: ESLint, 380 tests across 16 files, strict TypeScript, the production build, and manifest/asset/CSP verification. This adds 144 tests to version 1.4. No dependencies or permissions were added.
- Language tests check polite framing and gerunds, anchored verb paraphrases, named media controls, compound spoken numbers, multi-position moves/jumps, counting from the right, explicit ranges/lists, filtered tab sets, exclusions, alternate search order, group/workspace/bookmark phrasing, and conversational review/cancellation. Every advertised guide example and alternate phrase parses locally.
- Negative cases preserve literal typed text and search payloads, punctuation, and quoted command-like titles. Negated commands are handled without actions or cloud inference. Unknown quantities and incoherent action combinations are rejected. A typed conversational approval consumes only the currently pending review.
- Stateful Chrome fixtures verify paraphrases act on the intended named tab, title-based open fallback does not invent a URL, filters stay in the current window unless global scope is explicit, exclusions identify a tab in the actual set, all numeric positions are validated before mutations, filtered closures require review even for one match, multi-position moves support undo, and tab listings activate only a chosen item.
- The browser UI fixture verifies the 1.5 header, the 97-example Commands screen, searching the alternate phrase “quiet down”, and selecting its result into the typed command box. The screenshot shows the alternate wording below its canonical command. No browser console errors or warnings were reported.
- Both local and cloud schemas/prompts include the new tab-set and position parameters; legacy provider/macro/continuous-listening tests still pass. Live installed-Chrome actions and real spoken utterances were not run because only the in-app browser was available. The UI preview uses simulated Chrome transport and does not control user tabs.

## Routines, form editing, and organization (version 1.6.0)

- `npm run check` passes with 442 tests across 17 files, strict TypeScript, ESLint, production builds, and manifest/asset/CSP checks. The guide contains 115 examples and includes alternate phrases; every example parses locally. No dependencies or permissions were added.
- Routine tests exercise persistence across a worker restart, name/phrase collisions with macros, whole-routine validation before any mutation, voice and typed invocation before AI, preview dismissal, one-time approval/answer handling, a search-word clarification between completed and pending steps, stop at the first failed step, concrete bulk-close review, and interruption while waiting for page load. Page waiting also has a tested 15-second timeout.
- DOM tests execute the page controller against actual Happy DOM elements: full-field replacement, literal markup, cancellation via beforeinput, selected-text editing in textareas and contenteditable, field navigation, stale or ambiguous numbered fields, native dropdown label matching and duplicate/disabled choices, one input/change event per dropdown change, idempotent native checkbox state, radio selection, password/disabled/readonly/hidden exclusion, field length limits, numeric value validation, and absence of form submission. Unlabeled field values are excluded from numbered labels.
- Stateful Chrome fixtures verify alphabetical tab sorting with groups/pins/other windows preserved, named group colors, group removal without closure, selected/current-window ungrouping, bounded Chrome management-page opening/reuse, and literal search answers that contain command words. Public URL validation still refuses arbitrary chrome:// destinations.
- Browser UI fixture checks cover the 1.6 header, the Routines collection, three starter examples, a populated editor with a live action preview, invalid-step feedback that retains the draft, saving, the pre-execution review and dismissal, and searching/selecting the dropdown command without executing it. Screenshots were inspected for readable layout. The browser console reported no errors or warnings.
- These UI fixtures cannot operate Chrome tabs. Installed-extension reload, actual microphone recognition, host-permission prompts, and real third-party forms/Chrome APIs remain unverified because only the in-app browser was connected. The document-load wait does not test completion of a website’s later asynchronous widgets.

## Guided setup, routine inputs, and execution progress (version 1.7.0)

- The application suite has 474 tests across 20 files. Build verification also checks version consistency between the package, manifest, lockfile root, and each pinned npm archive. The complete check includes lint, strict TypeScript, production builds, and MV3 asset/CSP verification. No dependencies or permissions were added.
- Parameterized routine tests preserve literal command-like words and punctuation, substitute only after parsing, encode URL search inputs without adding URL parameters, reject unsupported parameter locations, collect missing inputs before review, and prevent variable/literal phrase collisions. Versioned JSON import is bounded, validates every template, uses fresh IDs, and adds the entire batch atomically without overwriting existing routines.
- Progress tests observe a running native action through a concurrent read-only state snapshot, preserve confirmed completions across clarification, distinguish failed/cancelled/skipped steps, and record confirmed targets before a later tab in the same batch fails. Completed steps do not replay when resuming.
- Field-wait tests probe readiness without focusing or mutating a field, reject duplicate labels, and stay bound to the selected document. The existing bounded wait and cancellation checks continue to pass.
- Microphone-check tests exercise sound and quiet input, denied/ignored permission prompts, cancellation before permission resolves, cleanup of late streams, audio-context closure, and complete timer cleanup. They use simulated audio devices; no actual audio was captured during development.
- Setup integration tests verify a real dispatcher call through mocked Chrome APIs creates one background practice tab without microphone permission or AI, and readiness checks make no provider calls or permission requests. A successful microphone setup updates only its local readiness flag.
- Browser UI fixture checks cover the parameterized Research template, arrow-based reordering with an updated action preview, saving, completed/failed/skipped progress states, readiness results, the setup-guide link, and the practice-command response. DOM component tests exercise actual drag/drop handlers and the import preview/confirmation flow. No microphone permission was requested in the browser fixture.
- Live installed-Chrome speech, host and OS permission behavior, and third-party editors remain unverified. The release is labeled a developer preview.

## Memory/lifecycle audit

Automated tests verify that speech final results, cancellation, and timeout call abort, detach handlers, and leave no timer behind; that concurrent offscreen requests create one document; and that close/recreate is serialized. Background integration tests verify cancellation invalidates a request before disposal and replayed results cannot execute twice.

Code inspection verifies a one-token prewarm, no dynamic KV cache stored across commands, no `return_dict_in_generate` cache retention, bounded logs, session disposal after errors, listener cleanup, and a bounded graceful-shutdown period before hard document closure. Transformers.js 3.8.1's generation cleanup disposes GPU result/cache tensors when returning sequences. Unloading an offscreen document releases its context, including remaining worker/GPU allocations.

This does **not** certify zero leaks or a stable physical GPU-memory plateau. Chrome Task Manager/DevTools measurements in an installed extension are still required. JavaScript heap alone would not prove GPU-memory release.

## Installed-Chrome checks still required

The task's browser connection exposed only the Codex in-app browser. Local Google Chrome is installed but was not available to the browser-control tool. Consequently this run did not load the extension into that Chrome profile, grant its microphone permission, verify a live spoken utterance, or measure installed-extension memory.

1. Load `dist/` in `chrome://extensions` and confirm no manifest/service-worker errors.
2. Confirm the shortcut is assigned. Exercise it on an HTTPS page, then on `chrome://newtab` (badge-only feedback is expected on restricted pages).
3. Allow the setup microphone, confirm the recording indicator turns off immediately, then test successive speech commands, several minutes of silence, permission denial, cancellation, and a network error. Repeat the 20-second timeout in single-command mode.
4. Exercise every action in the README, including multi-window fuzzy lookup and no-match feedback. Use disposable tabs/bookmarks for close/create tests.
5. Trigger repeated hotkeys and cancel during model startup. Verify no duplicate offscreen context and no actions execute after cancellation.
6. In Power Saver with the microphone off, wait three idle minutes and inspect `runtime.getContexts`/Chrome Task Manager for offscreen closure. Repeat 20 cold starts and compare process/GPU memory after garbage collection and shutdown.
7. Repeat on a GPU-disabled browser and verify WASM fallback. On a non-isolated context verify single-thread behavior; this latter fallback was inspected in code but not exercised in this run.
8. Grant per-site page access and test scrolling, numbered links, a text field, dictation focus changes, native media, group movement, workspace restore, duplicate review, and optional feedback in a disposable Chrome window. Enable/disable Learn my sites and verify permission and suggestion behavior.
9. Check reduced motion, keyboard navigation, and the popup in Chrome's actual maximum popup dimensions. The in-app browser did not apply its requested viewport override, so popup sizing still needs native verification.

## Reproduce model evaluation

`npm run eval:model` deliberately exits nonzero when the specified model fails its semantic case. It is an optional model-quality evaluation, separate from deterministic app tests and CI. Do not remove or weaken that expectation to make the model appear reliable. Improving the default AI experience requires representative evaluation and likely a task-tuned or larger model.

The source includes a localhost-only browser harness in `scripts/`. Open the preview server's `/src/offscreen/offscreen.html` to test real WebGPU inference with simulated Chrome transport, or add `?cpu=1` for WASM. Harness files and fixtures are excluded from the extension ZIP.
