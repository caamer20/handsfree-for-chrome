<p align="center">
  <img src="public/icons/icon-128.png" width="88" height="88" alt="HandsFree microphone icon">
</p>

<h1 align="center">HandsFree for Chrome</h1>
<p align="center"><strong>Your browser. At your word.</strong><br>Voice control, dictation, and reusable routines for Chrome.</p>
<p align="center">
  <a href="https://github.com/caamer20/handsfree-for-chrome/actions/workflows/build-and-test.yml"><img src="https://github.com/caamer20/handsfree-for-chrome/actions/workflows/build-and-test.yml/badge.svg" alt="Build and test"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="License: Apache 2.0"></a>
  <img src="https://img.shields.io/badge/status-developer_preview-cc8b2d" alt="Developer preview">
  <img src="https://img.shields.io/badge/Chrome-120%2B-4285F4" alt="Chrome 120 or later">
</p>
<p align="center">
  <a href="https://github.com/caamer20/handsfree-for-chrome/releases">Download preview</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="PRIVACY.md">Privacy</a> ·
  <a href="https://github.com/caamer20/handsfree-for-chrome/issues">Report an issue</a>
</p>

HandsFree turns spoken or typed commands into browser actions. Find a tab by name, organize a workspace, edit a form, dictate into a text field, or combine commands into a routine of your own. Common commands run through a local parser. An AI account is optional.

> **Developer preview:** Version 1.10 adds spoken follow-up answers and paged readback, safer multiline writing, recoverable workspace updates, and diagnostic reports that exclude private content. Automated speech tests use synthetic transcription results; real microphones, accents, OS sleep/wake, and complex third-party websites still need human testing. HandsFree is not listed in the Chrome Web Store. See the [validation record](docs/VALIDATION.md).

## What you can do

- **Control tabs and windows.** Find, switch, pin, mute, move, group, sort, close, and reopen tabs. Work with named tabs, positions, ranges, and filtered sets.
- **Work on the page.** Scroll, find text, number links and form fields, fill or clear text, select dropdown options, and control native media.
- **Navigate page structure.** Choose a heading or page region, move through headings by voice, and find phrases across inline formatting.
- **Dictate into a field.** Speak text while continuously listening; say “stop dictation” to return to commands.
- **Correct text by voice.** Select or replace a phrase in the focused field, put the cursor before or after it, or say “scratch that” during dictation to undo the last unchanged insertion. Plain editable areas support visible line breaks and paragraph-aware editing.
- **Make it personal.** Save website nicknames, preferred apps, workspaces, and groups of websites to open together.
- **Keep your library portable.** Export site nicknames, both kinds of routines, and workspaces with their previous saved versions; preview an import before adding it without overwriting saved entries.
- **Keep conversations going.** Answer a question or command review with one fresh spoken response. Read or repeat the full choices aloud and move between pages.
- **Update workspaces safely.** Review the proposed tabs before replacing a save, recover its previous version, rename it by voice, or discard only its saved history after reviewing it.
- **Build reusable routines.** Supply inputs such as `{topic}`, reorder steps, wait for a page or field, and import/export routine templates.
- **See what happened.** Follow action progress, answer clarifying questions, review bulk closures, and inspect confirmed completions when execution stops.
- **Keep controls nearby.** Open the optional side panel for your transcript, current tab, progress, choices, and Stop button across tab changes.
- **Recover where you stopped.** Allow a blocked site, choose a missing tab, or edit the transcript. Eligible commands resume only their unfinished steps after you explicitly choose Resume.

## Quick start

### Install a release

1. Download `handsfree-for-chrome.zip` from [Releases](https://github.com/caamer20/handsfree-for-chrome/releases) and extract it into a permanent folder.
2. In desktop Chrome, open `chrome://extensions` and turn on **Developer mode**.
3. Choose **Load unpacked** and select the extracted folder containing `manifest.json`.
4. Pin **HandsFree for Chrome** from Chrome’s Extensions menu.
5. Follow the welcome guide: allow the microphone, select **Start spoken practice**, and say **“open a new tab”**. Setup shows what it heard and verifies the new tab exists.

**Building from source?** Load the generated **`dist`** directory, not the project root. Keep the loaded directory in place. After updating its files, select **Reload** on HandsFree’s extension card.

### Run a command

Press **⌘ Shift Space** on macOS or **Ctrl Shift Space** on Windows/Linux, then say:

> “Open a new tab.”

Continuous listening stays on until you press the shortcut again or choose **Stop listening**. The popup’s **Control** tab also accepts typed commands without microphone permission. Configure an optional trigger phrase in Settings, or choose single-command listening.

Choose **Keep open beside my tabs** to open the side panel. If you need longer pauses, select **Settings → Speaking pace → Take my time**. Distinct speech alternatives produce a short choice before acting; explicit corrections such as “open a new tab, no actually pin this tab” use the corrected command. Dictated text and literal search/field text keep their words.

For commands that interact with a website, open **Settings → Page controls → Allow this site**. Browser pages such as `chrome://extensions` cannot use page controls.

## Try these commands

| Say or type | Result |
| --- | --- |
| “Pull up Gmail” | Switch to an existing Gmail tab or open the site. |
| “Mute the YouTube tab” | Find and mute the named tab. Multiple matches ask for a choice. |
| “Pin tabs two, four, and six” | Target specific positions in the current window. |
| “Close all tabs except Gmail” | Review the tabs to close while keeping the named tab. |
| “Show links” | Number visible links and controls; follow with “click number five”. |
| “Show headings” | Choose a heading from the page outline, then navigate without activating its links. |
| “Fill the search box with black holes” | Replace the field’s text without submitting the form. |
| “Choose Canada from the Country dropdown” | Select an exact label in a native dropdown. |
| “Start dictation” | Insert speech into the focused editable field. |
| “Replace text black holes with neutron stars” | Replace one occurrence inside the focused editable field. |
| “Move the cursor to the end” | Put the caret after the focused field’s text. |
| “Move the cursor before text black holes” | Place the caret before one matching phrase in the focused field. “After text …” works too. |
| “Save this workspace as Research” | Save web tabs, pin states, and groups locally. |
| “Update Research workspace” | Review the current tabs before replacing the saved version. |
| “Recover Research workspace” | Review and recover the previous save without changing open tabs. |
| “Rename Research workspace to Reading” | Change its name while keeping both saved versions. |
| “Discard previous version of Research workspace” | Review and remove only the previous save. |
| “Read the choices” / “Next choices” | Read the current question or review aloud while listening for an answer. |
| “Wait for the search field” | Wait up to 15 seconds for a matching editable field. |
| “Undo that move” | Restore a supported tab move, if the target has not changed manually. |
| “Stop” | Cancel remaining command work while retaining completed changes. |

For punctuation words during dictation, enable **Settings → Spoken punctuation in dictation**. Say “literal …” to keep a phrase unchanged. See the [command guide](docs/COMMANDS.md) for correction, page navigation, and recovery details.

The **Commands** tab contains searchable examples and alternate wording. Names, numbers, and search terms can be changed to suit your task. [Command details and limits](docs/COMMANDS.md)

## Your own routines

Open **Library → Routines** and create a routine:

**Name:** Research starter<br>
**Command to say:** `Research {topic}`

```text
Search Wikipedia for {topic}
Wait for the page to load
Pin this tab
```

Say **“research black holes”**, or choose **Preview & run** and answer the input prompt. HandsFree shows the concrete actions before execution. Inputs are inserted into data fields after parsing; input text cannot become extra commands.

- Save up to **50 routines**, each containing at most **8 actions**. Selecting a named target can count as a separate action.
- Use up to **three inputs** in search terms, field text or labels, tab queries, and bookmark titles. A spoken phrase can contain one input at its end; remaining inputs are asked before review.
- Drag steps or use the up/down buttons to reorder them.
- Export templates as JSON. Import previews every routine and refuses conflicting phrases without overwriting saved routines.
- Routines pause for clarification and resume only unfinished actions. A failure or cancellation stops remaining actions; it does not roll back completed changes.

Under **Library → Routines**, choose **Command steps** for action sequences or **Open websites** for a saved list of up to 20 sites. Existing website macros appear here automatically. **Workspaces** restore saved tabs, pin states, the active tab, and separate groups with their colors and collapsed states in a new window. Groups remain separate even when their titles match or are empty.

Choose **Library → Back up or move your library** to export those saved collections as one JSON file. Import shows what will be added and skips identical entries. Conflicting saved names or spoken phrases stop the import before changes are saved. The file includes saved URLs and command steps; settings, API keys, site permissions, setup history, activity, and site suggestions are excluded. Nothing runs when importing. Files are limited to 5 MiB.

## Setup and troubleshooting

The welcome guide tests the complete spoken path and identifies microphone, speech, interpretation, or browser-action failures. Expand **Check microphone volume** or **Try browser control without speaking** for optional checks; those checks do not count as a successful spoken practice. A saved success records the earlier practice, not the current health of a microphone.

In **Settings → Readiness & troubleshooting**, select **Check readiness** to inspect your shortcut, saved setup state, website access, voice engine, and AI configuration. These checks do not start listening or make a paid API request.

| Problem | Try this |
| --- | --- |
| Chrome says the manifest is missing | Choose the extracted release folder or the source build’s `dist` directory. |
| The shortcut does nothing | Open Settings → Change shortcut and choose an unassigned combination. |
| The microphone is blocked or quiet | Use Microphone setup, check Chrome/OS microphone permission, and verify your selected input device. |
| A field or button cannot be found | Allow the site, use its visible accessible label, and try “show form fields” or “show links”. |
| The voice engine stops responding | Release the engine in Settings, then start listening again. Reload the extension if necessary. |
| A routine stops partway through | Read the progress list before retrying. Completed changes remain in place. |
| A command needs website access | Choose **Allow this site**, then **Resume**. Completed steps are not repeated. Navigation, expiry, or another command can make resuming unavailable. |
| A tab name cannot be found | Choose **Choose another tab**, or edit the command. The selected tab is checked again before acting. |
| AI cannot connect | Check the provider, model, saved key, and granted API origin; use Test saved connection. |

Download an inspectable diagnostic report from Settings → Website access and troubleshooting, or from the welcome guide. It includes versions, status, configuration flags, and saved-item counts; it excludes URLs, command text, saved content, and credentials. It is saved locally and is never uploaded automatically.

Please include the extension version, operating system, steps to reproduce, and a redacted command example in [bug reports](https://github.com/caamer20/handsfree-for-chrome/issues/new?template=bug_report.yml). Do not include API keys, private page contents, or sensitive browsing information.

## AI and privacy

**AI is off by default.** Built-in commands, macros, and routines work without a provider account. You can enable:

- **On-device SmolLM2**, included only in the optional **local-AI edition**. It failed all 12 exact-plan cases in the current isolated benchmark. It remains experimental and can misinterpret unsupported phrasing.
- **Your own cloud provider:** OpenAI, Anthropic Claude, Google Gemini, or an OpenAI-compatible HTTPS API. You supply the model and key; provider charges may apply.

Validated AI plans execute automatically by default. AI tab closures require confirmation, and Settings can require review of every AI command. The extension accepts only its defined actions; it does not execute generated JavaScript.

Common commands and routine templates are processed locally. With cloud AI enabled, unmatched command text is sent to the selected provider. Page contents and tab lists are not sent to that provider. API keys are stored locally, are not synced, and are not encrypted by HandsFree.

**Speech recognition is separate from command interpretation.** Chrome’s speech service may send audio to Google and require internet, even when AI is disabled or runs locally. HandsFree does not record audio, operate an application backend, or include analytics. Read the complete [privacy policy](PRIVACY.md) and [permission explanations](docs/STORE-PREPARATION.md).

## Current limits

- Desktop Chrome **120+**; English speech settings for US, UK, Australia, and Canada.
- The standard edition contains no model weights or AI runtime and is about **0.6 MiB unpacked**. The optional local-AI edition includes both model variants and is approximately **212 MiB zipped**. Both editions support optional cloud AI.
- Standard text inputs, textareas, multiline plain contenteditable, native checkboxes/radios, and native single-select dropdowns are supported. “New line” and “new paragraph” produce visible breaks during dictation. Custom editors, protected pages, and inaccessible frames may require manual interaction.
- Password, hidden, disabled, and readonly text fields are excluded. Form entry does not implicitly submit.
- Page and field waits stop after 15 seconds. A document-load event does not guarantee that a site has finished all background requests.
- Undo covers supported tab moves, pinning, muting, and zoom. During dictation, “scratch that” can restore the last unchanged insertion. Neither is a general undo for form edits, sorting, or an entire routine.
- The repository’s model evaluation deliberately fails when the small model returns an incorrect intent. That quality limitation is not hidden by the passing application tests.

## Development

Use Node.js 24 and npm:

```bash
git clone https://github.com/caamer20/handsfree-for-chrome.git
cd handsfree-for-chrome
npm ci
npm run check
npm run package
```

The standard build needs no model download. For local AI, run `npm run models:download`, `npm run check:local-ai`, and `npm run package:local-ai`; load `dist-local-ai`. Downloads use pinned upstream files and verified checksums. Build output, weights, and release archives are excluded from Git.

| Command | Purpose |
| --- | --- |
| `npm test` | Run application tests. |
| `npm run check` | Lint, test, typecheck, build, and verify the MV3 package. |
| `npm run dev` | Rebuild during development; reload the unpacked extension after changes. |
| `npm run package` | Package the current `dist` build and write `release/SHA256SUMS`. |
| `npm run test:browser` | Test the installed production extension in disposable Chrome profiles; first run `npx playwright install chromium`. |
| `npm run test:upgrade` | Test the actual prior release and browser restart; set `HANDSFREE_UPGRADE_ZIP` to its ZIP. |
| `npm run check:local-ai` | Build and verify the optional edition, after downloading models. |
| `npm run eval:model` | Run the separate model-quality evaluation; see its known failure above. |

The [CI workflow](.github/workflows/build-and-test.yml) checks and packages both editions, audits production dependencies, and runs installed-browser suites on Linux, macOS, and Windows. It also checks upgrades from the published 1.8 and 1.7 previews. Platform execution results are distinct from the local validation record. For architecture, manual voice coverage, and contribution instructions, see [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/VALIDATION.md](docs/VALIDATION.md).

## Project and support

- [Releases](https://github.com/caamer20/handsfree-for-chrome/releases) · [Changelog](CHANGELOG.md)
- [Bugs and feature requests](https://github.com/caamer20/handsfree-for-chrome/issues)
- [Contributing](CONTRIBUTING.md) · [Security reporting](SECURITY.md)
- [Chrome Web Store preparation](docs/STORE-PREPARATION.md)

Licensed under **Apache 2.0**. Bundled dependencies and models retain their own notices; see [third-party notices](public/THIRD-PARTY-NOTICES.txt). HandsFree is an independent project and is not affiliated with Google.
