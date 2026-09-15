# Chrome Web Store preparation

The ZIP is a candidate package, not a store submission or an approval claim. Complete the manual checks in VALIDATION.md on supported desktop platforms before uploading it.

## Suggested listing

**Name:** HandsFree for Chrome

**Summary:** Control tabs, bookmarks, windows, and search with your voice. Site nicknames, workspaces, page tools, dictation, and optional AI.

**Description:** Press your shortcut and say what you want to do: close a tab by name, switch by tab number, move tabs, reopen the last closed tab, open a tab, find a page across windows, search Google/YouTube/GitHub, mute or pin tabs, manage bookmarks, zoom, or go back. HandsFree shows a compact status display and keeps a local activity log. Common commands use a fast local parser. Optional experimental SmolLM2 interpretation runs on your device. You can instead configure OpenAI, Claude, Gemini, or a compatible HTTPS API using your own key. Validated AI commands execute automatically; AI tab closures and multi-tab closing require confirmation. An optional setting reviews all AI commands. Chrome speech recognition may use Google's servers and require internet. No HandsFree account is needed. Cloud AI requires a provider key and may incur provider charges. The shortcut toggles continuous listening on and off.

## Permission justifications

| Permission | Purpose |
| --- | --- |
| tabs | Read titles/URLs for fuzzy tab lookup and act on the requested tab. |
| bookmarks | Save pages and find/open bookmarks on command. |
| sessions | Read recently closed local entries only when asked, to restore one closed tab. No synced-device session access. |
| offscreen | Run speech recognition and local inference outside the service worker. |
| sidePanel | Show user-opened persistent controls, current transcript, target, progress, clarification, and Stop beside browser tabs. |
| storage | Local preferences, macros, aliases, workspace URLs/titles/groups, bounded activity log, session conversation and undo, and pending reviews. |
| alarms | Worker-safe three-minute auto-sleep, microphone heartbeat, and a command watchdog. |
| Optional HTTP(S) host access | API provider origins when configured; website origins for user-requested page controls. Settings offers per-site access or explicit all-website access. |
| tabGroups | Create, update, and move named tab groups on command; preserve named groups in saved workspaces. |
| readingList | Save, list, open, mark, and remove Chrome reading-list entries at the user’s request. |
| Optional topSites | Opt-in local site suggestions, restricted to origins; no automatic nickname adoption or full history read. |
| activeTab, scripting | Inject the status display and page controller under activeTab or granted host access. Page labels/fields/media are used locally for requested controls. |

There is no `windows` permission: ordinary window operations do not require one. There is no `history` permission because back/forward uses `chrome.tabs`. There are no required broad host grants, remotely hosted scripts, or analytics. Optional host access is explicitly requested; page controls inspect relevant visible DOM locally. Microphone consent is requested with `getUserMedia` in the setup page.

## Submission assets and declarations

- App icons: `public/icons/` in 16, 32, 48, and 128 pixels.
- AI-generated master and prompt: `assets/`.
- UI fixture screenshots: `docs/`; clearly distinguished from a recording of installed Chrome behavior.
- Publish PRIVACY.md at a stable HTTPS URL and enter that URL in the store listing.
- Review Chrome's current data-use disclosure form against the privacy policy, especially Chrome's speech service.
- Supply required store screenshot and promotional-image dimensions from an installed, tested release.
- Bundle Apache-2.0 and dependency notices; include runtime notices and model provenance in the optional local-AI edition.
- Keep experimental AI described accurately. Do not claim fully offline transcription or general-purpose natural-language reliability.
