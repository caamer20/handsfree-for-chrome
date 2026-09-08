# Chrome Web Store preparation

The ZIP is a candidate package, not a store submission or an approval claim. Complete the manual checks in VALIDATION.md on supported desktop platforms before uploading it.

## Suggested listing

**Name:** HandsFree for Chrome

**Summary:** Control tabs, bookmarks, windows, and search with your voice. Local command interpretation, optional on-device AI.

**Description:** Press your shortcut and say what you want to do: open a tab, find a page across windows, search Google/YouTube/GitHub, mute or pin tabs, manage bookmarks, zoom, or go back. HandsFree shows a compact status display and keeps a local activity log. Common commands use a fast local parser. Optional experimental SmolLM2 interpretation runs on your device and requires review before execution. Chrome speech recognition may use Google's servers and require internet. No account or API key is needed.

## Permission justifications

| Permission | Purpose |
| --- | --- |
| tabs | Read titles/URLs for fuzzy tab lookup and act on the requested tab. |
| bookmarks | Save pages and find/open bookmarks on command. |
| offscreen | Run speech recognition and local inference outside the service worker. |
| storage | Local preferences, bounded activity log, current request and pending review. |
| alarms | Worker-safe three-minute auto-sleep and a command watchdog. |
| activeTab, scripting | Inject the isolated floating status display after a user gesture. |

There is no `windows` permission: ordinary window operations do not require one. There is no `history` permission because back/forward uses `chrome.tabs`. There are no broad host permissions, content scraping, remotely hosted scripts, or analytics. Microphone consent is requested with `getUserMedia` in the setup page.

## Submission assets and declarations

- App icons: `public/icons/` in 16, 32, 48, and 128 pixels.
- AI-generated master and prompt: `assets/`.
- UI fixture screenshots: `docs/`; clearly distinguished from a recording of installed Chrome behavior.
- Publish PRIVACY.md at a stable HTTPS URL and enter that URL in the store listing.
- Review Chrome's current data-use disclosure form against the privacy policy, especially Chrome's speech service.
- Supply required store screenshot and promotional-image dimensions from an installed, tested release.
- Bundle Apache-2.0, runtime license notices, and the model provenance.
- Keep experimental AI described accurately. Do not claim fully offline transcription or general-purpose natural-language reliability.
