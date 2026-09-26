import { describeAction } from './action-labels';
import { stripRequestFraming } from './language';
import type { Question } from './conversation';
import type { PendingPlan } from './types';
import type { WorkspaceNames } from './workspace-presentation';

export type ReadbackDirection = 'repeat' | 'next' | 'previous';
export interface DecisionReadback { page: number; totalPages: number; segments: string[]; text: string; }
/** Exact controls only; callers must leave freeform question answers as data. */
export function readbackIntent(text: string): ReadbackDirection | undefined {
  const command = stripRequestFraming(text);
  if (/^(?:repeat (?:the )?question|read (?:the )?(?:choices|options|command)|repeat (?:the )?(?:choices|options|command))$/i.test(command)) return 'repeat';
  if (/^(?:next|read (?:the )?next) (?:choices|options|items)$/i.test(command)) return 'next';
  if (/^(?:previous|read (?:the )?previous) (?:choices|options|items)$/i.test(command)) return 'previous';
  return undefined;
}
/** Keep every character, splitting long labels/URLs across bounded spoken pages. */
function chunks(text: string): string[] {
  const result: string[] = [];
  const label = text.match(/^(?:Option|Target|Website|Step) \d+\./)?.[0];
  for (let offset = 0; offset < text.length;) {
    let end = Math.min(text.length, offset + 300);
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]!) && /[\uDC00-\uDFFF]/.test(text[end]!)) end--;
    result.push(`${offset && label ? `${label} Continued. ` : ''}${text.slice(offset, end)}`);
    offset = end;
  }
  return result;
}
export function decisionReadback(question: Question | null, pending: PendingPlan | null, requestedPage = 0, workspaces: WorkspaceNames = []): DecisionReadback {
  if (!question && !pending) throw new Error('There is no question or command waiting to be read.');
  const rows = question ? [question.prompt, ...question.choices.map((choice, index) => `Option ${index + 1}. ${choice.label}${choice.detail ? `. ${choice.detail}` : ''}`)] : [
    'Review only. Nothing runs until you confirm.',
    ...(pending!.operation === 'close' ? [`Close ${pending!.targets?.length ?? 0} reviewed tabs.`] : pending!.operation === 'open_reading' ? [`Open ${pending!.urls?.length ?? 0} reviewed articles in new tabs.`] : []),
    ...(pending!.targets ?? []).map((target, index) => `Target ${index + 1}. ${target.title}. ${target.url}`),
    ...(pending!.urls ?? []).map((url, index) => `Website ${index + 1}. ${url}`),
    ...pending!.actions.map((action, index) => `Step ${index + 1}. ${describeAction(action, workspaces)}`),
  ];
  const all = rows.flatMap(chunks);
  const totalPages = Math.max(1, Math.ceil(all.length / 2));
  const page = Math.max(0, Math.min(totalPages - 1, Math.trunc(requestedPage) || 0));
  const hint = page + 1 < totalPages ? 'Say next choices to hear more.' : question ? question.choices.length ? 'Answer with the option number or label.' : 'Provide your answer when ready.' : 'Say confirm command to run, or cancel command.';
  const segments = [`${question ? 'Question' : 'Command review'}. Page ${page + 1} of ${totalPages}.`, ...all.slice(page * 2, page * 2 + 2), hint];
  return { page, totalPages, segments, text: segments.join('\n') };
}
