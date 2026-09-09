# Add HandsFree to Chrome

1. Open `chrome://extensions` in Google Chrome.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select the **dist** folder in this project.
4. Pin **HandsFree for Chrome** in the Extensions menu.
5. On the welcome page, enable the microphone. Then open a web page and press **Command + Shift + Space** (macOS) or **Ctrl + Shift + Space** (Windows/Linux).

Start with “open a new tab”. The microphone stays on for more commands; press the same shortcut again to stop. You can also type a command in the popup. The `release` ZIP is for distribution/store upload; unpack it before loading, or use the ready-built `dist` folder directly.

If Chrome reports a shortcut conflict, open Settings → Change shortcut. If microphone access is blocked, use Settings → Microphone setup and check Chrome/macOS microphone permissions.

## Upgrade to version 1.7.0

In `chrome://extensions`, find HandsFree for Chrome and click its **Reload** button. Open the extension again and check that the header shows **1.7**. If Chrome asks you to load a folder, select this project's **dist** folder, which contains `manifest.json`; selecting the project folder produces the missing-manifest error.

In **Settings**, choose **AI for flexible commands**, select your provider, enter its model ID and your API key, and save. Approve access to that API address, then select **Test saved connection**. The test does not execute a command, but provider charges may apply. Common commands and saved macros still work without a key.

Continuous listening is the default. To return to one phrase per hotkey press, select **Microphone behavior → Listen for one command** and save.

Version 1.4 adds 37 site names, personal nicknames, default apps, follow-ups, clarification, undo, page controls, dictation, groups, saved workspaces, and duplicate cleanup. Open **Library** for Sites, Macros, Routines, Workspaces, and Read later. Try “close the YouTube tab”, “mute tab two”, “next tab”, or “reopen the last closed tab”. The new **sessions** permission is used to reopen closed tabs; Chrome may ask you to approve it when updating. The Commands screen lists the expanded examples.


For scrolling, numbered links, typing, dictation, or media controls, open a regular website and use **Settings → Page controls → Allow this site**. To use site suggestions, enable **Learn my sites**, save, and approve Chrome’s optional top-sites permission. Set your preferred email/music/calendar apps and optional feedback in Settings.

Upgrading from before 1.4 adds **tabGroups** and **readingList** permissions. Page access and top-site learning remain optional. Start continuous listening before saying “start dictation”; ordinary speech becomes literal field text until “stop dictation”.


Version 1.5 broadens everyday wording and adds filtered tab sets, tab ranges, counting from the right, named media controls, and spoken durations. Try “get rid of the YouTube tab”, “pull up Gmail”, “mute all pinned tabs”, or “rewind two minutes”. The Commands screen now searches alternate phrasings too. This update adds no permissions beyond version 1.4.

For the new commands, open **Library → Routines** to save several supported commands under a spoken phrase. Each run starts with a preview. Try “fill the search box with black holes”, “show form fields”, “choose Canada from the Country dropdown”, or “sort tabs by site”. Allow the website in Settings before using form controls. Version 1.6 adds no new permissions.

Version 1.7 adds a guided microphone check and practice command, **Settings → Readiness & troubleshooting**, reusable routine inputs such as `{topic}`, step reordering, JSON import/export, waits for fields, and an action progress list in Control. A completed step stays completed after cancellation. Read that list before retrying a partially completed routine.
