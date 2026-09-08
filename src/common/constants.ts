export const OFFSCREEN_PATH = 'src/offscreen/offscreen.html';
export const IDLE_ALARM = 'handsfree-idle';
export const WATCHDOG_ALARM = 'handsfree-command-timeout';
export const IDLE_MS = 3 * 60_000;
export const MAX_COMMAND_MS = 2 * 60_000;
export const MAX_LOG_ENTRIES = 30;
export const COMMAND_EXAMPLES = [
  { group: 'Search', text: 'Search Google for weekend hikes', hint: 'Google, YouTube, or GitHub' },
  { group: 'Tabs', text: 'Switch to tab containing GitHub', hint: 'Find a tab across every window' },
  { group: 'Tabs', text: 'Open a new tab', hint: 'A little room for your next idea' },
  { group: 'Tabs', text: 'Duplicate this tab', hint: 'Keep your place' },
  { group: 'Tabs', text: 'Close tabs to the right', hint: 'Review before closing several tabs' },
  { group: 'Tabs', text: 'Mute this tab', hint: 'Also unmute, pin, unpin, and reload' },
  { group: 'Windows', text: 'Maximize this window', hint: 'Minimize, fullscreen, or restore' },
  { group: 'Page', text: 'Zoom to 125 percent', hint: 'Zoom in, zoom out, or reset zoom' },
  { group: 'Bookmarks', text: 'Bookmark this page', hint: 'Save the current page' },
  { group: 'Bookmarks', text: 'Open bookmark recipes', hint: 'Find a saved page by name' },
  { group: 'Page', text: 'Go back', hint: 'Move back or forward in this tab' },
] as const;
