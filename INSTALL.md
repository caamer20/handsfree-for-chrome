# Add HandsFree to Chrome

Use desktop Chrome 120 or later. HandsFree is a developer preview installed through Developer mode.

1. Download and extract `handsfree-for-chrome.zip` from the project’s [Releases](https://github.com/caamer20/handsfree-for-chrome/releases). Keep the extracted folder in a permanent location.
2. Open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**.
3. Select the extracted folder containing `manifest.json`. If building from source, select **dist**, not the project root.
4. Pin **HandsFree for Chrome** in Chrome’s Extensions menu.
5. On the welcome page, enable the microphone, select **Start spoken practice**, and say **“open a new tab”**. The guide shows what was heard and checks that Chrome created the tab.

The standard edition needs no model download or AI account. The optional `handsfree-for-chrome-local-ai.zip` includes the experimental local model; its source build is **dist-local-ai**. Both editions support cloud AI with your own provider and key.

## Upgrade to 1.8

Keep the same unpacked folder path so Chrome keeps the extension identity and stored preferences. Replace its old contents with the extracted new package, leaving `manifest.json` directly inside that folder. In `chrome://extensions`, keep Developer mode enabled and select **Reload** on HandsFree. Open the extension and check the **1.8** badge.

Version 1.8 adds the `sidePanel` permission for persistent controls. Chrome may ask you to acknowledge changed permissions. Existing preferences, nicknames, workspaces, command routines, and website macros stay in local storage. Website macros now appear under **Library → Routines → Open websites**. If upgrading to the standard edition with local AI previously enabled, turn AI off or select a cloud provider under Advanced settings. To retain on-device AI, use the local-AI package at the same path.

## Start using it

Press **⌘ Shift Space** on macOS or **Ctrl Shift Space** on Windows/Linux. Say a command, then another. Continuous listening stays on until you press the shortcut again or choose Stop. To hear only one command, change **Settings → Microphone behavior**. Set **Speaking pace → Take my time** for longer pauses. If the shortcut conflicts, choose another under Settings → Change shortcut.

Choose **Keep open beside my tabs** for a side panel with the transcript, current tab, action progress, choices, and Stop. Typed commands work without microphone permission.

For scrolling, field editing, dictation, or media control, open a normal website. Clicking the extension toolbar action can grant temporary access to that tab. For repeated use, grant the site under **Settings → Website access and troubleshooting** or choose **Allow [site]** on a blocked command. Permission alone does not replay the command: select **Resume remaining steps** when offered. Completed steps stay completed. Navigation, expiry, or a new command can make resumption unavailable; review the progress before starting again.

The guide’s optional volume and typed-practice checks do not count as a completed spoken practice. If actual speech fails, read the displayed stage and check Chrome/OS microphone access, the selected input device, or internet connectivity. Chrome speech recognition can require internet even with AI off.

## Optional AI

Under **Settings → Advanced settings**, enable AI, choose a provider, enter a model ID and your own key, and save. Chrome requests access to that provider’s origin. **Test saved connection** checks a small sample without executing it; provider charges may apply. AI remains off by default. The small local model failed the current isolated quality benchmark and is experimental. Built-in commands and saved routines work without it.

See the [README](README.md) for commands and the [validation record](docs/VALIDATION.md) for test coverage and remaining hardware checks.
