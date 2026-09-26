# Manual voice and hardware validation

This is a repeatable test plan, not a record of completed human testing. Automated installed-browser coverage uses the 30 commands below, but synthetic speech events cannot measure microphone or transcription accuracy. No participant recruitment or telemetry is included. The optional diagnostic download records versions and status flags; it does not record these manual test results or microphone audio.

Use a disposable Chrome profile/window with no sensitive data. Note Chrome/extension version, operating system, input device, speech locale, selected pace, and whether the test used AI (use **off** for this baseline). Test a built-in microphone, a wired/USB headset, and Bluetooth where available. Repeat with ordinary and deliberately slow speech, short pauses, background noise, and the available US/UK/Australian/Canadian voices. Do not infer accent coverage from a locale setting alone.

For each attempt record: intended command, displayed transcript, first-attempt outcome, intended/actual target, clarification or recovery needed, and elapsed time to the verified result. Record only redacted, invented examples. Reset the fixture state before each case. Report raw successes/attempts by device and condition; do not pool retries into a first-attempt rate.

## Complete journeys

- Fresh install → assign an available shortcut → permit microphone → speak the guided command → verify one new tab and microphone off. Also deny permission, leave a prompt unanswered, and disconnect the microphone.
- Continuous listening → two commands separated by silence → shortcut/side-panel Stop → verify no later action and Chrome’s recording indicator off.
- Change/disconnect/reconnect the input device. Recover using setup or typing and verify queued speech did not replay.
- Disconnect internet during a phrase; restore it; say a complete fresh command. Verify the partial phrase was discarded. Built-in typed commands should still work offline.
- Put the computer to sleep while listening and while idle; wake it; check the actual recording indicator and restart explicitly if needed. Verify no stale action runs.
- Grant only one website, resume a partially completed sequence, then repeat after reloading/navigating the target. A changed target must refuse resumption.
- Update the existing unpacked folder without removing the extension. Confirm settings, nicknames, workspaces, and both routine types survive. Restart Chrome and repeat.

## Thirty command cases

Prepare a window with **Start page**, **Research**, and **Notes** tabs; Start page initially active. Use a local disposable form with a Search input, Remember me checkbox, Country dropdown containing Canada, at least one visible link, and enough height to scroll. Grant its page access where needed. Reset tabs and form state for each row.

| Command | Setup or expected result |
| --- | --- |
| Open a new tab | Exactly one new tab. |
| Pin this tab | Start page becomes pinned. |
| Unpin this tab | Start with it pinned; it becomes unpinned. |
| Mute this tab | Start page becomes muted. |
| Unmute this tab | Start with it muted; it becomes unmuted. |
| Zoom in | Current tab’s zoom increases. |
| Zoom to 125 percent | Current tab’s zoom is 125%. |
| Reset zoom | Start at 150%; it returns to 100%. |
| Switch to the Research tab | Research becomes active. |
| Next tab | Research becomes active. |
| Previous tab | Wraps to Notes. |
| Last tab | Notes becomes active. |
| Go to tab two | Research becomes active. |
| Move this tab to the end | Start page moves last. |
| Move this tab right | Start page moves one position right. |
| Duplicate this tab | One additional copy of Start page. |
| Close this tab | Only Start page closes. |
| Close tab two | Only Research closes. |
| Close all other tabs | Review exact targets, approve; only Start page remains. |
| Reopen the last closed tab | Close Notes first; restores one Notes tab. |
| Bookmark this page | Adds the intended current URL. |
| Group these tabs as Research | Select Start page and Research first; both join the named group. |
| Save this workspace as Research | Saves all three web tabs in that window. |
| Save this for later | Current page appears in Chrome’s reading list. |
| Fill the search box with black holes | Replaces the Search input without submitting. |
| Clear the search field | Search input becomes empty. |
| Check the Remember me checkbox | Becomes checked, even if initially checked. |
| Choose Canada from the Country dropdown | Canada is selected. |
| Show links | Visible links receive selectable numbers. |
| Scroll down a little | The page scrolls downward. |

Also try “open a new tab, no actually pin this tab”, conflicting recognized candidates, a negated command, and unfinished speech followed by Stop. Confirm literal dictated/search/field text keeps correction-like words as data.

## Version 1.9 journeys

These additions also need real speech and device testing; automated passes do not establish their recognition accuracy.

- In a focused text field, say “select text black holes”, “replace text black holes with neutron stars”, and move the cursor to each end. Repeat with two occurrences, a readonly field, and an editor that rejects input. Ambiguous or refused edits must leave the field unchanged.
- Dictate at the middle of existing text, then say “scratch that”. Verify the exact earlier value and caret return once. Repeat after manually editing or moving the caret; correction must stop rather than overwrite that newer change. Use “literal scratch that” to enter those words.
- Compare spoken punctuation off and on with “hello comma world period”, then say “literal comma”. Verify the setting persists and ordinary search or replacement text is unchanged by it.
- Navigate named headings and page regions, then next/previous destinations. Include a heading containing a link: focus and scrolling must not activate it. Find a phrase spanning bold text; hidden text and unrelated regions must not produce a match.
- With optional site access as the only grant, number a page or start dictation, revoke access, and try another action. Verify no click or insertion occurs. Distinguish this from Chrome’s independently valid temporary activeTab grant.
- Save a workspace with a non-first active tab and separate groups sharing a name. Restore it and verify active tab, order, pins, colors, and collapsed states. Say “mute this tab” and then “mute them” to check singular and plural targets.
- Export an invented library and import it into a disposable profile. Expand the preview to inspect URLs and steps. Cancel once, then import; repeat to check duplicate skips. Verify settings and credentials are not transferred, and no saved routine executes during import.
- Move several selected tabs right, to the beginning, and to the end; undo each. Repeat at a boundary and after a manual rearrangement. Say Stop during a multi-step action and recover an eligible failure by voice; completed work must not replay.

## Multiline writing and caret placement

- In a textarea and a plain editable area with several paragraphs, say “move the cursor before text black holes” and “move the cursor after text black holes”. Check the caret is immediately beside the unique phrase. Repeat with accents, emoji, bold text, repeated phrases, and password/readonly fields. Ambiguous or protected targets must keep the existing text and selection.
- Number the fields in an editor containing paragraphs and inline formatting. The editor should have one field number; its bold words and paragraphs should not become separate fields. Move to it with “next field”.
- Dictate “one new line two new paragraph three new line”. Verify separate visible lines, one blank line between “two” and “three”, and a final empty line. Continue dictating on that final line. Repeat in an empty editor, at the middle of existing paragraphs, and after selecting text across paragraphs.
- In a disposable `<div contenteditable>a<p>b</p>c</div>`, partially select across the boundary from the containing text into the paragraph, then from the paragraph back into the containing text. Attempt a replacement by voice, including one with “new line”. Each attempt must refuse with guidance about nested paragraphs and keep all selected and untouched text in its original order. Separately verify that caret insertion within one container, whole-field fill and clear, and replacements across sibling paragraphs such as `<div contenteditable><p>a</p><p>b</p></div>` still work.
- After a multiline insertion, say “scratch that”. Check the original paragraphs, formatting, selection, and interactive inline elements are restored. Repeat after a manual edit or changed selection; undo must refuse to overwrite the newer state.
- On a disposable test page that changes a field during its `beforeinput` event, attempt text entry. Changing the value, selection, focus, editability, or editor nodes must stop the insertion and preserve the page's newer state. Include an editor that accepts the event but rejects the later update.

## Long-session performance and battery

The automated performance test records a cold typed command, 20 warm cycles, retained offscreen JavaScript heap after GC, and engine task duration. It cannot establish whole-process/GPU memory or battery consumption.

On each actual laptop, use the same screen brightness, power mode, browser tabs, network, and microphone. Record battery charge or energy readings before and after comparable 30-minute runs: extension idle, continuous listening with a fixed command schedule, and (optional edition) model use. Repeat runs and report duration, hardware, charge/energy difference, and variability. Run on battery without forcing sleep; do not attribute unrelated machine activity to the extension. Use Chrome Task Manager/DevTools to track process and GPU memory through 20 cold starts, a 30-minute session, and engine release. Verify Power Saver closes the idle engine after three minutes.

Proposed targets remain **unmeasured**: 90% first spoken setup within two minutes without help; 95% first-attempt success on this defined command set; zero observed wrong-target destructive actions; every migration check passes. They are targets, not current product claims.

## Version 1.10 decision listening and readback

Use disposable tabs and invented text. Record the actual words heard and the selected target; synthetic transcription and speech-output tests do not establish microphone accuracy or local-voice quality.

- Choose **Microphone behavior → Listen for one command**. Prepare four tabs matching one spoken name, ask to pin that name, and wait for the numbered question. The microphone should turn off while the question remains. Choose **Listen to answer** or press the shortcut, say an option number, and verify exactly that tab changes. Switch the active browser tab before answering: the original question's target must remain authoritative. Each attempt should listen for one utterance only.
- Start a command routine with a missing text input. Answer through **Listen to answer**, including “read the choices” or “next choices” as the intended input. Those words must remain data in a freeform question. Use the **Read or repeat aloud** button to hear such a prompt. After inputs are complete, the routine must still wait for its concrete review; listening or reading never approves it.
- Keep **Command feedback → Visual feedback only**. Ordinary results should remain silent. Explicitly choose **Read or repeat aloud**, or say “read the choices” / “read the command” while answering a structured question or review. Follow with “next choices” and “previous choices”. Hear a list with at least four options and a long title or URL: global option numbers must stay stable, continuation pages must retain the same option number, and all content must remain available without truncation. Reading must not change the question, review, completed steps, or target.
- Read a review containing command-like literal text such as “confirm command” or “cancel command”. Recognition pauses during readback; spoken output and speech buffered before it must never select an option or approve the review. When reading finishes, continuous mode should resume its original capture; single-command mode should remain off until another explicit listening attempt. Then give a fresh answer. If recognition alternatives conflict, the decision must remain pending for another attempt.
- While audio is playing, choose **Cancel command** or the side-panel **Stop** button. Playback and the pending command must stop. In continuous mode, the shortcut also stops the session. With the microphone off and a decision pending, the shortcut instead stops playback and starts one fresh answer attempt; it must not approve anything. Repeat playback, immediately start a newer readback or listener, and verify an older completion/error cannot replace the newer status or restart an old microphone session.
- During an answer attempt, disconnect the microphone or remain silent through the timeout (20 seconds, or 40 with **Take my time**). The microphone should stop, and the unchanged decision should offer another explicit attempt. Repeat listening and readback, then wait beyond the original five-minute decision expiry: those operations must not extend approval or question validity. A late answer must make no changes.
- Try explicit readback on a machine with an installed local English voice and, separately, with no usable local voice or unavailable audio output. Verify readable guidance on unavailable playback or timeout, no cloud voice selection, and no automatic approval. Continuous recognition should resume only its original valid session; an already stopped session must stay stopped. Read near the three-minute engine-idle boundary to check that active readback is not cut off by the previous idle alarm.

## Version 1.10 saved workspaces and diagnostic reports

- Save an invented workspace containing pinned tabs and distinct groups, then change the open tabs and request an update. Expand the proposed-tab details and inspect URLs, titles, active tab, pin states, and group metadata. Clicking or selecting preview text must not approve the update. Keep the original save once, then approve a fresh review.
- Change a source tab, group, or saved workspace after the update question appears. Approval must refuse the stale proposal. Repeat while a source tab is navigating, and while stopping the command. Check that completed browser actions are not replayed.
- Recover the previous saved version and verify that open browser tabs stay unchanged. Rename the workspace by voice, including a name containing words such as “then close all tabs”; those words must remain the name. Both saved versions must remain available. Duplicate names must be rejected.
- Ask to discard only the previous version. Inspect its full contents, choose Keep once, then explicitly discard it. The current save must remain intact, and a new library export must exclude the discarded history. A changed save must require a fresh review.
- Download diagnostics from Settings and from the welcome guide. Inspect the JSON and confirm it contains only versions, bounded status values, configuration flags, and collection counts. Invent a private URL, custom trigger phrase, provider endpoint, and saved library name; none should appear in this report. No microphone or provider request should start. A library backup is a separate file that deliberately contains saved content.
