import type { ChromeAction } from './schema';
import type { ActiveRequest } from './types';
import type { ChoiceOverrides, TargetContext } from './conversation';

export type FailureKind = 'site-access' | 'restricted-page' | 'missing-target' | 'page-changed' | 'unknown-outcome';
export interface RecoveryView { id: string; kind: FailureKind; detail: string; origin?: string; canResume: boolean; canChooseTab: boolean; }
export interface RecoveryPlan {
  id: string; kind: FailureKind; detail: string; at: number;
  request: ActiveRequest; transcript: string; source: 'grammar' | 'model';
  actions: ChromeAction[]; context: TargetContext; overrides: ChoiceOverrides;
  origin?: string; targetUrl?: string; choiceKey?: string;
}
/** Only failures proven to occur before the page action can offer a resume. */
export class CommandFailure extends Error {
  remaining: ChromeAction[] = [];
  context?: TargetContext;
  constructor(public kind: FailureKind, message: string, public beforeEffects = false, public origin?: string, public targetUrl?: string, public choiceKey?: string) { super(message); this.name = 'CommandFailure'; }
}
