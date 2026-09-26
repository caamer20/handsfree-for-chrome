export interface TextSelection { start: number; end: number; direction?: 'forward' | 'backward' | 'none'; }

export function isTextInput(element: HTMLElement): element is HTMLInputElement | HTMLTextAreaElement {
  return element.tagName === 'INPUT' || element.tagName === 'TEXTAREA';
}

export function fieldText(element: HTMLElement): string { return isTextInput(element) ? element.value : element.textContent ?? ''; }

/** Offsets always belong to one editor; selections elsewhere never become editing targets. */
export function textSelection(element: HTMLElement): TextSelection | null {
  if (isTextInput(element)) {
    return element.selectionStart === null || element.selectionEnd === null ? null : { start: element.selectionStart, end: element.selectionEnd, direction: element.selectionDirection ?? 'none' };
  }
  const selection = element.ownerDocument.defaultView?.getSelection();
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) return null;
  const before = element.ownerDocument.createRange(); before.selectNodeContents(element); before.setEnd(range.startContainer, range.startOffset);
  return { start: before.toString().length, end: before.toString().length + range.toString().length };
}

export function textRange(element: HTMLElement, start: number, end: number): Range | null {
  if (start < 0 || end < start || end > fieldText(element).length) return null;
  const doc = element.ownerDocument; const range = doc.createRange();
  const walker = doc.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let node: Node | null; let offset = 0; let started = false;
  while ((node = walker.nextNode())) {
    const length = node.textContent?.length ?? 0;
    if (!started && start <= offset + length) { range.setStart(node, start - offset); started = true; }
    if (started && end <= offset + length) {
      range.setEnd(node, end - offset);
      const blocked = Array.from(element.querySelectorAll('[contenteditable="false"]')).some(child => range.intersectsNode(child));
      return blocked ? null : range;
    }
    offset += length;
  }
  if (!started && start === 0 && end === 0) { range.selectNodeContents(element); range.collapse(true); return range; }
  return null;
}

export function selectTextRange(element: HTMLElement, selection: TextSelection): boolean {
  if (isTextInput(element)) {
    if (element.selectionStart === null || element.selectionEnd === null) return false;
    element.setSelectionRange(selection.start, selection.end, selection.direction); return true;
  }
  const range = textRange(element, selection.start, selection.end);
  const current = element.ownerDocument.defaultView?.getSelection();
  if (!range || !current) return false;
  current.removeAllRanges(); current.addRange(range); return true;
}

export function sameSelection(a: TextSelection | null, b: TextSelection | null): boolean {
  return !!a && !!b && a.start === b.start && a.end === b.end && a.direction === b.direction;
}

/** Match in the original string so case folding never shifts Unicode offsets. */
export function textOccurrences(value: string, query: string): TextSelection[] {
  if (!query) return [];
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
  const matches: TextSelection[] = []; let match: RegExpExecArray | null;
  while ((match = pattern.exec(value))) {
    matches.push({ start: match.index, end: match.index + match[0].length });
    // Overlapping occurrences are ambiguous too (e.g. "ana" in "banana").
    pattern.lastIndex = match.index + (value.codePointAt(match.index)! > 0xffff ? 2 : 1);
    if (matches.length > 1) break;
  }
  return matches;
}

export function dictatedInsertion(value: string, selection: TextSelection | null, spoken: string): string {
  const start = selection?.start ?? value.length; const end = selection?.end ?? value.length;
  const left = value.slice(0, start); const right = value.slice(end);
  const prefix = left && !/[\s([{“"/-]$/.test(left) && !/^[\s.,!?;:)}\]”-]/.test(spoken) ? ' ' : '';
  const suffix = right && !/^[\s.,!?;:)}\]”-]/.test(right) && !/[\s([{“"/-]$/.test(spoken) ? ' ' : '';
  return spoken ? `${prefix}${spoken}${suffix}` : '';
}
