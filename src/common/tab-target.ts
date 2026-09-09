import type { ChromeAction } from './schema';

import { spokenQuantity } from './language';
export function spokenNumber(value: string): number | undefined {
  const n = spokenQuantity(value);
  return n !== undefined && Number.isInteger(n) && n >= 1 && n <= 1000 ? n : undefined;
}
/** Resolve explicit tab language into a selector; mutation callers keep the target in the background. */
export function tabSelector(input: string, activate: boolean, allowBareName = false): ChromeAction[] | null {
  const reference = referenceSelector(input); if (reference) return activate ? reference.map(action => action.action === 'reference_tabs' ? { ...action, params: { ...action.params, activate: true } } : action) : reference;
  const raw = input.trim().replace(/^(?:the|my|a)\s+/i, '');
  const c = raw.toLowerCase();
  if (/^(?:(?:this|current|active)\s+)?(?:tab|page)$/.test(c) || /^this$/.test(c)) return [];
  let m = c.match(/^(?:(next|previous|prior|first|last|left|right)\s+tab|tab\s+(?:to the |on the )?(left|right))$/);
  const direction = m?.[1] ?? m?.[2];
  if (direction) return [{ action: 'select_tab', params: { position: direction === 'prior' || direction === 'left' ? 'previous' : direction === 'right' ? 'next' : direction as 'next' | 'previous' | 'first' | 'last', activate } }];
  m = c.match(/^tab(?:\s+number)?\s+(.+)$/) ?? c.match(/^(.+)\s+tab$/);
  const index = m?.[1] ? spokenNumber(m[1]) : undefined;
  if (index !== undefined) return [{ action: 'select_tab', params: { position: 'index', index, activate } }];
  // Numeric-looking invalid positions must not become tab-title searches.
  if (/^(?:tab(?: number)?\s+)?(?:[+-]?\d+(?:\.\d+)?(?:st|nd|rd|th)?|zero|(?:minus|negative) \S+)(?:\s+tab)?$/.test(c)) return null;
  const named = raw.match(/^(?:tab|page)\s+(?:named|called|containing|with|about|for)\s+(.+)$/i)
    ?? raw.match(/^(.+?)\s+(?:tab|page)$/i)
    ?? raw.match(/^(?:tab|page)\s+(.+)$/i);
  let query = named?.[1] ?? (allowBareName ? raw : '');
  const quoted = /^["“'](.+)["”']$/.test(query.trim());
  query = query.trim().replace(/^["“'](.+)["”']$/, '$1').trim();
  if (!query || (!quoted && ((!named && /^(?:all|other|others|some|these|those|every|any|things)\b/i.test(query)) || /^(?:this|current|active|next|previous|left|right|first|last|it|that|window|browser|everything)$/i.test(query) || /\b(?:except|then)\b/i.test(query)))) return null;
  return [{ action: 'find_tab', params: { query, auto_switch: activate } }];
}

export function referenceSelector(raw: string): ChromeAction[] | null {
  const c = raw.trim().toLowerCase().replace(/^(?:the|my)\s+/, '');
  if (/^(?:it|that|that one|that tab|that page)$/.test(c)) return [{ action: 'reference_tabs', params: { reference: 'it' } }];
  if (/^(?:them|those|those tabs|those two|both|both tabs|both of them)$/.test(c)) return [{ action: 'reference_tabs', params: { reference: 'them', ...(/two|both/.test(c) ? { count: 2 } : {}) } }];
  if (/^(?:these|these tabs|selected tabs|highlighted tabs)$/.test(c)) return [{ action: 'reference_tabs', params: { reference: 'these' } }];
  const other = c.match(/^other(?:\s+(.+?))?(?:\s+tab|\s+one)?$/);
  if (other) return [{ action: 'reference_tabs', params: { reference: 'other', ...(other[1] ? { query: other[1].replace(/\s+(?:tab|one)$/, '') } : {}) } }];
  return null;
}
