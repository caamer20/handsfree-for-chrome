import { z } from 'zod';
const text = z.string().trim().min(1).max(500);
export const pageOperationSchema = z.enum(['scroll', 'find', 'find_next', 'find_previous', 'show_links', 'activate', 'hide_links', 'focus', 'type', 'fill', 'clear', 'select_all', 'delete_selection', 'next_field', 'previous_field', 'show_fields', 'select_option', 'check', 'uncheck', 'dictate_start', 'dictate_stop', 'media_play', 'media_pause', 'media_toggle', 'media_seek', 'media_volume', 'field_ready', 'help']);
export const pageParamsSchema = z.object({ operation: pageOperationSchema, direction: z.enum(['up', 'down', 'left', 'right', 'top', 'bottom']).optional(), amount: z.enum(['little', 'half', 'page', 'repeat']).optional(), query: text.optional(), index: z.number().int().min(1).max(200).optional(), text: z.string().max(2000).optional(), value: z.number().finite().min(-86400).max(86400).optional(), relative: z.boolean().optional(), new_tab: z.boolean().optional(), background: z.boolean().optional() }).strict();
export type PageParams = z.infer<typeof pageParamsSchema>;
export const expandedActionSchemas = [
  z.object({ action: z.literal('wait_for_field'), params: z.object({ query: text }).strict() }).strict(),
  z.object({ action: z.literal('browser_page'), params: z.object({ page: z.enum(['downloads', 'history', 'bookmarks', 'settings', 'extensions']) }).strict() }).strict(),
  z.object({ action: z.literal('organize_tabs'), params: z.object({ operation: z.enum(['ungroup', 'sort_title', 'sort_site']) }).strict() }).strict(),
  z.object({ action: z.literal('wait_for_page'), params: z.object({}).strict() }).strict(),
  z.object({ action: z.literal('tab_set'), params: z.object({ operation: z.enum(['target', 'list']), filter: z.enum(['all', 'pinned', 'unpinned', 'muted', 'unmuted', 'audible']), scope: z.enum(['window', 'all']).optional(), exclude_query: text.optional(), indices: z.array(z.number().int().min(1).max(1000)).min(1).max(50).optional() }).strict() }).strict(),
  z.object({ action: z.literal('open_site'), params: z.object({ site: text, new_tab: z.boolean().optional() }).strict() }).strict(),
  z.object({ action: z.literal('search_site'), params: z.object({ site: text, query: text.optional() }).strict() }).strict(),
  z.object({ action: z.literal('site_alias'), params: z.object({ name: text }).strict() }).strict(),
  z.object({ action: z.literal('macro_add_site'), params: z.object({ name: text }).strict() }).strict(),
  z.object({ action: z.literal('reference_tabs'), params: z.object({ reference: z.enum(['it', 'them', 'these', 'other', 'previous']), activate: z.boolean().optional(), count: z.number().int().min(1).max(50).optional(), query: text.optional() }).strict() }).strict(),
  z.object({ action: z.literal('select_tabs'), params: z.object({ queries: z.array(text).min(1).max(20), all_matches: z.boolean().optional() }).strict() }).strict(),
  z.object({ action: z.literal('move_beside'), params: z.object({ query: text, side: z.enum(['before', 'after']).optional() }).strict() }).strict(),
  z.object({ action: z.literal('undo_action'), params: z.object({ kind: z.enum(['move', 'pin', 'mute', 'zoom']).optional() }).strict() }).strict(),
  z.object({ action: z.literal('page_action'), params: pageParamsSchema }).strict(),
  z.object({ action: z.literal('group_action'), params: z.object({ operation: z.enum(['create', 'add', 'collapse', 'expand', 'rename', 'move_window', 'color', 'ungroup']), name: text, new_name: text.optional(), color: z.enum(['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange']).optional() }).strict() }).strict(),
  z.object({ action: z.literal('workspace_action'), params: z.object({ operation: z.enum(['save', 'restore', 'list']), name: text.optional() }).strict() }).strict(),
  z.object({ action: z.literal('reading_action'), params: z.object({ operation: z.enum(['save', 'list', 'open_unread', 'mark_read', 'mark_unread']), query: text.optional() }).strict() }).strict(),
  z.object({ action: z.literal('audio_action'), params: z.object({ operation: z.enum(['list', 'focus', 'mute_others']), query: text.optional() }).strict() }).strict(),
  z.object({ action: z.literal('duplicates_action'), params: z.object({ operation: z.enum(['show', 'close']) }).strict() }).strict(),
  z.object({ action: z.literal('help'), params: z.object({ topic: text.optional() }).strict() }).strict(),
] as const;
