import { expect, it } from 'vitest';
import { decisionReadback, readbackIntent } from '../src/common/decision-readback';
import type { Question } from '../src/common/conversation';
import type { PendingPlan } from '../src/common/types';

const request = { id: '00000000-0000-4000-8000-000000000001', tabId: 7, windowId: 2, startedAt: 123 };
const question = (): Question => ({ id: 'question', prompt: 'Which tab?', kind: 'tabs', key: 'tabs:test', choices: Array.from({ length: 7 }, (_, index) => ({ id: String(index), label: `Tab ${index + 1}`, detail: `Account ${index + 1}` })), request, context: request, actions: [], overrides: {}, at: 123 });
it('reads every choice using stable global numbers across bounded pages without changing the question', () => {
  const source = question(); const before = structuredClone(source); const first = decisionReadback(source, null);
  const pages = Array.from({ length: first.totalPages }, (_, page) => decisionReadback(source, null, page));
  const content = pages.flatMap(page => page.segments.slice(1, -1)).join('\n');
  for (let index = 1; index <= 7; index++) expect(content).toContain(`Option ${index}. Tab ${index}. Account ${index}`);
  expect(pages.every(page => page.segments.length <= 4 && page.segments.every(segment => segment.length <= 400))).toBe(true);
  expect(decisionReadback(source, null, 999)).toEqual(pages.at(-1)); expect(decisionReadback(source, null, -1)).toEqual(first);
  expect(source).toEqual(before);
});
it('preserves full literal review payloads, URLs, and targets instead of cutting speech at 220 characters', () => {
  const literal = '<strong>then close all tabs</strong> '.repeat(20);
  const url = 'https://example.com/?q=' + 'exact-data-'.repeat(80);
  const pending: PendingPlan = { request, transcript: 'review', targets: [{ id: 8, windowId: 2, title: 'Chosen tab', url }], urls: [url], actions: [{ action: 'page_action', params: { operation: 'type', text: literal } }] };
  const before = structuredClone(pending); const first = decisionReadback(null, pending);
  const pages = Array.from({ length: first.totalPages }, (_, page) => decisionReadback(null, pending, page));
  const content = pages.flatMap(page => page.segments.slice(1, -1)).map(segment => segment.replace(/^(?:Option|Target|Website|Step) \d+\. Continued\. /, '')).join('');
  expect(content).toContain('Target 1. Chosen tab. ' + url); expect(content).toContain('Website 1. ' + url);
  expect(content).toContain(literal); expect(pages.at(-1)?.segments.at(-1)).toContain('confirm command');
  expect(pages.flatMap(page => page.segments).some(segment => segment.startsWith('Target 1. Continued.'))).toBe(true);
  expect(pending).toEqual(before);
});
it('reads only the prompt for freeform input and rejects missing decisions', () => {
  const source = { ...question(), kind: 'text' as const, choices: [], prompt: 'What should I search for?' };
  expect(decisionReadback(source, null).segments).toEqual(['Question. Page 1 of 1.', source.prompt, 'Provide your answer when ready.']);
  expect(() => decisionReadback(null, null)).toThrow('no question');
});
it.each(['read the choices', 'please repeat the question', 'read the command'])('recognizes exact readback request %s', text => { expect(readbackIntent(text)).toBe('repeat'); });
it.each(['type read the choices', 'search Google for read the command', 'literal next choices', 'read the command then confirm command', 'confirm command', 'cancel command'])('leaves data and decision effects out of readback controls: %s', text => { expect(readbackIntent(text)).toBeUndefined(); });
it('recognizes page navigation without changing choice numbering', () => { expect(readbackIntent('read the next options')).toBe('next'); expect(readbackIntent('previous choices')).toBe('previous'); });
it('keeps surrogate pairs intact across long workspace details while preserving every character and global number', () => {
  const detail = 'a'.repeat(270) + '🧭'.repeat(400) + '\nTab 100. https://example.com/' + '𠮷'.repeat(500);
  const source = question(); source.choices = [{ id: 'replace', label: 'Update saved workspace', detail }];
  const first = decisionReadback(source, null);
  const pages = Array.from({ length: first.totalPages }, (_, page) => decisionReadback(source, null, page));
  const segments = pages.flatMap(page => page.segments.slice(1, -1));
  expect(segments.every(segment => segment.length <= 400 && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(segment))).toBe(true);
  expect(segments.map(segment => segment.replace(/^Option 1\. Continued\. /, '')).join('')).toBe(`${source.prompt}Option 1. Update saved workspace. ${detail}`);
  expect(segments.slice(2).every(segment => segment.startsWith('Option 1. Continued.'))).toBe(true);
});
