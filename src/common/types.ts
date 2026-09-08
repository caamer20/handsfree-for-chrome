import type { ChromeAction, HudState, Settings } from './schema';
export interface LogEntry { id: string; at: number; text: string; ok: boolean; transcript?: string; }
export interface ActiveRequest { id: string; tabId: number; windowId: number; startedAt: number; }
export interface PendingPlan { request: ActiveRequest; actions: ChromeAction[]; transcript: string; }
export interface AppState { settings: Settings; hud: HudState; log: LogEntry[]; pending: PendingPlan | null; shortcut: string; engineOpen: boolean; }
export type Reply = { ok: true; state?: AppState } | { ok: false; error: string };
