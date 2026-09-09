import { z } from 'zod';
import { isSafeUrl } from './urls';
import { routineSchema, routinesSchema } from './routine-schema';
import { macroSchema } from './macros';
import { expandedActionSchemas, pageParamsSchema } from './expanded-schema';
import { aliasSchema, siteCategorySchema } from './library';
import { providerSchema } from './providers';
export { isSafeUrl } from './urls';

const text = z.string().trim().min(1).max(500);
const empty = z.object({}).strict();
export const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create_tab'), params: z.object({ url: z.string().max(4000).refine(isSafeUrl, 'Only HTTP(S) URLs or a new tab are allowed'), active: z.boolean().optional() }).strict() }).strict(),
  z.object({ action: z.literal('close_tab'), params: z.object({ target: z.enum(['current', 'all_others', 'left', 'right', 'all', 'matching']).optional(), query: text.optional() }).strict() }).strict(),
  z.object({ action: z.literal('find_tab'), params: z.object({ query: text, auto_switch: z.boolean().optional() }).strict() }).strict(),
  z.object({ action: z.literal('select_tab'), params: z.object({ position: z.enum(['next', 'previous', 'first', 'last', 'index']), index: z.number().int().min(1).max(1000).optional(), offset: z.number().int().min(1).max(1000).optional(), from_end: z.boolean().optional(), activate: z.boolean().optional() }).strict() }).strict(),
  z.object({ action: z.literal('move_tab'), params: z.object({ position: z.enum(['left', 'right', 'first', 'last', 'index']), index: z.number().int().min(1).max(1000).optional(), steps: z.number().int().min(1).max(1000).optional() }).strict() }).strict(),
  z.object({ action: z.literal('reopen_tab'), params: empty }).strict(),
  z.object({ action: z.literal('create_window'), params: z.object({ with_current_tab: z.boolean().optional() }).strict() }).strict(),
  z.object({ action: z.literal('duplicate_tab'), params: empty }).strict(),
  z.object({ action: z.literal('reload_tab'), params: z.object({ bypass_cache: z.boolean().optional() }).strict() }).strict(),
  z.object({ action: z.literal('mute_tab'), params: z.object({ mute: z.boolean().optional(), toggle: z.boolean().optional() }).strict() }).strict(),
  z.object({ action: z.literal('pin_tab'), params: z.object({ pin: z.boolean().optional(), toggle: z.boolean().optional() }).strict() }).strict(),
  z.object({ action: z.literal('window_state'), params: z.object({ state: z.enum(['maximized', 'minimized', 'fullscreen', 'normal']) }).strict() }).strict(),
  z.object({ action: z.literal('zoom'), params: z.object({ mode: z.enum(['in', 'out', 'reset', 'set']), factor: z.number().finite().min(0.25).max(5).optional() }).strict() }).strict(),
  z.object({ action: z.literal('bookmark_page'), params: z.object({ title: text.optional(), folder: text.optional() }).strict() }).strict(),
  z.object({ action: z.literal('open_bookmark'), params: z.object({ query: text.optional(), index: z.number().int().min(1).max(10000).optional() }).strict() }).strict(),
  z.object({ action: z.literal('navigate_history'), params: z.object({ direction: z.enum(['back', 'forward']) }).strict() }).strict(),
  ...expandedActionSchemas,
]);
export const actionsSchema = z.array(actionSchema).min(1).max(8).superRefine((actions, ctx) => {
  actions.forEach((item, index) => {
    if (item.action === 'tab_set' && item.params.indices && (item.params.scope === 'all' || item.params.filter !== 'all' || item.params.exclude_query)) ctx.addIssue({ code: 'custom', message: 'Numbered sets use positions in the current window without filters', path: [index, 'params'] });
    if (item.action === 'page_action') {
      const p = item.params;
      const require = (condition: boolean, message: string): void => { if (!condition) ctx.addIssue({ code: 'custom', message, path: [index, 'params'] }); };
      if (p.operation === 'field_ready') require(false, 'Field readiness is used internally by wait_for_field');
      if (p.operation === 'find') require(!!p.query, 'Find needs search text');
      if (p.operation === 'activate') require(!!p.query || p.index !== undefined, 'Click needs a label or number');
      if (p.operation === 'type' || p.operation === 'fill' || p.operation === 'select_option') require(p.text !== undefined, 'Typing needs text');
      if (p.operation === 'media_seek' || p.operation === 'media_volume') require(p.value !== undefined, 'Media adjustment needs a value');
      if (p.operation === 'media_volume' && p.value !== undefined) require(p.value >= (p.relative ? -100 : 0) && p.value <= 100, 'Volume must be between 0 and 100 percent');
    }
    if (item.action === 'group_action' && item.params.operation === 'color' && !item.params.color) ctx.addIssue({ code: 'custom', message: 'Choose a group color', path: [index, 'params'] });
    if (item.action === 'group_action' && item.params.operation === 'rename' && !item.params.new_name) ctx.addIssue({ code: 'custom', message: 'Choose a new group name', path: [index, 'params'] });
    if (item.action === 'select_tab' || item.action === 'move_tab') {
      if (item.params.position === 'index' && item.params.index === undefined) ctx.addIssue({ code: 'custom', message: 'A tab number is required', path: [index, 'params', 'index'] });
      if (item.params.position !== 'index' && item.params.index !== undefined) ctx.addIssue({ code: 'custom', message: 'Choose a relative position or a tab number', path: [index, 'params'] });
    }
    if (item.action === 'select_tab' && ((item.params.offset !== undefined && !['next', 'previous'].includes(item.params.position)) || (item.params.from_end && item.params.position !== 'index'))) ctx.addIssue({ code: 'custom', message: 'Offsets require next/previous; counting from the end requires an index', path: [index, 'params'] });
    if (item.action === 'move_tab' && item.params.steps !== undefined && !['left', 'right'].includes(item.params.position)) ctx.addIssue({ code: 'custom', message: 'Movement steps require left or right', path: [index, 'params'] });
    if (item.action === 'close_tab' && ((item.params.target === 'matching') !== (item.params.query !== undefined))) ctx.addIssue({ code: 'custom', message: 'A name is required only when closing matching tabs', path: [index, 'params'] });
    if (item.action === 'zoom' && item.params.mode === 'set' && item.params.factor === undefined) ctx.addIssue({ code: 'custom', message: 'Set zoom requires a factor', path: [index, 'params', 'factor'] });
    if (item.action === 'mute_tab' && item.params.toggle && item.params.mute !== undefined) ctx.addIssue({ code: 'custom', message: 'Choose mute or toggle', path: [index] });
    if (item.action === 'pin_tab' && item.params.toggle && item.params.pin !== undefined) ctx.addIssue({ code: 'custom', message: 'Choose pin or toggle', path: [index] });
  });
});
export type ChromeAction = z.infer<typeof actionSchema>;

export const settingsSchema = z.object({
  mode: z.enum(['power-saver', 'standby']).default('power-saver'),
  triggerPhrase: z.string().trim().max(40).default(''),
  language: z.enum(['en-US', 'en-GB', 'en-AU', 'en-CA']).default('en-US'),
  aiEnabled: z.boolean().default(false),
  aiProvider: providerSchema.default('local'),
  aiModel: z.string().trim().max(150).default(''),
  aiBaseUrl: z.string().trim().max(1000).default(''),
  reviewAiActions: z.boolean().default(false),
  listeningMode: z.enum(['continuous', 'single']).default('continuous'),
  reuseTabs: z.boolean().default(true),
  learnTopSites: z.boolean().default(false),
  feedback: z.enum(['none', 'sound', 'speech']).default('none'),
  siteDefaults: z.record(siteCategorySchema, z.string().max(100)).default({}),
  saveTranscripts: z.boolean().default(false),
  micGranted: z.boolean().default(false),
  setupCommandPassed: z.boolean().default(false),
}).strict();
export type Settings = z.infer<typeof settingsSchema>;
export const defaultSettings = settingsSchema.parse({});

export const hudSchema = z.object({
  phase: z.enum(['idle', 'listening', 'thinking', 'success', 'error', 'review', 'clarify']),
  text: z.string().max(500),
}).strict();
export type HudState = z.infer<typeof hudSchema>;

export const messageSchema = z.discriminatedUnion('type', [
  z.object({ target: z.literal('background'), type: z.literal('MICROPHONE_READY') }).strict(),
  z.object({ target: z.literal('background'), type: z.literal('GET_DIAGNOSTICS') }).strict(),
  z.object({ target: z.literal('background'), type: z.literal('RUN_SETUP_COMMAND') }).strict(),
  z.object({ target: z.literal('background'), type: z.literal('IMPORT_ROUTINES'), routines: routinesSchema }).strict(),
  z.object({ target: z.literal('background'), type: z.literal('SAVE_ROUTINE'), routine: routineSchema }).strict(),
  z.object({ target: z.literal('background'), type: z.literal('DELETE_ROUTINE'), id: z.string().uuid() }).strict(),
  z.object({ target: z.literal('background'), type: z.literal('RUN_ROUTINE'), id: z.string().uuid() }).strict(),
  z.object({ target: z.literal('background'), type: z.literal('SAVE_ALIAS'), alias: aliasSchema }).strict(),
  z.object({ target: z.literal('background'), type: z.literal('DELETE_ALIAS'), id: z.string().uuid() }).strict(),
  z.object({ target: z.literal('background'), type: z.literal('DELETE_WORKSPACE'), id: z.string().uuid() }).strict(),
  z.object({ target: z.literal('background'), type: z.literal('RESTORE_WORKSPACE'), id: z.string().uuid() }).strict(),
  z.object({ target: z.literal('background'), type: z.literal('REFRESH_SITE_SUGGESTIONS') }).strict(),
  z.object({ target: z.literal('background'), type: z.literal('ANSWER_CLARIFICATION'), questionId: z.string().uuid(), answer: text }).strict(),
  z.object({ target: z.literal('background'), type: z.literal('INTERRUPT_COMMAND'), sessionId: z.string().uuid().optional(), replacement: text.optional(), stopListening: z.boolean().default(false) }).strict(),
  z.object({ target: z.literal('background'), type: z.literal('DICTATION_TEXT'), sessionId: z.string().uuid(), text: z.string().min(1).max(2000) }).strict(),
  z.object({ target: z.literal('background'), type: z.literal('GET_READING_LIST') }).strict(),
  z.object({ target: z.literal('background'), type: z.literal('UPDATE_READING_ITEM'), url: z.string().max(4000).refine(isSafeUrl), operation: z.enum(['open', 'read', 'unread', 'remove']) }).strict(),
  z.object({ target: z.literal('offscreen'), type: z.literal('FEEDBACK'), text: z.string().max(500), mode: z.enum(['sound', 'speech']) }).strict(),
  z.object({ target: z.literal('offscreen'), type: z.literal('DICTATION_MODE'), enabled: z.boolean() }).strict(),
  z.object({ target: z.literal('content'), type: z.literal('PAGE_COMMAND'), command: pageParamsSchema, token: z.string().optional() }).strict(),
  z.object({ target: z.literal('content'), type: z.literal('PAGE_CANCEL') }).strict(),
  z.object({ target: z.literal('content'), type: z.literal('PAGE_PROBE') }).strict(),
  z.object({ target: z.literal('content'), type: z.literal('PAGE_DICTATE'), text: z.string().min(1).max(2000), token: z.string() }).strict(),
  z.object({ target: z.literal('background'), type: z.literal('GET_STATE') }).strict(),
  z.object({ target: z.literal('background'), type: z.literal('TOGGLE_LISTENING') }).strict(),
  z.object({ target: z.literal('background'), type: z.literal('RUN_TEXT'), text: text }).strict(),
  z.object({ target: z.literal('background'), type: z.literal('SAVE_SETTINGS'), settings: settingsSchema, apiKey: z.string().trim().min(1).max(4096).optional() }).strict(),
  z.object({ target: z.literal('background'), type: z.literal('REMOVE_API_KEY') }).strict(),
  z.object({ target: z.literal('background'), type: z.literal('TEST_AI_CONNECTION') }).strict(),
  z.object({ target: z.literal('background'), type: z.literal('PARSE_CLOUD'), requestId: z.string().uuid(), text }).strict(),
  z.object({ target: z.literal('background'), type: z.literal('BEGIN_VOICE_COMMAND'), sessionId: z.string().uuid(), text }).strict(),
  z.object({ target: z.literal('background'), type: z.literal('CAPTURE_HEARTBEAT'), sessionId: z.string().uuid() }).strict(),
  z.object({ target: z.literal('background'), type: z.literal('CAPTURE_STATUS'), sessionId: z.string().uuid(), text, fatal: z.boolean().default(false) }).strict(),
  z.object({ target: z.literal('background'), type: z.literal('SAVE_MACRO'), macro: macroSchema }).strict(),
  z.object({ target: z.literal('background'), type: z.literal('DELETE_MACRO'), id: z.string().uuid() }).strict(),
  z.object({ target: z.literal('background'), type: z.literal('RUN_MACRO'), id: z.string().uuid() }).strict(),
  z.object({ target: z.literal('background'), type: z.literal('OPEN_PAGE'), page: z.enum(['onboarding', 'settings', 'shortcuts']) }).strict(),
  z.object({ target: z.literal('background'), type: z.literal('CLEAR_LOG') }).strict(),
  z.object({ target: z.literal('background'), type: z.literal('REVIEW_PLAN'), requestId: z.string().uuid(), approved: z.boolean() }).strict(),
  z.object({ target: z.literal('background'), type: z.literal('SLEEP_ENGINE') }).strict(),
  z.object({ target: z.literal('offscreen'), type: z.literal('START_LISTENING'), requestId: z.string().uuid(), settings: settingsSchema }).strict(),
  z.object({ target: z.literal('offscreen'), type: z.literal('PARSE_TEXT'), requestId: z.string().uuid(), text, settings: settingsSchema }).strict(),
  z.object({ target: z.literal('offscreen'), type: z.literal('DISPOSE_ENGINE') }).strict(),
  z.object({ target: z.literal('offscreen'), type: z.literal('PING') }).strict(),
  z.object({ target: z.literal('background'), type: z.literal('VOICE_TRANSCRIPT'), requestId: z.string().uuid(), text: z.string().max(500), final: z.boolean() }).strict(),
  z.object({ target: z.literal('background'), type: z.literal('EXECUTE_ACTIONS'), requestId: z.string().uuid(), actions: actionsSchema, source: z.enum(['grammar', 'model']), transcript: text }).strict(),
  z.object({ target: z.literal('background'), type: z.literal('ENGINE_ERROR'), requestId: z.string().uuid(), error: text }).strict(),
  z.object({ target: z.literal('background'), type: z.literal('ENGINE_STATUS'), requestId: z.string().uuid(), text }).strict(),
  z.object({ target: z.literal('content'), type: z.literal('HUD_STATE'), state: hudSchema }).strict(),
]);
export type Message = z.infer<typeof messageSchema>;
