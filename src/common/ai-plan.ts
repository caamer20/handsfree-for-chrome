import { actionsSchema, type ChromeAction } from './schema';
import { parseModelPlan } from '../offscreen/json-plan';

type Property = Record<string, unknown>;
const str: Property = { type: 'string' };
const bool: Property = { type: 'boolean' };
const enumeration = (...values: string[]): Property => ({ type: 'string', enum: values });
const optional = (value: Property): Property => ({ anyOf: [value, { type: 'null' }] });
function action(name: ChromeAction['action'], properties: Record<string, Property>): Property {
  return { type: 'object', additionalProperties: false, required: ['action', 'params'], properties: {
    action: { type: 'string', enum: [name] },
    params: { type: 'object', additionalProperties: false, required: Object.keys(properties), properties },
  } };
}
export const PLAN_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['actions'], properties: { actions: {
    type: 'array', minItems: 0, maxItems: 8, items: { anyOf: [
      action('browser_page', { page: enumeration('downloads', 'history', 'bookmarks', 'settings', 'extensions') }),
      action('organize_tabs', { operation: enumeration('ungroup', 'sort_title', 'sort_site') }),
      action('wait_for_page', {}), action('wait_for_field', { query: str }),
      action('create_tab', { url: str, active: optional(bool) }),
      action('close_tab', { target: optional(enumeration('current', 'all_others', 'left', 'right', 'all', 'matching')), query: optional(str) }),
      action('find_tab', { query: str, auto_switch: optional(bool) }),
      action('select_tab', { position: enumeration('next', 'previous', 'first', 'last', 'index'), index: optional({ type: 'integer', minimum: 1, maximum: 1000 }), offset: optional({ type: 'integer', minimum: 1, maximum: 1000 }), from_end: optional(bool), activate: optional(bool) }),
      action('move_tab', { position: enumeration('left', 'right', 'first', 'last', 'index'), index: optional({ type: 'integer', minimum: 1, maximum: 1000 }), steps: optional({ type: 'integer', minimum: 1, maximum: 1000 }) }),
      action('reopen_tab', {}), action('create_window', { with_current_tab: optional(bool) }),
      action('duplicate_tab', {}), action('reload_tab', { bypass_cache: optional(bool) }),
      action('mute_tab', { mute: optional(bool), toggle: optional(bool) }),
      action('pin_tab', { pin: optional(bool), toggle: optional(bool) }),
      action('window_state', { state: enumeration('maximized', 'minimized', 'fullscreen', 'normal') }),
      action('zoom', { mode: enumeration('in', 'out', 'reset', 'set'), factor: optional({ type: 'number', minimum: 0.25, maximum: 5 }) }),
      action('bookmark_page', { title: optional(str), folder: optional(str) }),
      action('open_bookmark', { query: optional(str), index: optional({ type: 'integer', minimum: 1 }) }),
      action('navigate_history', { direction: enumeration('back', 'forward') }),
      action('tab_set', { operation: enumeration('target', 'list'), filter: enumeration('all', 'pinned', 'unpinned', 'muted', 'unmuted', 'audible'), scope: optional(enumeration('window', 'all')), exclude_query: optional(str), indices: optional({ type: 'array', minItems: 1, maxItems: 50, items: { type: 'integer', minimum: 1, maximum: 1000 } }) }),
      action('open_site', { site: str, new_tab: optional(bool) }),
      action('search_site', { site: str, query: optional(str) }),
      action('site_alias', { name: str }), action('macro_add_site', { name: str }),
      action('reference_tabs', { reference: enumeration('it', 'them', 'these', 'other', 'previous'), activate: optional(bool), count: optional({ type: 'integer', minimum: 1, maximum: 50 }), query: optional(str) }),
      action('select_tabs', { queries: { type: 'array', items: str, minItems: 1, maxItems: 20 }, all_matches: optional(bool) }),
      action('move_beside', { query: str, side: optional(enumeration('before', 'after')) }),
      action('undo_action', { kind: optional(enumeration('move', 'pin', 'mute', 'zoom')) }),
      action('page_action', { operation: enumeration('scroll', 'find', 'find_next', 'find_previous', 'show_links', 'activate', 'hide_links', 'focus', 'type', 'fill', 'clear', 'select_all', 'delete_selection', 'next_field', 'previous_field', 'show_fields', 'select_option', 'check', 'uncheck', 'dictate_start', 'dictate_stop', 'media_play', 'media_pause', 'media_toggle', 'media_seek', 'media_volume', 'help'), direction: optional(enumeration('up', 'down', 'left', 'right', 'top', 'bottom')), amount: optional(enumeration('little', 'half', 'page', 'repeat')), query: optional(str), index: optional({ type: 'integer', minimum: 1, maximum: 200 }), text: optional(str), value: optional({ type: 'number', minimum: -86400, maximum: 86400 }), relative: optional(bool), new_tab: optional(bool), background: optional(bool) }),
      action('group_action', { operation: enumeration('create', 'add', 'collapse', 'expand', 'rename', 'move_window', 'color', 'ungroup'), name: str, new_name: optional(str), color: optional(enumeration('grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange')) }),
      action('workspace_action', { operation: enumeration('save', 'restore', 'list'), name: optional(str) }),
      action('reading_action', { operation: enumeration('save', 'list', 'open_unread', 'mark_read', 'mark_unread'), query: optional(str) }),
      action('audio_action', { operation: enumeration('list', 'focus', 'mute_others'), query: optional(str) }),
      action('duplicates_action', { operation: enumeration('show', 'close') }),
      action('help', { topic: optional(str) }),
    ] },
  } },
};
export const CLOUD_PROMPT = `Translate the user's browser command into a complete executable action plan using the provided schema. Return only JSON, never an explanation of what you would do. Do not execute code, browse, or add actions the user did not request. Use null for irrelevant optional parameters. Unsupported requests return {"actions":[]}.
Use only actions in the schema. Use open_site with the spoken site name or category (email, music, calendar, files, documents, assistant) to open familiar sites and nicknames; new_tab:true only when explicitly requesting another tab. Use search_site with the spoken site and exact query for website searches. Resolve personal data locally; you are not given the user’s saved sites or tabs. Use reference_tabs before mutations of it/them/these/other. For multiple named targets use select_tabs with queries copied from the user. Undo is undo_action; do not invent the previous state. Use wait_for_field with the exact field label only when asked to wait for an editable field to appear. Use wait_for_page only when asked to wait for loading. browser_page opens a Chrome management page. organize_tabs sorts ungrouped tabs after existing groups, or ungroups selected tabs. If a site search is missing words, set query:null so the user is asked. Page commands use page_action: scrolling/find/numbered links/focus/type/dictation/media; fill replaces field text, clear empties it, select_all and delete_selection edit selections, next_field/previous_field focus available fields, show_fields numbers form controls, select_option chooses an exact visible option label supplied as text, check/uncheck set native checkboxes. Copy literal field text into text; copy field labels into query. Copy text, labels, names, and queries exactly from the user. Page text entry never submits a form unless separately asked to click its submit button. Named group operations use group_action, workspaces use workspace_action, reading list uses reading_action, audible tabs use audio_action, duplicates use duplicates_action, contextual help uses help. Never infer tab counts or numeric page labels that were not spoken.
For search, create a single tab: Google https://www.google.com/search?q=QUERY, YouTube https://www.youtube.com/results?search_query=QUERY, GitHub https://github.com/search?q=QUERY. Percent-encode the user's search query exactly. Collapse 'open a new tab, open Google and search for X' to that one search action.
To close, mute, pin, reload, duplicate or move a NAMED tab, first emit find_tab with the user's name as query and auto_switch:false, then emit the requested action. Never act on the current tab when the user named a different tab. Name matching is resolved locally; do not invent tab IDs or use URLs instead of title queries. close_tab target:matching plus query closes all literal name matches IN THE CURRENT WINDOW; use only when the user explicitly asks for multiple tabs. close_tab target:all closes all tabs in that window. Other close targets must have query:null.
For tab numbers/next/previous/first/last use select_tab, with activate:false before a mutation and activate:true when switching. Index values are one-based and used only with position:index. move_tab supports left/right/first/last/index. reopen_tab restores one last-closed tab. create_window.with_current_tab:true moves the targeted tab to a new window; false opens a blank window.
For a blank new tab use chrome://newtab/. For switch/find tab use find_tab with the user's title keywords, not a guessed URL. For zoom 125 percent use factor 1.25. For filtered tab sets use tab_set with operation:target before a mutation, filter:all/pinned/unpinned/muted/unmuted/audible, scope:window unless explicitly across all windows. Optional exclude_query must be a name the user said. Numbered ranges or lists use indices in current-window order; validate all positions before changing tabs. operation:list offers a choice to switch. Relative select_tab uses offset; from_end:true counts an explicit index from the right. move_tab uses steps for left/right only. reference_tabs reference:previous and activate:true switches to the last referenced target. Interpret common paraphrases of supported actions; never act on a negated instruction. Preserve literal typed text and search words. Execute sequences in spoken order. Never invent tab names, bookmark names, search terms, or unrelated websites. Do not return a plan describing a next step; return the actual actions.`;

export function decodeCloudPlan(input: unknown): ChromeAction[] {
  let value: unknown = input;
  if (typeof value === 'string') {
    const raw = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    try { value = JSON.parse(raw) as unknown; } catch { return parseModelPlan(raw); }
  }
  if (typeof value === 'object' && value !== null && 'actions' in value) value = value.actions;
  if (Array.isArray(value)) {
    value = value.map((item: unknown) => {
      if (typeof item !== 'object' || item === null || !('params' in item) || typeof item.params !== 'object' || item.params === null || Array.isArray(item.params)) return item;
      return { ...item, params: Object.fromEntries(Object.entries(item.params).filter(([, v]) => v !== null)) };
    });
  }
  if (Array.isArray(value) && value.length === 0) throw new Error('The AI could not map that request to a supported browser command.');
  const result = actionsSchema.safeParse(value);
  if (!result.success) throw new Error('The AI returned an invalid action plan. Try a more specific command.');
  return result.data;
}
