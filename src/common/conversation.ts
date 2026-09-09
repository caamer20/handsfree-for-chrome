import type { Routine } from './routine-schema';
import type { ChromeAction } from './schema';
import type { ActiveRequest } from './types';

export interface TabRef { id: number; windowId: number; title: string; url: string; }
export interface TargetContext { tabId: number; windowId: number; tabIds?: number[]; }
export interface PageRef { tabId: number; frameId: number; documentId?: string; token?: string; at: number; }
export interface Choice { id: string; label: string; detail?: string; tabs?: TabRef[]; value?: string; }
export type ChoiceKind = 'tabs' | 'site' | 'group' | 'workspace' | 'macro' | 'name' | 'text' | 'page' | 'reading';
export interface ChoiceOverrides { [key: string]: Choice; }
export interface Question { routineInput?: { routine: Routine; values: Record<string, string>; name: string }; id: string; prompt: string; choices: Choice[]; kind: ChoiceKind; key: string; request: ActiveRequest; actions: ChromeAction[]; context: TargetContext; overrides: ChoiceOverrides; at: number; }
export interface UndoValues { muted?: boolean; pinned?: boolean; index?: number; windowId?: number; zoom?: number; }
export interface UndoPatch { kind?: 'move' | 'pin' | 'mute' | 'zoom'; tabId: number; before: UndoValues; after: UndoValues; }
export interface UndoRecord { id: string; label: string; kinds: ('move' | 'pin' | 'mute' | 'zoom')[]; patches: UndoPatch[]; at: number; }
export interface Conversation {
  targets: TabRef[]; previousTargets: TabRef[]; candidates: TabRef[]; at: number;
  undo: UndoRecord[]; lastUndoId: string | null;
  page: PageRef | null; dictation: PageRef | null;
}
export const emptyConversation = (): Conversation => ({ targets: [], previousTargets: [], candidates: [], at: 0, undo: [], lastUndoId: null, page: null, dictation: null });
export class ChoiceRequired extends Error {
  remaining: ChromeAction[] = [];
  context: TargetContext | undefined;
  constructor(public prompt: string, public choices: Choice[], public kind: ChoiceKind, public key: string) { super(prompt); this.name = 'ChoiceRequired'; }
}
export class ReviewRequired extends Error {
  remaining: ChromeAction[] = [];
  context: TargetContext | undefined;
  constructor(public prompt: string, public targets: TabRef[], public operation: 'close' | 'open_reading', public urls: string[] = []) { super(prompt); this.name = 'ReviewRequired'; }
}
export function checkCancelled(signal?: AbortSignal): void { if (signal?.aborted) throw new Error('Command cancelled.'); }
export const tabRef = (tab: chrome.tabs.Tab): TabRef => ({ id: tab.id ?? -1, windowId: tab.windowId, title: (tab.title ?? 'Untitled tab').slice(0, 300), url: tab.url ?? tab.pendingUrl ?? '' });
