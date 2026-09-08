import { z } from 'zod';

const text = z.string().trim().min(1).max(500);
export function isSafeUrl(value: string): boolean {
  if (value === 'chrome://newtab/') return true;
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password; }
  catch { return false; }
}
const empty = z.object({}).strict();
export const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create_tab'), params: z.object({ url: z.string().max(4000).refine(isSafeUrl, 'Only HTTP(S) URLs or a new tab are allowed'), active: z.boolean().optional() }).strict() }).strict(),
  z.object({ action: z.literal('close_tab'), params: z.object({ target: z.enum(['current', 'all_others', 'left', 'right']).optional() }).strict() }).strict(),
  z.object({ action: z.literal('find_tab'), params: z.object({ query: text, auto_switch: z.boolean().optional() }).strict() }).strict(),
  z.object({ action: z.literal('duplicate_tab'), params: empty }).strict(),
  z.object({ action: z.literal('reload_tab'), params: z.object({ bypass_cache: z.boolean().optional() }).strict() }).strict(),
  z.object({ action: z.literal('mute_tab'), params: z.object({ mute: z.boolean().optional(), toggle: z.boolean().optional() }).strict() }).strict(),
  z.object({ action: z.literal('pin_tab'), params: z.object({ pin: z.boolean().optional(), toggle: z.boolean().optional() }).strict() }).strict(),
  z.object({ action: z.literal('window_state'), params: z.object({ state: z.enum(['maximized', 'minimized', 'fullscreen', 'normal']) }).strict() }).strict(),
  z.object({ action: z.literal('zoom'), params: z.object({ mode: z.enum(['in', 'out', 'reset', 'set']), factor: z.number().finite().min(0.25).max(5).optional() }).strict() }).strict(),
  z.object({ action: z.literal('bookmark_page'), params: z.object({ title: text.optional(), folder: text.optional() }).strict() }).strict(),
  z.object({ action: z.literal('open_bookmark'), params: z.object({ query: text.optional(), index: z.number().int().min(1).max(10000).optional() }).strict() }).strict(),
  z.object({ action: z.literal('navigate_history'), params: z.object({ direction: z.enum(['back', 'forward']) }).strict() }).strict(),
]);
export const actionsSchema = z.array(actionSchema).min(1).max(8).superRefine((actions, ctx) => {
  actions.forEach((item, index) => {
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
  saveTranscripts: z.boolean().default(false),
  micGranted: z.boolean().default(false),
}).strict();
export type Settings = z.infer<typeof settingsSchema>;
export const defaultSettings = settingsSchema.parse({});

export const hudSchema = z.object({
  phase: z.enum(['idle', 'listening', 'thinking', 'success', 'error', 'review']),
  text: z.string().max(500),
}).strict();
export type HudState = z.infer<typeof hudSchema>;

export const messageSchema = z.discriminatedUnion('type', [
  z.object({ target: z.literal('background'), type: z.literal('GET_STATE') }).strict(),
  z.object({ target: z.literal('background'), type: z.literal('TOGGLE_LISTENING') }).strict(),
  z.object({ target: z.literal('background'), type: z.literal('RUN_TEXT'), text: text }).strict(),
  z.object({ target: z.literal('background'), type: z.literal('SAVE_SETTINGS'), settings: settingsSchema }).strict(),
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
