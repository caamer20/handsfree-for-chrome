import type { Choice, Question } from '../common/conversation';
import { normalizeName } from '../common/library';
import { spokenNumber } from '../common/tab-target';

export function answerChoice(question: Question, answer: string): Choice | undefined {
  if (question.kind === 'text') { const value = answer.trim().slice(0, 500); return value ? { id: 'text', label: value, value } : undefined; }
  if (question.kind === 'name') {
    const value = answer.trim().replace(/^(?:call it|name it|save it as)\s+/i, '').slice(0, 60);
    return value ? { id: 'name', label: value, value } : undefined;
  }
  // UI answers carry an exact choice ID. Spoken ordinal answers use visible order.
  if (answer.startsWith('choice:')) return question.choices.find(choice => choice.id === answer.slice(7));
  let query = normalizeName(answer).replace(/^(?:no |actually )?/, '');
  for (let i = 0; i < 3; i++) query = query.replace(/^(?:pick|choose|use|select|i mean|i meant|the one with|the one called|the one named|the|option|number) /, '').replace(/ (?:one|option|please)$/, '');
  if (query === 'last') return question.choices.at(-1);
  const index = spokenNumber(query);
  if (index !== undefined) return question.choices[index - 1];
  const exact = question.choices.filter(choice => normalizeName(choice.label) === query || choice.value === answer);
  if (exact.length === 1) return exact[0];
  const words = query.replace(/^other /, '').split(' ').filter(word => !['account', 'tab'].includes(word));
  if (!words.length) return undefined;
  const matches = question.choices.filter(choice => words.every(word => normalizeName(`${choice.label} ${choice.detail ?? ''}`).split(' ').includes(word)));
  return matches.length === 1 ? matches[0] : undefined;
}
