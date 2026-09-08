import { defaultSettings, settingsSchema, type HudState, type Settings } from '../common/schema';
import type { ActiveRequest, LogEntry, PendingPlan } from '../common/types';
import { MAX_LOG_ENTRIES } from '../common/constants';

export interface SessionState { active: ActiveRequest | null; pending: PendingPlan | null; hud: HudState; lastActivity: number; }
export const defaultSession: SessionState = { active: null, pending: null, hud: { phase: 'idle', text: 'Ready when you are' }, lastActivity: 0 };
export async function getSettings(): Promise<Settings> {
  const { settings } = await chrome.storage.local.get('settings');
  const parsed = settingsSchema.safeParse(settings ?? {});
  return parsed.success ? parsed.data : defaultSettings;
}
export async function getSession(): Promise<SessionState> {
  const { session } = await chrome.storage.session.get('session');
  return { ...defaultSession, ...(session as Partial<SessionState> | undefined) };
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
