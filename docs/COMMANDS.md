# Command guide

The extension’s **Commands** tab is the complete searchable guide. Select an example to copy it into Control without executing it. Edit names, numbers, or text before submitting it.

## Targets and follow-ups

Use a precise tab title or site name: “mute YouTube”, “switch to the GitHub tab”, or “close tab containing design notes”. If several tabs match, choose an option number or a more specific title. A number such as “tab three” means the third tab from the left in the current window.

“Mute it”, “pin them”, and “move that beside Gmail” can use recent target context. “These tabs” uses highlighted tabs or a previously targeted set. “Actually, pin it instead” can correct a recent supported reversible action. “Stop” cancels remaining work.

## Page controls and forms

Allow the website in Settings before using page controls. “Show links” numbers visible clickable controls. “Show form fields” numbers available fields. Numbers expire or are rejected if their target changes.

- “Scroll down a little”; “go to the bottom”; “keep going”.
- “Find pricing on this page”; “next match”; “previous match”.
- “Click the Pricing button”; “open number five in a new tab”.
- “Focus the search box”; “type hello”; “fill Notes with hello, please!”.
- “Clear the search field”; “select all text”; “delete selected text”.
- “Next field”; “previous field”.
- “Choose Canada from the Country dropdown”; “check Remember me”.
- “Pause this video”; “rewind two minutes”; “set volume to 40 percent”.

Unquoted typing and replacement text remain literal, including command-like words. Form entry does not submit the form. Native dropdowns, checkboxes/radios, ordinary text inputs, textareas, and plain contenteditable are supported. Password/disabled/readonly/hidden text fields and inaccessible custom widgets are excluded.

Start continuous listening before saying “start dictation”. Dictation inserts text into its selected field and stops if focus changes. Say “stop dictation” or “back to commands” to return to command mode. While dictating, ordinary “stop” remains literal text.

## Organization and saved collections

- “Sort tabs by site” or “sort tabs by title” sorts unpinned, ungrouped tabs after existing groups in this window.
- “Group Gmail and GitHub as Work”, “collapse Work group”, “make Work group blue”, or “ungroup Work group”.
- “Save this workspace as Research”; “restore Research workspace”.
- “Save this for later”; “show my reading list”; “open my unread articles”.
- “Call this site Work dashboard”; “open Work dashboard”.
- “Show duplicate tabs” reviews exact-URL copies while preserving active and pinned tabs.

Supported undo covers tab moves, pinning, muting, and zoom, and refuses to replace newer manual changes. Sorting, form edits, and whole routines do not have automatic undo. Closed tabs use “reopen the last closed tab”.

## Routines and inputs

Each routine has up to eight actions; targeting a named tab may count as one action before its mutation. Put one command per line. Use fixed action names and destinations, with placeholders such as `{topic}` for search words or literal field text. Up to three inputs are supported. A spoken phrase may include one placeholder at its end, such as “research {topic}”.

Inputs work in search queries, field text and labels, a single tab query, and bookmark titles. They cannot substitute entire commands, website hostnames, action enums, or numeric parameters. Values are inserted after parsing so “cats then close all tabs” remains data.

“Wait for the page to load” waits for document loading. “Wait for the search field” waits for one matching editable field in an accessible frame. Both are bounded at 15 seconds and can be cancelled. Use a more precise label if several fields match.

Every routine starts with a concrete preview. Missing inputs are asked first. A clarification during execution resumes unfinished actions only. The progress list shows confirmed completions and marks remaining work skipped when execution stops. Read it before retrying to avoid repeating changes yourself.

## Boundaries

The extension supports a defined set of browser actions. Optional AI can interpret additional wording for those actions; it cannot add arbitrary capabilities. Native Chrome/OS dialogs, restricted pages, unsupported widgets, and some cross-origin frames require manual interaction. “Open history” and similar commands display Chrome’s management page without reading its records into HandsFree.
