interface Position { node: Node; offset: number; }
interface Segment { start: number; end: number; text: string; before: Position; after: Position; }
export interface EditableText { text: string; segments: Segment[]; emptyPosition: Position; }
export interface EditorSnapshot { children: [Node, Node[]][]; text: [Text, string][]; attributes: [Element, [string, string][]][]; }
export interface RetainedEditorNodes extends EditorSnapshot { parents: [Node, Node | null][]; }
export const MAX_EDITOR_CHARACTERS = 1_000_000;
export const MAX_EDITOR_NODES = 50_000;

/** Hidden and noneditable subtrees remain barriers, even when they contain no text. */
export function protectedEditorElements(host: HTMLElement): Element[] {
  return Array.from(host.querySelectorAll('*')).filter(element => {
    if (element.getAttribute('contenteditable')?.toLowerCase() === 'false' || element.hasAttribute('hidden') || element.hasAttribute('inert') || element.getAttribute('aria-hidden') === 'true' || element.getAttribute('aria-readonly') === 'true' || /^(INPUT|TEXTAREA|SELECT|BUTTON|SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(element.tagName)) return true;
    const style = host.ownerDocument.defaultView!.getComputedStyle(element);
    return style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse';
  });
}
export function editableRangeAllowed(host: HTMLElement, range: Range): boolean { return !protectedEditorElements(host).some(element => range.intersectsNode(element)); }

const blockDisplay = /^(block|flow-root|flex|grid|list-item|table(?:-.+)?)$/;
const isBlock = (node: Node, host: HTMLElement): boolean => node instanceof HTMLElement && node !== host && blockDisplay.test(host.ownerDocument.defaultView!.getComputedStyle(node).display);
interface EditorNode {
  node: Node; parent?: EditorNode; index: number; depth: number; children: EditorNode[];
  block: boolean; whiteSpace: string; break: boolean; content: boolean; meaningful: boolean; tail: boolean;
  first: Position; last: Position;
}

/** A bounded metadata pass makes style, subtree-content and edge work linear. */
function scanEditor(host: HTMLElement): { root: EditorNode; nodes: Map<Node, EditorNode> } {
  const nodes = new Map<Node, EditorNode>(); const order: EditorNode[] = []; let characters = 0;
  const stack: { node: Node; parent?: EditorNode; index: number; depth: number }[] = [{ node: host, index: 0, depth: 0 }];
  while (stack.length) {
    const item = stack.pop()!; const node = item.node;
    if (nodes.size >= MAX_EDITOR_NODES || item.depth > 512) throw new Error('This editor is too large for a safe text edit.');
    if (node.nodeType === Node.TEXT_NODE) { characters += (node as Text).data.length; if (characters > MAX_EDITOR_CHARACTERS) throw new Error('This editor is too large for a safe text edit.'); }
    const style = node instanceof HTMLElement ? host.ownerDocument.defaultView!.getComputedStyle(node) : undefined;
    const entry: EditorNode = { ...item, children: [], block: node !== host && !!style && blockDisplay.test(style.display), whiteSpace: style?.whiteSpace ?? '', break: node instanceof HTMLBRElement, content: false, meaningful: false, tail: false, first: { node, offset: 0 }, last: { node, offset: 0 } };
    nodes.set(node, entry); order.push(entry); item.parent?.children.push(entry);
    // Check width before allocating a work stack for an unbounded child list.
    if (node.childNodes.length + nodes.size + stack.length > MAX_EDITOR_NODES) throw new Error('This editor is too large for a safe text edit.');
    for (let index = node.childNodes.length - 1; index >= 0; index--) stack.push({ node: node.childNodes[index]!, parent: entry, index, depth: item.depth + 1 });
  }
  const root = order[0]!;
  for (let index = order.length - 1; index >= 0; index--) {
    const entry = order[index]!; const node = entry.node;
    entry.content = entry.block || entry.break || (node.nodeType === Node.TEXT_NODE && !!(node as Text).data) || entry.children.some(child => child.content);
    if (node.nodeType === Node.TEXT_NODE) {
      const value = (node as Text).data;
      // Formatting indentation beside paragraphs is not an editable blank line.
      const adjacentBlock = !!entry.parent && (entry.parent.children[entry.index - 1]?.block || entry.parent.children[entry.index + 1]?.block);
      entry.meaningful = !!value && !(/^\s+$/.test(value) && !/pre|break-spaces/.test(entry.parent?.whiteSpace ?? '') && adjacentBlock);
    } else entry.meaningful = node instanceof HTMLElement && entry.content;
  }
  // A BR ends its line if no later meaningful sibling exists before a block edge.
  root.tail = true;
  for (const entry of order) {
    let following = false;
    for (let index = entry.children.length - 1; index >= 0; index--) {
      const child = entry.children[index]!; child.tail = !following && (entry === root || entry.block || entry.tail);
      following ||= child.meaningful;
    }
  }
  for (let index = order.length - 1; index >= 0; index--) {
    const entry = order[index]!;
    let first: EditorNode | undefined; let last: EditorNode | undefined;
    for (const child of entry.children) if (child.meaningful) { first ??= child; last = child; }
    if (first && last) { entry.first = first.first; entry.last = last.last; }
    else if (entry.node.nodeType === Node.TEXT_NODE) entry.last = { node: entry.node, offset: (entry.node as Text).data.length };
    else if (entry.break) {
      entry.first = { node: entry.parent!.node, offset: entry.index };
      entry.last = { node: entry.parent!.node, offset: entry.index + (entry.tail ? 0 : 1) };
    }
  }
  return { root, nodes };
}

/** Logical offsets include BRs and paragraph boundaries, and retain DOM positions. */
export function editableText(host: HTMLElement): EditableText {
  const { root } = scanEditor(host);
  const parts: string[] = []; const segments: Segment[] = []; let length = 0;
  const append = (text: string, start: Position, end: Position): void => {
    if (!text) return;
    if (length + text.length > MAX_EDITOR_CHARACTERS) throw new Error('This editor is too large for a safe text edit.');
    parts.push(text); segments.push({ start: length, end: length + text.length, text, before: start, after: end }); length += text.length;
  };
  const stack = [{ entry: root, index: 0, hadChild: false, previousBlock: false, end: { node: host as Node, offset: 0 } }];
  while (stack.length) {
    const frame = stack[stack.length - 1]!;
    if (frame.index >= frame.entry.children.length) { stack.pop(); continue; }
    const child = frame.entry.children[frame.index++]!;
    if (!child.meaningful) continue;
    if (frame.hadChild && (frame.previousBlock || child.block)) append('\n', frame.end, child.first);
    frame.hadChild = true; frame.previousBlock = child.block; frame.end = child.last;
    if (child.node.nodeType === Node.TEXT_NODE) append((child.node as Text).data, child.first, child.last);
    else if (child.break) { if (!child.tail) append('\n', child.first, child.last); }
    else stack.push({ entry: child, index: 0, hadChild: false, previousBlock: false, end: { node: child.node, offset: 0 } });
  }
  return { text: parts.join(''), segments, emptyPosition: root.first };
}

function position(index: EditableText, offset: number, end: boolean): Position {
  if (!index.segments.length) return index.emptyPosition;
  const segment = index.segments.find(item => end ? offset > item.start && offset <= item.end : offset >= item.start && offset < item.end);
  if (!segment) return offset === 0 ? index.segments[0]!.before : index.segments[index.segments.length - 1]!.after;
  if (segment.before.node === segment.after.node && segment.before.node.nodeType === Node.TEXT_NODE) return { node: segment.before.node, offset: segment.before.offset + offset - segment.start };
  return offset === segment.start ? segment.before : segment.after;
}

export function editableRange(host: HTMLElement, start: number, end: number, index = editableText(host)): Range | null {
  if (start < 0 || end < start || end > index.text.length) return null;
  const a = position(index, start, false); const b = start === end ? a : position(index, end, true);
  const range = host.ownerDocument.createRange(); range.setStart(a.node, a.offset); range.setEnd(b.node, b.offset);
  return editableRangeAllowed(host, range) ? range : null;
}

export function editableOffset(host: HTMLElement, node: Node, offset: number, index = editableText(host)): number | null {
  if (node !== host && !host.contains(node)) return null;
  const caret = host.ownerDocument.createRange(); caret.setStart(node, offset); caret.collapse(true);
  for (const segment of index.segments) {
    if (segment.before.node === node && node.nodeType === Node.TEXT_NODE && segment.before.offset <= offset && offset <= segment.after.offset) return segment.start + offset - segment.before.offset;
    if (caret.comparePoint(segment.before.node, segment.before.offset) >= 0) return segment.start;
    if (caret.comparePoint(segment.after.node, segment.after.offset) >= 0) return segment.end;
  }
  return index.text.length;
}

/** Keep actual nodes so undo restores listeners and element identities as well as markup. */
export function snapshotEditor(host: HTMLElement): EditorSnapshot {
  const children: EditorSnapshot['children'] = []; const text: EditorSnapshot['text'] = []; const attributes: EditorSnapshot['attributes'] = [];
  const stack: Node[] = [host]; let visited = 0;
  while (stack.length) {
    const node = stack.pop()!;
    if (++visited > MAX_EDITOR_NODES) throw new Error('This editor is too large for a safe text edit.');
    if (node.nodeType === Node.TEXT_NODE) text.push([node as Text, node.textContent!]);
    else {
      const original = Array.from(node.childNodes); children.push([node, original]); stack.push(...original);
      if (node instanceof Element && node !== host) attributes.push([node, Array.from(node.attributes).map(attribute => [attribute.name, attribute.value])]);
    }
  }
  return { children, text, attributes };
}

export function sameEditorNodes(snapshot: EditorSnapshot): boolean {
  return snapshot.children.every(([node, children]) => node.childNodes.length === children.length && children.every((child, index) => node.childNodes[index] === child));
}

/** Watch original nodes, including detached ones: the page can reuse those later. */
export function retainEditorNodes(snapshot: EditorSnapshot): RetainedEditorNodes {
  const children: EditorSnapshot['children'] = snapshot.children.map(([node]) => [node, Array.from(node.childNodes)]);
  const text: EditorSnapshot['text'] = snapshot.text.map(([node]) => [node, node.data]);
  const attributes: EditorSnapshot['attributes'] = snapshot.attributes.map(([element]) => [element, Array.from(element.attributes).map(attribute => [attribute.name, attribute.value])]);
  const host = children[0]?.[0];
  const parents: RetainedEditorNodes['parents'] = [...children.map(([node]) => node), ...text.map(([node]) => node)].filter(node => node !== host).map(node => [node, node.parentNode]);
  return { children, text, attributes, parents };
}
export function retainedEditorNodesUnchanged(snapshot: RetainedEditorNodes): boolean {
  return sameEditorNodes(snapshot) && snapshot.parents.every(([node, parent]) => node.parentNode === parent) && snapshot.text.every(([node, text]) => node.data === text) && snapshot.attributes.every(([element, attributes]) => element.attributes.length === attributes.length && attributes.every(([name, value]) => element.getAttribute(name) === value));
}

export function restoreEditor(snapshot: EditorSnapshot): void {
  for (const [node, text] of snapshot.text) node.data = text;
  for (const [element, attributes] of snapshot.attributes) {
    for (const attribute of Array.from(element.attributes)) if (!attributes.some(([name]) => attribute.name === name)) element.removeAttribute(attribute.name);
    for (const [name, value] of attributes) if (element.getAttribute(name) !== value) element.setAttribute(name, value);
  }
  for (const [node, children] of snapshot.children) {
    if (node.childNodes.length === children.length && children.every((child, index) => node.childNodes[index] === child)) continue;
    while (node.firstChild) node.removeChild(node.firstChild);
    for (const child of children) node.appendChild(child);
  }
}

function lineContainer(node: Node, host: HTMLElement): HTMLElement {
  let element = node instanceof HTMLElement ? node : node.parentElement;
  while (element && element !== host && !isBlock(element, host)) element = element.parentElement;
  return element ?? host;
}

/** Join the surviving edges of a cross-paragraph selection as a native text edit does. */
function joinEdges(start: HTMLElement, end: HTMLElement, host: HTMLElement): void {
  if (start === end || !start.isConnected || !end.isConnected) return;
  if (start === host) {
    let top: Node = end; while (top.parentNode !== host && top.parentNode) top = top.parentNode;
    while (end.firstChild) host.insertBefore(end.firstChild, top);
  } else if (end === host) {
    let top: Node = start; while (top.parentNode !== host && top.parentNode) top = top.parentNode;
    while (top.nextSibling && !isBlock(top.nextSibling, host)) start.appendChild(top.nextSibling);
    return;
  } else while (end.firstChild) start.appendChild(end.firstChild);
  let empty: HTMLElement | null = end;
  while (empty && empty !== host && !empty.childNodes.length) { const parent: HTMLElement | null = empty.parentElement; empty.remove(); empty = parent; }
}

export function replaceEditableRange(host: HTMLElement, range: Range, text: string): void {
  const start = lineContainer(range.startContainer, host); const end = lineContainer(range.endContainer, host);
  const anchor = range.cloneRange(); anchor.collapse(true);
  range.deleteContents(); joinEdges(start, end, host);
  range.setStart(anchor.startContainer, anchor.startOffset); range.collapse(true);
  const fragment = host.ownerDocument.createDocumentFragment(); const lines = text.replace(/\r\n?/g, '\n').split('\n');
  lines.forEach((line, index) => { if (index) fragment.append(host.ownerDocument.createElement('br')); if (line) fragment.append(host.ownerDocument.createTextNode(line)); });
  // A real final newline needs a following empty line box in normal white-space.
  const last = fragment.lastChild;
  if (last) { range.insertNode(fragment); range.setStartAfter(last); range.collapse(true); }
  if (last instanceof HTMLBRElement && scanEditor(host).nodes.get(last)?.tail) {
    const filler = host.ownerDocument.createElement('br'); last.after(filler);
  }
  const selection = host.ownerDocument.defaultView?.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
}
