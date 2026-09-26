# Command guide

Use **Speaking pace → Take my time** for longer pauses. HandsFree supports explicit spoken corrections between complete commands and asks short choices when recognition alternatives have different supported meanings. Literal search/field text and dictation keep correction-like words as data. Unfinished speech, negation, and conflicting candidates do not silently become extra actions.

Open **Keep open beside my tabs** for a persistent transcript, target, progress, and Stop. On a recoverable failure, use **Allow [site]**, **Choose another tab**, or **Edit what I heard**. Granting access does not execute anything; **Resume remaining steps** is a separate choice. Confirmed completed steps are not replayed. A changed page, expired recovery, or new command requires a fresh attempt. Native tab state and immediate field values are checked after supported actions; these checks do not certify a website's later server-side save.

The extension’s **Commands** tab is the complete searchable guide. Select an example to copy it into Control without executing it. Edit names, numbers, or text before submitting it.

## Targets and follow-ups

Use a precise tab title or site name: “mute YouTube”, “switch to the GitHub tab”, or “close tab containing design notes”. If several tabs match, choose an option number or a more specific title. A number such as “tab three” means the third tab from the left in the current window.

“Mute it”, “pin them”, and “move that beside Gmail” can use recent target context. “These tabs” uses highlighted tabs or a previously targeted set. “Actually, pin it instead” can correct a recent supported reversible action. “Stop” cancels remaining work.

Moving several selected tabs preserves their visible order and keeps pinned tabs in their own section. A numbered position is the selection’s starting slot; choose a position with room for the whole selection. If tabs move manually during the command, remaining moves stop.

## Page controls and forms

Allow the website in Settings before using page controls. “Show links” numbers visible clickable controls. “Show form fields” numbers available fields. Numbers expire or are rejected if their target changes.

“Show headings” opens a page-outline choice; “show page regions” lists landmarks such as navigation and main content. Say an option number or use “go to the Pricing heading”, “next heading”, “previous heading”, “next landmark”, or “go to main content”. These commands scroll and focus the destination without activating links inside it. Navigation stays inside the current accessible page frame and uses the page's native headings or ARIA semantics. Pages without that structure may still use find, scrolling, and numbered links.

“Scroll left” and “scroll right” use the focused horizontal panel when one is available. Find can match phrases across inline formatting, such as a sentence with one bold word; it keeps separate paragraphs, page regions, and editable fields separate.

- “Scroll down a little”; “go to the bottom”; “keep going”.
- “Find pricing on this page”; “next match”; “previous match”.
- “Click the Pricing button”; “open number five in a new tab”.
- “Focus the search box”; “type hello”; “fill Notes with hello, please!”.
- “Clear the search field”; “select all text”; “delete selected text”.
- “Select text black holes”; “replace text black holes with neutron stars”.
- “Move the cursor to the start”; “move the cursor to the end”.
- “Next field”; “previous field”.
- “Choose Canada from the Country dropdown”; “check Remember me”.
- “Pause this video”; “rewind two minutes”; “set volume to 40 percent”.

Unquoted typing and replacement text remain literal, including command-like words. Form entry does not submit the form. Native dropdowns, checkboxes/radios, ordinary text inputs, textareas, and plain contenteditable are supported. Password/disabled/readonly/hidden text fields and inaccessible custom widgets are excluded.

Start continuous listening before saying “start dictation”. Dictation inserts text into its selected field and stops if focus changes. Say “stop dictation” or “back to commands” to return to command mode. While dictating, ordinary “stop” remains literal text.

Phrase editing works inside the **focused field**. “Select text …” selects one case-insensitive occurrence; “replace text … with …” replaces it. If the phrase appears more than once, include more surrounding words. Replacement text stays literal, including “then close all tabs”. To replace a phrase containing “with”, quote it: `replace text "tea with milk" with coffee`. “Fill Notes with …” still replaces an entire named field. Standard text inputs, textareas, and editable text that supports a selection can use cursor and phrase commands.

During dictation, say **“scratch that”** or **“undo last dictation”** as a complete phrase to restore the field and selection from before the last insertion. It works once, only while the field, caret, and content remain unchanged; an unavailable or refused correction stops dictation and keeps the current text. Manual edits, a new dictation session, or a focus change invalidate the saved correction. This temporary correction stays in the page's memory and is not saved to extension storage.

“New line” and “new paragraph” insert line breaks during dictation. Prefix an utterance with **“literal”** to keep those words or a reserved control phrase as text: “literal scratch that”, “literal new line”, or “literal stop dictation”. Dictation respects the current caret and selection, and stops if a controlled editor rejects its update. It does not certify later server-side saves.

Enable **Settings → Spoken punctuation in dictation** to convert “comma”, “period” / “full stop”, “question mark”, “exclamation mark”, “colon”, “semicolon”, “open parenthesis”, “close parenthesis”, “open quote”, “close quote”, “hyphen”, and “dash”. It is off by default. For example, “Hello comma world period” becomes “Hello, world.” “Literal comma” still enters the word. Search terms and ordinary type/replace commands keep their text regardless of this setting.

When recognition alternatives disagree on confirmation or an answer, HandsFree keeps the question open and asks you to repeat. A clear “cancel command” still cancels. Speech heard before a new review prompt cannot approve it later.

After a recoverable failure, say **“choose another tab”** to select a missing target, or **“resume remaining steps”** after granting the required site access. Access still requires Chrome's permission control. Recovery keeps completed steps completed and rechecks the original page, expiry, and target before acting; ordinary “resume” remains a media command.

When no command is waiting for recovery, those phrases can still run a saved routine or website routine with the same exact phrase.

## Organization and saved collections

- “Sort tabs by site” or “sort tabs by title” sorts unpinned, ungrouped tabs after existing groups in this window.
- “Group Gmail and GitHub as Work”, “collapse Work group”, “make Work group blue”, or “ungroup Work group”.
- “Save this workspace as Research”; “restore Research workspace”.
- “Save this for later”; “show my reading list”; “open my unread articles”.
- “Call this site Work dashboard”; “open Work dashboard”.
- “Show duplicate tabs” reviews exact-URL copies while preserving active and pinned tabs.

Supported undo covers tab moves, pinning, muting, and zoom, and refuses to replace newer manual changes. Sorting, form edits, and whole routines do not have automatic undo. Closed tabs use “reopen the last closed tab”.

New workspace saves preserve the active tab plus group identity, title, color, and collapsed state. Restoring opens a new window and returns to the saved active tab; a following “mute this tab” affects that tab, while “mute them” applies to the restored set. Older saved workspaces still open in their original order, using their first tab and saved group titles. The progress list distinguishes opened tabs from confirmed pin/group changes, so partial restoration is visible.

## Routines and inputs

Each routine has up to eight actions; targeting a named tab may count as one action before its mutation. Put one command per line. Use fixed action names and destinations, with placeholders such as `{topic}` for search words or literal field text. Up to three inputs are supported. A spoken phrase may include one placeholder at its end, such as “research {topic}”.

Inputs work in search queries, field text and labels, a single tab query, and bookmark titles. They cannot substitute entire commands, website hostnames, action enums, or numeric parameters. Values are inserted after parsing so “cats then close all tabs” remains data.

“Wait for the page to load” waits for document loading. “Wait for the search field” waits for one matching editable field in an accessible frame. Both are bounded at 15 seconds and can be cancelled. Use a more precise label if several fields match.

The library's **Back up or move your library** control exports site nicknames, website routines, command routines, and workspaces together. Import merges reviewed items and skips identical entries; it never overwrites a saved collection or runs a command. Conflicting spoken phrases or names must be edited before importing. Website routines may share a display name when their command phrases differ. Device settings, permissions, credentials, suggestions, and activity are excluded. The 5 MiB limit is checked before parsing and again before saving; the latest saved library is rechecked at confirmation.

Every routine starts with a concrete preview. Missing inputs are asked first. A clarification during execution resumes unfinished actions only. The progress list shows confirmed completions and marks remaining work skipped when execution stops. Read it before retrying to avoid repeating changes yourself.

## Boundaries

The extension supports a defined set of browser actions. Optional AI can interpret additional wording for those actions; it cannot add arbitrary capabilities. Native Chrome/OS dialogs, restricted pages, unsupported widgets, and some cross-origin frames require manual interaction. “Open history” and similar commands display Chrome’s management page without reading its records into HandsFree.
