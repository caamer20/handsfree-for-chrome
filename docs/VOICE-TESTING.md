# Manual voice and hardware validation

This is a repeatable test plan, not a record of completed human testing. Automated installed-browser coverage uses the 30 commands below, but synthetic speech events cannot measure microphone or transcription accuracy. No participant recruitment, telemetry, or troubleshooting-export feature is included.

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

## Long-session performance and battery

The automated performance test records a cold typed command, 20 warm cycles, retained offscreen JavaScript heap after GC, and engine task duration. It cannot establish whole-process/GPU memory or battery consumption.

On each actual laptop, use the same screen brightness, power mode, browser tabs, network, and microphone. Record battery charge or energy readings before and after comparable 30-minute runs: extension idle, continuous listening with a fixed command schedule, and (optional edition) model use. Repeat runs and report duration, hardware, charge/energy difference, and variability. Run on battery without forcing sleep; do not attribute unrelated machine activity to the extension. Use Chrome Task Manager/DevTools to track process and GPU memory through 20 cold starts, a 30-minute session, and engine release. Verify Power Saver closes the idle engine after three minutes.

Proposed targets remain **unmeasured**: 90% first spoken setup within two minutes without help; 95% first-attempt success on this defined command set; zero observed wrong-target destructive actions; every migration check passes. They are targets, not current product claims.
