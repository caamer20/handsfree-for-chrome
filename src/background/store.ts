import type { RecoveryPlan } from '../common/recovery';
import type { VoiceSetup } from '../common/setup';
import { migrateSettings } from '../common/settings';
import type { ExecutionProgress } from '../common/progress';
import { type HudState, type Settings } from '../common/schema';
import type { ActiveRequest, CaptureSession, LogEntry, PendingPlan } from '../common/types';
import { MAX_LOG_ENTRIES } from '../common/constants';
import { emptyConversation, type Conversation, type Question } from '../common/conversation';
import { macrosSchema, upsertMacro, type Macro } from '../common/macros';

export interface SessionState { recovery: RecoveryPlan | null; voiceSetup: VoiceSetup | null; transcript: string | null; progress: ExecutionProgress | null; active: ActiveRequest | null; capture: CaptureSession | null; pending: PendingPlan | null; question: Question | null; conversation: Conversation; permissionTabId: number | null; hud: HudState; hudTabId: number | null; lastActivity: number; }
export const defaultSession: SessionState = { recovery: null, voiceSetup: null, transcript: null, progress: null, active: null, capture: null, pending: null, question: null, conversation: emptyConversation(), permissionTabId: null, hud: { phase: 'idle', text: 'Ready when you are' }, hudTabId: null, lastActivity: 0 };
export async function getSettings(): Promise<Settings> {
  const { settings } = await chrome.storage.local.get('settings');
  return migrateSettings(settings);
}
export async function getMacros(): Promise<Macro[]> {
  const { macros } = await chrome.storage.local.get('macros');
  // Do not silently replace invalid stored data with an empty collection.
  return macrosSchema.parse(macros ?? []);
}
export async function saveMacro(macro: Macro): Promise<void> {
  await chrome.storage.local.set({ macros: upsertMacro(await getMacros(), macro) });
}
export async function deleteMacro(id: string): Promise<void> {
  await chrome.storage.local.set({ macros: (await getMacros()).filter(macro => macro.id !== id) });
}
export async function getSession(): Promise<SessionState> {
  const { session } = await chrome.storage.session.get('session');
  return { ...defaultSession, conversation: emptyConversation(), ...(session as Partial<SessionState> | undefined) };
}
export async function setSession(patch: Partial<SessionState>): Promise<SessionState> {
  const session = { ...await getSession(), ...patch };
  await chrome.storage.session.set({ session });
  return session;
}
export async function getLog(): Promise<LogEntry[]> {
  const { log } = await chrome.storage.local.get('log');
  return Array.isArray(log) ? (log as LogEntry[]).slice(0, MAX_LOG_ENTRIES) : [];
}
export async function addLog(text: string, ok: boolean, transcript?: string): Promise<void> {
  const settings = await getSettings();
  const entry: LogEntry = { id: crypto.randomUUID(), at: Date.now(), text: text.slice(0, 500), ok, ...(settings.saveTranscripts && transcript ? { transcript: transcript.slice(0, 500) } : {}) };
  await chrome.storage.local.set({ log: [entry, ...await getLog()].slice(0, MAX_LOG_ENTRIES) });
}
