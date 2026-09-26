export type SemanticKind = 'heading' | 'landmark';
export interface SemanticTarget { kind: SemanticKind; name: string; label: string; role: string; fingerprint: string; }
export interface PageScanOptions { maxNodes?: number; maxDepth?: number; maxSegments?: number; onLimit?: () => void; }
const MAX_PAGE_NODES = 50_000;
const MAX_PAGE_DEPTH = 512;

/** Visit rendered children, including assigned slots, once and in reading order. */
export function renderedChildren(node: Node): ArrayLike<Node> {
  if (node instanceof HTMLSlotElement) {
    const assigned = node.assignedNodes({ flatten: true });
    if (assigned.length) return assigned;
  }
  if (node instanceof Element && node.shadowRoot) return node.shadowRoot.childNodes;
  return node.childNodes;
}

export function pageElements(root: Document | ShadowRoot, exclude: (element: HTMLElement) => boolean, options: PageScanOptions = {}): HTMLElement[] {
  const result: HTMLElement[] = []; const seen = new Set<Node>();
  const stack = [{ children: [root] as ArrayLike<Node>, index: 0, depth: 0 }];
  const maxNodes = options.maxNodes ?? MAX_PAGE_NODES; const maxDepth = options.maxDepth ?? MAX_PAGE_DEPTH;
  while (stack.length) {
    const current = stack[stack.length - 1]!;
    if (current.index >= current.children.length) { stack.pop(); continue; }
    if (seen.size >= maxNodes) { options.onLimit?.(); break; }
    const node = current.children[current.index++]!;
    if (seen.has(node)) continue; seen.add(node);
    if (node instanceof HTMLElement) { if (exclude(node)) continue; result.push(node); }
    const children = renderedChildren(node);
    if (children.length) {
      if (current.depth >= maxDepth) { options.onLimit?.(); continue; }
      stack.push({ children, index: 0, depth: current.depth + 1 });
    }
  }
  return result;
}

export function accessibleName(element: HTMLElement): string {
  const root = element.getRootNode() as Document | ShadowRoot;
  const labelled = element.getAttribute('aria-labelledby')?.split(/\s+/).map(id => root.getElementById(id)?.textContent ?? '').join(' ').trim();
  return (labelled || element.getAttribute('aria-label') || element.getAttribute('title') || '').replace(/\s+/g, ' ').trim();
}

const landmarks: Record<string, string> = { main: 'Main content', navigation: 'Navigation', complementary: 'Complementary content', banner: 'Banner', contentinfo: 'Footer', search: 'Search', form: 'Form', region: 'Region' };
export function semanticTarget(element: HTMLElement): SemanticTarget | null {
  const explicit = element.getAttribute('role')?.trim().split(/\s+/)[0];
  const heading = explicit === 'heading' || (!explicit && /^H[1-6]$/.test(element.tagName));
  if (heading) {
    const fullName = (accessibleName(element) || element.textContent || '').replace(/\s+/g, ' ').trim();
    const name = fullName.slice(0, 500);
    if (!name) return null;
    const raw = element.getAttribute('aria-level');
    const level = raw && /^[1-9]\d*$/.test(raw) ? Number(raw) : /^H[1-6]$/.test(element.tagName) ? Number(element.tagName[1]) : 2;
    const safeLevel = Number.isSafeInteger(level) ? level : 2;
    return { kind: 'heading', name, label: `Heading ${safeLevel}: ${name}`.slice(0, 150), role: 'heading', fingerprint: JSON.stringify(['heading', safeLevel, fullName]) };
  }
  let role = explicit;
  const fullName = accessibleName(element); const name = fullName.slice(0, 500);
  if (!role) {
    role = ({ MAIN: 'main', NAV: 'navigation', ASIDE: 'complementary', SEARCH: 'search' } as Record<string, string>)[element.tagName];
    if (['FORM', 'SECTION'].includes(element.tagName) && name) role = element.tagName === 'FORM' ? 'form' : 'region';
    if (['HEADER', 'FOOTER'].includes(element.tagName) && !element.parentElement?.closest('article, aside, main, nav, section')) role = element.tagName === 'HEADER' ? 'banner' : 'contentinfo';
  }
  if (!role || !landmarks[role] || (['form', 'region'].includes(role) && !name)) return null;
  const label = name ? `${landmarks[role]}: ${name}` : landmarks[role]!;
  return { kind: 'landmark', name: name || landmarks[role]!, label: label.slice(0, 150), role, fingerprint: JSON.stringify(['landmark', role, fullName]) };
}

interface TextSegment { node: Text; start: number; end: number; from: number; to: number; whitespace: boolean; }
interface TextRun { parts: string[]; length: number; endsWhitespace: boolean; segments: TextSegment[]; root: Node; }
export interface PageTextMatch { range: Range; text: string; parents: Element[]; }
export const normalizePageText = (value: string): string => value.replace(/\s+/gu, ' ');
const escapePattern = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Index adjacent inline text without crossing block, editor, or shadow-root boundaries. */
export function findPageText(doc: Document, query: string, readable: (element: Element) => boolean, maxCharacters = 1_000_000, maxMatches = 500, options: PageScanOptions = {}): PageTextMatch[] {
  const normalized = normalizePageText(query).trim(); if (!normalized) return [];
  let run: TextRun | undefined; let scanned = 0; let segmentCount = 0; let limited = false;
  const maxNodes = options.maxNodes ?? MAX_PAGE_NODES; const maxDepth = options.maxDepth ?? MAX_PAGE_DEPTH; const maxSegments = options.maxSegments ?? 200_000;
  const result: PageTextMatch[] = []; const pattern = new RegExp(escapePattern(normalized), 'giu');
  const flush = (): void => {
    const item = run; run = undefined; if (!item?.length) return;
    const text = item.parts.join(''); pattern.lastIndex = 0; let match: RegExpExecArray | null; let segmentIndex = 0;
    while (result.length < maxMatches && (match = pattern.exec(text))) {
      const start = match.index; const end = start + match[0].length;
      while (item.segments[segmentIndex] && item.segments[segmentIndex]!.to <= start) segmentIndex++;
      let lastIndex = segmentIndex;
      while (item.segments[lastIndex] && item.segments[lastIndex]!.to < end) lastIndex++;
      const first = item.segments[segmentIndex]; const last = item.segments[lastIndex]; if (!first || !last) continue;
      const range = doc.createRange();
      range.setStart(first.node, first.whitespace ? first.start : first.start + start - first.from);
      range.setEnd(last.node, last.whitespace ? last.end : last.start + end - last.from);
      const selectedText = normalizePageText(range.toString());
      // Rendered order can differ from DOM order around slots. Never report an
      // empty or different DOM selection as the phrase that was requested.
      if (range.collapsed || selectedText !== match[0]) continue;
      const parents = new Set<Element>();
      for (let index = segmentIndex; index <= lastIndex; index++) { const parent = item.segments[index]!.node.parentElement; if (parent) parents.add(parent); }
      result.push({ range, text: selectedText, parents: Array.from(parents) });
    }
    if (result.length >= maxMatches && pattern.exec(text)) limited = true;
  };
  const seen = new Set<Node>();
  const stack = [{ children: [doc.body ?? doc.documentElement] as ArrayLike<Node>, index: 0, depth: 0, boundary: false }];
  while (stack.length) {
    const current = stack[stack.length - 1]!;
    if (current.index >= current.children.length) { stack.pop(); if (current.boundary) flush(); continue; }
    if (seen.size >= maxNodes || scanned >= maxCharacters || segmentCount >= maxSegments || result.length >= maxMatches) { limited = true; break; }
    const node = current.children[current.index++]!;
    if (seen.has(node)) continue; seen.add(node);
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node as Text; const source = text.data.slice(0, maxCharacters - scanned); scanned += source.length;
      if (source.length < text.data.length) limited = true;
      const root = text.getRootNode(); if (run && run.root !== root) flush();
      run ??= { parts: [], length: 0, endsWhitespace: false, segments: [], root };
      for (const match of source.matchAll(/\s+|[^\s]+/gu)) {
        if (segmentCount >= maxSegments) { limited = true; break; }
        const whitespace = /^\s/u.test(match[0]);
        if (whitespace && (!run.length || run.endsWhitespace)) continue;
        const value = whitespace ? ' ' : match[0]; const from = run.length;
        run.parts.push(value); run.length += value.length; run.endsWhitespace = whitespace;
        run.segments.push({ node: text, start: match.index, end: match.index + match[0].length, from, to: run.length, whitespace }); segmentCount++;
      }
      continue;
    }
    let boundary = false;
    if (node instanceof Element) {
      if (!readable(node) || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|INPUT|TEXTAREA|SELECT|OPTION)$/.test(node.tagName.toUpperCase()) || (node instanceof HTMLElement && node.isContentEditable) || ['true', 'plaintext-only', ''].includes(node.getAttribute('contenteditable') ?? 'false') || ['textbox', 'searchbox'].includes(node.getAttribute('role') ?? '')) { flush(); continue; }
      const display = doc.defaultView!.getComputedStyle(node).display;
      boundary = node.tagName === 'BR' || node instanceof HTMLSlotElement || /^(block|flow-root|flex|grid|list-item|table(?:-.+)?)$/.test(display) || !!node.shadowRoot;
      if (boundary) flush();
    }
    const children = renderedChildren(node);
    if (children.length) {
      if (current.depth >= maxDepth) { limited = true; flush(); continue; }
      stack.push({ children, index: 0, depth: current.depth + 1, boundary });
    }
  }
  flush(); if (limited) options.onLimit?.();
  return result;
}
