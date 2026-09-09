import type { DiagnosticCheck } from './diagnostics';
import type { ExecutionProgress } from './progress';
import type { ChromeAction, HudState, Settings } from './schema';
import type { Conversation, Question, PageRef, TabRef, TargetContext, ChoiceOverrides } from './conversation';
import type { Library } from './library';
import type { Routine } from './routine-schema';
import type { Macro } from './macros';
export interface LogEntry { id: string; at: number; text: string; ok: boolean; transcript?: string; }
export interface ActiveRequest { id: string; tabId: number; windowId: number; startedAt: number; }
export interface CaptureSession { id: string; startedAt: number; lastSeen: number; }
export interface PendingPlan { request: ActiveRequest; actions: ChromeAction[]; transcript: string; targets?: TabRef[]; operation?: 'close' | 'open_reading'; urls?: string[]; context?: TargetContext; overrides?: ChoiceOverrides; routine?: boolean; }
export interface AppState { settings: Settings; macros: Macro[]; routines?: Routine[]; progress?: ExecutionProgress | null; hud: HudState; log: LogEntry[]; pending: PendingPlan | null; shortcut: string; engineOpen: boolean; listening: boolean; hasApiKey: boolean; library?: Library; question?: Question | null; dictation?: PageRef | null; contextTargets?: TabRef[]; activeSiteOrigin?: string; }
export type Reply = { ok: true; state?: AppState; handled?: boolean; request?: ActiveRequest; pendingReview?: boolean; needsClarification?: boolean; dictating?: boolean; readingList?: chrome.readingList.ReadingListEntry[]; diagnostics?: DiagnosticCheck[]; message?: string } | { ok: false; error: string };

export type { Conversation, Question };
