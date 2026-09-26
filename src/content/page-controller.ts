import type { PageParams } from '../common/expanded-schema';
import type { PageResult } from '../common/page';
import { isSafeUrl } from '../common/urls';
import { dictatedInsertion, editingHost, fieldText, isTextInput, sameSelection, selectTextRange, textOccurrences, textRange, textSelection, type TextSelection } from './text-editing';
import { editableRangeAllowed, MAX_EDITOR_CHARACTERS, MAX_EDITOR_NODES, protectedEditorElements, replaceEditableRange, restoreEditor, retainEditorNodes, retainedEditorNodesUnchanged, sameEditorNodes, snapshotEditor, type EditorSnapshot, type RetainedEditorNodes } from './editable-text';
import { findPageText, normalizePageText, pageElements, semanticTarget, type PageTextMatch, type SemanticKind } from './page-navigation';

const EDIT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'number', '']);
interface Target { element: HTMLElement; label: string; href: string; badge?: HTMLElement; kind?: SemanticKind; fingerprint?: string; }
interface DictationEdit { element: HTMLElement; token: string; before: string; after: string; beforeSelection: TextSelection; afterSelection: TextSelection; snapshot?: EditorSnapshot; afterNodes?: EditorSnapshot; retainedNodes?: RetainedEditorNodes; protectedElements?: Element[]; markup?: string; }
const clean = (text: string): string => text.replace(/\s+/g, ' ').trim();
const key = (text: string): string => clean(text).toLowerCase().replace(/[“”"']/g, '');
export class PageController {
  private token = crypto.randomUUID();
  private targets = new Map<number, Target>();
  private overlay: HTMLDivElement | null = null;
  private expiration: ReturnType<typeof setTimeout> | undefined;
  private matches: PageTextMatch[] = [];
  private matchIndex = -1;
  private scrollTarget: HTMLElement | null = null;
  private lastScroll = { direction: 'down', amount: 'page' };
  private dictationTarget: HTMLElement | null = null;
  private dictationToken: string | null = null;
  private dictationEdit: DictationEdit | null = null;
  private dictationQueue: Promise<PageResult> = Promise.resolve({ ok: true, text: '' });
  private editing = false;
  private lastMedia: HTMLMediaElement | null = null;
  private navigationAnchor: Partial<Record<SemanticKind, HTMLElement>> = {};
  private temporaryFocus: HTMLElement | null = null;
  private readability = new WeakMap<Element, boolean>();
  private scanLimited = false;
  constructor(private doc: Document = document) {
    this.doc.addEventListener('input', this.invalidateDictationEdit, true);
    this.doc.addEventListener('focusin', this.invalidateDictationEdit, true);
    this.doc.addEventListener('selectionchange', this.checkDictationSelection);
  }
  private invalidateDictationEdit = (): void => { if (!this.editing) this.dictationEdit = null; };
  private checkDictationSelection = (): void => {
    if (!this.editing && this.dictationEdit && !sameSelection(textSelection(this.dictationEdit.element), this.dictationEdit.afterSelection)) this.dictationEdit = null;
  };
  private get win(): Window { return this.doc.defaultView ?? window; }
  private own(element: Element): boolean { return !!element.closest('#handsfree-chrome-hud-root, #handsfree-page-overlay'); }
  private elements(root: Document | ShadowRoot = this.doc): HTMLElement[] {
    return pageElements(root, element => this.own(element), { onLimit: () => { this.scanLimited = true; } });
  }
  private parent(element: HTMLElement): HTMLElement | null;
  private parent(element: Element): Element | null;
  private parent(element: Element): Element | null {
    if ('assignedSlot' in element && element.assignedSlot instanceof HTMLSlotElement) return element.assignedSlot;
    if (element.parentElement) return element.parentElement;
    const root = element.getRootNode(); return root instanceof ShadowRoot ? root.host as HTMLElement : null;
  }
  private readable(element: Element): boolean {
    if (!element.isConnected || this.own(element)) return false;
    const path: Element[] = []; let readable = true;
    for (let current: Element | null = element; current; current = this.parent(current)) {
      const cached = this.readability.get(current); if (cached !== undefined) { readable = cached; break; }
      path.push(current);
      if (current.hasAttribute('hidden') || current.hasAttribute('inert') || current.getAttribute('aria-hidden') === 'true') { readable = false; break; }
      const style = this.win.getComputedStyle(current);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') { readable = false; break; }
    }
    for (const current of path) this.readability.set(current, readable);
    return readable;
  }
  private visible(element: HTMLElement, viewport = false): boolean {
    if (!this.readable(element)) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && (!viewport || (rect.bottom > 0 && rect.right > 0 && rect.top < this.win.innerHeight && rect.left < this.win.innerWidth));
  }
  private label(element: HTMLElement): string {
    const root = element.getRootNode() as Document | ShadowRoot;
    const labelled = element.getAttribute('aria-labelledby')?.split(/\s+/).map(id => root.getElementById(id)?.textContent ?? '').join(' ');
    const associated = 'labels' in element ? Array.from((element as HTMLInputElement).labels ?? []).map(label => { const clone = label.cloneNode(true) as HTMLElement; clone.querySelectorAll('input, textarea, select, button').forEach(control => control.remove()); return clone.textContent ?? ''; }).join(' ') : '';
    const valueField = /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName) || element.isContentEditable || ['true', 'plaintext-only', ''].includes(element.getAttribute('contenteditable') ?? 'false');
    return clean(labelled || element.getAttribute('aria-label') || associated || element.getAttribute('placeholder') || element.getAttribute('title') || ((element.tagName === 'INPUT' && ['submit', 'button'].includes((element as HTMLInputElement).type)) ? (element as HTMLInputElement).value : '') || (!valueField ? element.textContent : '') || '').slice(0, 150);
  }
  private activeElement(): HTMLElement | null {
    let element = this.doc.activeElement;
    while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
    return element as HTMLElement | null;
  }
  private editable(element: HTMLElement | null): boolean {
    if (!element || !this.visible(element) || this.disabled(element) || element.getAttribute('aria-readonly') === 'true') return false;
    if (element.tagName === 'INPUT') { const input = element as HTMLInputElement; return EDIT_TYPES.has(input.type) && !input.disabled && !input.readOnly; }
    if (element.tagName === 'TEXTAREA') return !(element as HTMLTextAreaElement).disabled && !(element as HTMLTextAreaElement).readOnly;
    return editingHost(element) === element;
  }
  probe(): PageResult { this.readability = new WeakMap(); const active = this.activeElement(); return { ok: true, text: 'Page ready', focused: this.doc.hasFocus() && active?.tagName !== 'IFRAME', editable: this.editable(active) }; }
  private clearTargets(): void {
    clearTimeout(this.expiration); this.targets.clear(); this.overlay?.remove(); this.overlay = null;
    this.win.removeEventListener('scroll', this.positionBadges, true); this.win.removeEventListener('resize', this.positionBadges);
    this.token = crypto.randomUUID();
  }
  private positionBadges = (): void => {
    this.readability = new WeakMap();
    for (const target of this.targets.values()) {
      if (!target.badge) continue;
      const rect = target.element.getBoundingClientRect();
      target.badge.style.display = this.visible(target.element, true) ? 'block' : 'none';
      target.badge.style.left = `${Math.max(1, Math.min(this.win.innerWidth - 26, rect.left))}px`;
      target.badge.style.top = `${Math.max(1, Math.min(this.win.innerHeight - 22, rect.top))}px`;
    }
  };
  private enumerate(elements: HTMLElement[], kind?: SemanticKind): PageResult {
    this.clearTargets();
    this.overlay = this.doc.createElement('div'); this.overlay.id = 'handsfree-page-overlay';
    this.overlay.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483646;pointer-events:none;';
    const shadow = this.overlay.attachShadow({ mode: 'closed' });
    const choices: { id: number; label: string }[] = [];
    elements.slice(0, 200).forEach((element, index) => {
      const semantic = kind ? semanticTarget(element) : null;
      const id = index + 1; const label = semantic?.label ?? (this.label(element) || `Item ${id}`);
      const badge = this.doc.createElement('span'); badge.textContent = String(id);
      badge.style.cssText = 'all:initial;position:fixed;background:#175c4c;color:white;border:1px solid white;border-radius:5px;padding:2px 5px;font:bold 12px/16px system-ui;box-shadow:0 1px 5px #0006;pointer-events:none;';
      shadow.append(badge); this.targets.set(id, { element, label: this.label(element), href: element.getAttribute('href') ?? '', badge, ...(semantic ? { kind: semantic.kind, fingerprint: semantic.fingerprint } : {}) }); choices.push({ id, label });
    });
    this.doc.documentElement.append(this.overlay); this.positionBadges();
    this.win.addEventListener('scroll', this.positionBadges, true); this.win.addEventListener('resize', this.positionBadges);
    this.expiration = setTimeout(() => this.clearTargets(), 60_000);
    return { ok: true, text: choices.length ? `${choices.length} targets numbered. Say “click number five” or “open number five in a new tab”.` : 'No visible links or buttons found. Scroll, then try again.', token: this.token, choices };
  }
  private clickable(): HTMLElement[] {
    return this.elements().filter(element => /^(?:A|BUTTON|SUMMARY)$/.test(element.tagName) || ['button', 'link', 'tab', 'menuitem'].includes(element.getAttribute('role') ?? '') || (element.tagName === 'INPUT' && ['submit', 'button'].includes((element as HTMLInputElement).type))).filter(element => this.visible(element, true) && !this.disabled(element));
  }
  private disabled(element: HTMLElement): boolean {
    if (element.getAttribute('aria-disabled') === 'true' || element.matches(':disabled') || ('disabled' in element && (element as HTMLButtonElement).disabled)) return true;
    // The disabled property alone does not include a disabled fieldset's descendants.
    if (/^(INPUT|BUTTON|SELECT|TEXTAREA)$/.test(element.tagName)) {
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        if (parent.tagName !== 'FIELDSET' || !(parent as HTMLFieldSetElement).disabled) continue;
        const legend = Array.from(parent.children).find(child => child.tagName === 'LEGEND');
        if (!legend?.contains(element)) return true;
      }
    }
    return false;
  }
  private matching(query: string, editing: boolean): HTMLElement[] {
    const candidates = editing ? this.elements().filter(element => this.editable(element)) : this.clickable();
    const q = key(query).replace(/\s+(?:field|box|button|link)$/, '');
    const exact = candidates.filter(element => key(this.label(element)) === q || (editing && q === 'search' && (element.getAttribute('type') === 'search' || element.getAttribute('role') === 'searchbox')));
    if (exact.length) return exact;
    const words = q.split(' ').filter(Boolean);
    return candidates.filter(element => words.every(word => key(this.label(element)).split(/[^a-z0-9]+/).includes(word)));
  }
  private numbered(index: number, token?: string): HTMLElement | PageResult {
    const target = this.targets.get(index);
    if (!target || token !== this.token || !this.targetCurrent(target)) return { ok: false, text: 'Those numbers expired or the page changed. Show the targets again.' };
    return target.element;
  }
  private targetCurrent(target: Target): boolean {
    if (!this.visible(target.element)) return false;
    if (target.kind) { const current = semanticTarget(target.element); return current?.kind === target.kind && current.fingerprint === target.fingerprint; }
    return this.label(target.element) === target.label && (target.element.getAttribute('href') ?? '') === target.href;
  }
  private formControl(element: HTMLElement): boolean {
    return this.editable(element) || (this.visible(element) && !this.disabled(element) && (element.tagName === 'SELECT' || (element.tagName === 'INPUT' && ['checkbox', 'radio'].includes((element as HTMLInputElement).type))));
  }
  private chooseControl(command: PageParams, token?: string): HTMLElement | PageResult {
    const accepts = (el: HTMLElement): boolean => command.operation === 'select_option' ? el.tagName === 'SELECT' : el.tagName === 'INPUT' && ['checkbox', 'radio'].includes((el as HTMLInputElement).type);
    if (command.index !== undefined) {
      const selected = this.numbered(command.index, token);
      return 'ok' in selected || (this.formControl(selected) && accepts(selected)) ? selected : { ok: false, text: 'That number is not an available control for this command.' };
    }
    const all = this.elements().filter(el => this.formControl(el) && accepts(el));
    const q = key(command.query ?? '').replace(/\s+(?:dropdown|drop-down|checkbox|check box)$/, '');
    const exact = all.filter(el => key(this.label(el)) === q);
    const matches = q ? exact.length ? exact : all.filter(el => q.split(' ').every(word => key(this.label(el)).split(/[^a-z0-9]+/).includes(word))) : all.filter(el => el === this.activeElement());
    if (!matches.length) return { ok: false, text: `No available ${command.operation === 'select_option' ? 'dropdown' : 'checkbox or radio button'} named “${command.query ?? ''}” found.` };
    if (matches.length > 1) return { ...this.enumerate(matches), text: 'Several form controls match. Choose a number.' };
    return matches[0]!;
  }
  private chooseEditing(query?: string, index?: number, token?: string): HTMLElement | PageResult {
    if (index !== undefined) {
      const selected = this.numbered(index, token);
      return 'ok' in selected || this.editable(selected) ? selected : { ok: false, text: 'That numbered field cannot be edited.' };
    }
    if (!query) {
      const active = this.activeElement();
      if (active && this.editable(active)) return active;
      const host = active && !/^(A|BUTTON|SELECT|INPUT|TEXTAREA)$/.test(active.tagName) ? editingHost(active) : null;
      if (host && this.editable(host)) return host;
      return { ok: false, text: 'Focus a text field first, or say “type into the search box”. Password fields are excluded.' };
    }
    const matches = this.matching(query, true);
    if (!matches.length) return { ok: false, text: `No editable field named “${query}” found on this page.` };
    if (matches.length > 1) return { ...this.enumerate(matches), text: `Several fields match “${query}”. Choose a number to continue.` };
    return matches[0]!;
  }
  private insert(element: HTMLElement, text: string, replace = false, deleting = false): PageResult {
    if (!this.editable(element)) return { ok: false, text: 'That text field is no longer available.' };
    const before = fieldText(element); const selectionBefore = textSelection(element);
    const markupBefore = isTextInput(element) ? undefined : element.innerHTML;
    const nodesBefore = isTextInput(element) ? undefined : snapshotEditor(element);
    let editingRange: Range | undefined;
    if (nodesBefore) {
      if (replace) { editingRange = this.doc.createRange(); editingRange.selectNodeContents(element); }
      else {
        const candidate = textRange(element, selectionBefore?.start ?? before.length, selectionBefore?.end ?? before.length);
        if (!candidate) return { ok: false, text: 'That selection is no longer available for editing.' };
        editingRange = candidate;
      }
      if (!editableRangeAllowed(element, editingRange)) return { ok: false, text: 'That selection includes hidden or noneditable content. Your text was kept.' };
      const replacedLength = replace ? before.length : (selectionBefore?.end ?? before.length) - (selectionBefore?.start ?? before.length);
      const lines = text.replace(/\r\n?/g, '\n').split('\n');
      // Count added text/BR nodes, a possible line placeholder and a split text node.
      const addedNodes = lines.filter(Boolean).length + lines.length - 1 + 2;
      const resultingNodes = replace ? 1 + addedNodes : nodesBefore.children.length + nodesBefore.text.length + addedNodes;
      const rawCharacters = nodesBefore.text.reduce((total, [, value]) => total + value.length, 0) - editingRange.toString().length;
      const insertedLength = text.replace(/\r\n?/g, '\n').length;
      if (Math.max(before.length - replacedLength, rawCharacters) + insertedLength > MAX_EDITOR_CHARACTERS || resultingNodes > MAX_EDITOR_NODES) return { ok: false, text: 'That insertion would exceed the editor’s safe size limit. Your text was kept.' };
    }
    const activeBefore = this.activeElement(); const focusedBefore = this.doc.hasFocus();
    const inputType = deleting ? 'deleteContentBackward' : replace ? 'insertReplacementText' : 'insertText';
    const inputEvent = new InputEvent('beforeinput', { bubbles: true, composed: true, cancelable: true, data: text, inputType });
    if (!element.dispatchEvent(inputEvent)) return { ok: false, text: 'This editor handled the input itself. Use its editing controls.' };
    this.readability = new WeakMap();
    const selectionAfter = textSelection(element);
    if (!this.editable(element) || fieldText(element) !== before || (markupBefore !== undefined && element.innerHTML !== markupBefore) || (nodesBefore && !sameEditorNodes(nodesBefore)) || (selectionBefore || selectionAfter ? !sameSelection(selectionBefore, selectionAfter) : false) || this.activeElement() !== activeBefore || this.doc.hasFocus() !== focusedBefore) return { ok: false, text: 'The field or selection changed before text entry. Your current text was kept.' };
    let expected: string;
    if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
      const input = element as HTMLInputElement | HTMLTextAreaElement;
      const start = replace ? 0 : input.selectionStart ?? input.value.length; const end = replace ? input.value.length : input.selectionEnd ?? start;
      const next = input.value.slice(0, start) + text + input.value.slice(end);
      expected = next;
      if (input.type === 'number' && next && !/^-?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?$/i.test(next)) return { ok: false, text: 'Use a numeric value for this number field.' };
      if (input.maxLength >= 0 && next.length > input.maxLength) return { ok: false, text: 'That text exceeds the field’s character limit.' };
      const prototype = Object.getPrototypeOf(input) as object;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (setter) setter.call(input, next); else input.value = next;
      try { input.setSelectionRange(start + text.length, start + text.length); } catch { /* Some input types have no text selection. */ }
    } else {
      const start = replace ? 0 : selectionBefore?.start ?? before.length; const end = replace ? before.length : selectionBefore?.end ?? before.length;
      if (!editingRange || !editableRangeAllowed(element, editingRange)) return { ok: false, text: 'That selection includes hidden or noneditable content. Your text was kept.' };
      expected = before.slice(0, start) + text.replace(/\r\n?/g, '\n') + before.slice(end);
      replaceEditableRange(element, editingRange, text);
    }
    this.editing = true;
    try { element.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data: text, inputType })); }
    finally { this.editing = false; }
    if (!element.isConnected || this.fieldValue(element) !== expected) return { ok: false, text: 'The page changed or rejected the entered text. Check the field before trying again.' };
    return { ok: true, text: 'Text entered' };
  }
  private fieldValue(element: HTMLElement): string { return fieldText(element); }
  private async insertVerified(element: HTMLElement, text: string, replace = false, deleting = false): Promise<PageResult> {
    const result = this.insert(element, text, replace, deleting); if (!result.ok) return result;
    const expected = this.fieldValue(element);
    // Give controlled editors one turn to apply or reject their input update.
    await new Promise<void>(resolve => this.win.setTimeout(resolve, 0));
    return element.isConnected && this.fieldValue(element) === expected ? result : { ok: false, text: 'The editor changed or rejected the entered text. Check the field before trying again.' };
  }
  dictate(text: string, token?: string): Promise<PageResult> {
    const next = this.dictationQueue.then(() => this.dictateNow(text, token));
    this.dictationQueue = next.catch(() => ({ ok: false, text: 'Dictation could not enter that text.' }));
    return next;
  }
  private async dictateNow(text: string, token?: string): Promise<PageResult> {
    this.readability = new WeakMap();
    const element = this.dictationTarget;
    if (!element || token !== this.dictationToken) return { ok: false, text: 'That dictation session has ended. Start dictation in the field again.', dictating: false };
    if (this.activeElement() !== element || !this.doc.hasFocus()) { this.dictationTarget = null; this.dictationToken = null; this.dictationEdit = null; return { ok: false, text: 'Dictation stopped because the field or focus changed.', dictating: false }; }
    const literal = text.match(/^literal\s+([\s\S]+)$/i);
    if (!literal && /^(?:scratch that|undo last dictation)[.!?]*$/i.test(text.trim())) {
      const result = await this.undoDictation(element, token!);
      if (!result.ok && token === this.dictationToken) { this.dictationTarget = null; this.dictationToken = null; }
      return result.ok ? result : { ...result, dictating: false };
    }
    const current = fieldText(element); const beforeSelection = textSelection(element) ?? { start: current.length, end: current.length };
    const spoken = literal ? literal[1]! : text.replace(/[ \t]*\bnew paragraph\b[ \t]*/gi, '\n\n').replace(/[ \t]*\bnew line\b[ \t]*/gi, '\n');
    const insertion = dictatedInsertion(current, beforeSelection, spoken);
    const snapshot = isTextInput(element) ? undefined : snapshotEditor(element);
    this.dictationEdit = null;
    const result = await this.insertVerified(element, insertion);
    if (!result.ok) { if (token === this.dictationToken) { this.dictationTarget = null; this.dictationToken = null; } return { ...result, dictating: false }; }
    if (token !== this.dictationToken || this.activeElement() !== element || !this.doc.hasFocus()) return { ok: false, text: 'Dictation stopped because the field or focus changed. Check the last entered text.', dictating: false };
    if (fieldText(element) !== current.slice(0, beforeSelection.start) + insertion + current.slice(beforeSelection.end)) {
      this.dictationTarget = null; this.dictationToken = null;
      return { ok: false, text: 'The editor changed the insertion point. Check the last entered text before continuing.', dictating: false };
    }
    const afterSelection = textSelection(element);
    if (afterSelection) this.dictationEdit = { element, token: token!, before: current, after: fieldText(element), beforeSelection, afterSelection, ...(snapshot ? { snapshot, afterNodes: snapshotEditor(element), retainedNodes: retainEditorNodes(snapshot), protectedElements: protectedEditorElements(element), markup: element.innerHTML } : {}) };
    return result;
  }
  private async undoDictation(element: HTMLElement, token: string): Promise<PageResult> {
    const edit = this.dictationEdit; this.dictationEdit = null;
    const unchangedNodes = (): boolean => {
      if (!edit || (edit.afterNodes && !sameEditorNodes(edit.afterNodes)) || (edit.retainedNodes && !retainedEditorNodesUnchanged(edit.retainedNodes))) return false;
      if (edit.protectedElements) { const current = protectedEditorElements(element); if (current.length !== edit.protectedElements.length || current.some((node, index) => node !== edit.protectedElements![index])) return false; }
      return true;
    };
    if (!edit || edit.element !== element || edit.token !== token || !this.editable(element) || fieldText(element) !== edit.after || !sameSelection(textSelection(element), edit.afterSelection) || (edit.markup !== undefined && element.innerHTML !== edit.markup) || !unchangedNodes()) return { ok: false, text: 'The field or selection changed, or there is no dictation to undo. Your text was kept.' };
    if (!element.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, composed: true, cancelable: true, inputType: 'historyUndo', data: null }))) return { ok: false, text: 'This editor prevented undo. Your text was kept.' };
    this.readability = new WeakMap();
    if (!this.editable(element) || fieldText(element) !== edit.after || !sameSelection(textSelection(element), edit.afterSelection) || (edit.markup !== undefined && element.innerHTML !== edit.markup) || !unchangedNodes() || this.activeElement() !== element || !this.doc.hasFocus() || token !== this.dictationToken) return { ok: false, text: 'The field changed before undo. Check its text before trying again.' };
    this.editing = true;
    try {
      if (isTextInput(element)) {
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element) as object, 'value')?.set;
        if (setter) setter.call(element, edit.before); else element.value = edit.before;
      } else {
        if (!edit.snapshot) return { ok: false, text: 'That part of the editor is no longer available. Your text was kept.' };
        restoreEditor(edit.snapshot);
      }
      selectTextRange(element, edit.beforeSelection);
      element.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'historyUndo', data: null }));
    } finally { this.editing = false; }
    await new Promise<void>(resolve => this.win.setTimeout(resolve, 0));
    return element.isConnected && fieldText(element) === edit.before ? { ok: true, text: 'Last dictation undone' } : { ok: false, text: 'The editor changed or rejected undo. Check the field before continuing.' };
  }
  private restoreTemporaryFocus = (): void => {
    const element = this.temporaryFocus; this.temporaryFocus = null;
    if (!element) return;
    element.removeEventListener('blur', this.restoreTemporaryFocus);
    if (element.getAttribute('tabindex') === '-1') element.removeAttribute('tabindex');
  };
  private navigate(element: HTMLElement, kind: SemanticKind): PageResult {
    const target = semanticTarget(element);
    if (!this.visible(element) || target?.kind !== kind) return { ok: false, text: 'That page destination changed. Show the headings or landmarks again.' };
    this.restoreTemporaryFocus();
    if (!element.hasAttribute('tabindex')) { element.setAttribute('tabindex', '-1'); this.temporaryFocus = element; element.addEventListener('blur', this.restoreTemporaryFocus); }
    element.focus({ preventScroll: true }); element.scrollIntoView({ block: 'start', behavior: 'instant' });
    this.navigationAnchor[kind] = element;
    this.dictationTarget = null; this.dictationToken = null; this.dictationEdit = null;
    return { ok: true, text: target.label, dictating: false };
  }
  private semantic(command: PageParams, token?: string): PageResult {
    const kind: SemanticKind = command.operation.endsWith('heading') || command.operation === 'show_headings' ? 'heading' : 'landmark';
    if (command.index !== undefined) {
      const selected = this.numbered(command.index, token); if ('ok' in selected) return selected;
      if (this.targets.get(command.index)?.kind !== kind) return { ok: false, text: `That number is not a ${kind}. Show ${kind}s again.` };
      return this.navigate(selected, kind);
    }
    const candidates = this.elements().filter(element => semanticTarget(element)?.kind === kind && this.visible(element));
    if (!candidates.length) return { ok: false, text: `No available ${kind}s were found in this page frame.` };
    if (command.operation.startsWith('show_')) {
      return { ...this.enumerate(candidates, kind), text: `${Math.min(candidates.length, 200)} ${kind}s numbered${candidates.length > 200 ? ' (showing the first 200)' : ''}. Choose a number to go there.` };
    }
    if (command.operation.startsWith('go_')) {
      const query = key(command.query ?? '');
      const exact = candidates.filter(element => { const info = semanticTarget(element)!; return key(info.name) === query || (kind === 'landmark' && info.role === query); });
      const matches = exact.length ? exact : query ? candidates.filter(element => query.split(' ').every(word => key(semanticTarget(element)!.label).split(/[^\p{L}\p{N}]+/u).includes(word))) : [];
      if (!matches.length) return { ok: false, text: `No ${kind} named “${command.query ?? ''}” was found in this page frame.` };
      if (matches.length > 1) return { ...this.enumerate(matches, kind), text: `Several ${kind}s match. Choose a number.` };
      return this.navigate(matches[0]!, kind);
    }
    const backwards = command.operation.startsWith('previous_');
    const active = this.activeElement();
    let current = candidates.indexOf(this.navigationAnchor[kind]!);
    let focused = active ? candidates.indexOf(active) : -1;
    if (focused < 0 && active) candidates.forEach((element, index) => { if (element.contains(active)) focused = index; });
    if (focused >= 0) current = focused;
    let index: number;
    if (current >= 0) index = (current + (backwards ? -1 : 1) + candidates.length) % candidates.length;
    else if (backwards) { index = -1; candidates.forEach((element, candidateIndex) => { if (element.getBoundingClientRect().top < 0) index = candidateIndex; }); if (index < 0) index = candidates.length - 1; }
    else { index = candidates.findIndex(element => element.getBoundingClientRect().top >= 0); if (index < 0) index = 0; }
    const result = this.navigate(candidates[index]!, kind);
    return { ...result, text: `${kind === 'heading' ? 'Heading' : 'Landmark'} ${index + 1} of ${candidates.length}. ${result.text}${current >= 0 && (backwards ? index > current : index < current) ? ' (wrapped)' : ''}` };
  }
  private scroll(command: PageParams): PageResult {
    const direction = command.direction ?? this.lastScroll.direction;
    const horizontal = direction === 'left' || direction === 'right';
    const canScroll = (element: HTMLElement): boolean => {
      const style = this.win.getComputedStyle(element);
      return horizontal ? element.scrollWidth > element.clientWidth + 5 && /auto|scroll/.test(style.overflowX) : element.scrollHeight > element.clientHeight + 5 && /auto|scroll/.test(style.overflowY);
    };
    const active = this.activeElement(); let scrollable: HTMLElement | null = active;
    while (scrollable && !canScroll(scrollable)) scrollable = this.parent(scrollable);
    if (!scrollable && command.amount === 'repeat' && this.scrollTarget && this.visible(this.scrollTarget) && canScroll(this.scrollTarget)) scrollable = this.scrollTarget;
    if (!scrollable) scrollable = this.elements().filter(el => this.visible(el, true) && canScroll(el)).sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0] ?? this.doc.scrollingElement as HTMLElement | null;
    this.scrollTarget = scrollable;
    const amount = command.amount === 'repeat' ? this.lastScroll.amount : command.amount ?? 'page'; this.lastScroll = { direction, amount };
    const height = scrollable?.clientHeight || this.win.innerHeight; const width = scrollable?.clientWidth || this.win.innerWidth;
    const fraction = amount === 'little' ? 0.25 : amount === 'half' ? 0.5 : 0.8;
    const top = direction === 'up' ? -height * fraction : direction === 'down' ? height * fraction : 0;
    const left = direction === 'left' ? -width * fraction : direction === 'right' ? width * fraction : 0;
    if (direction === 'top' || direction === 'bottom') {
      const y = direction === 'top' ? 0 : scrollable?.scrollHeight ?? this.doc.documentElement.scrollHeight;
      if (scrollable?.scrollTo) scrollable.scrollTo({ top: y, behavior: 'smooth' }); else this.win.scrollTo({ top: y, behavior: 'smooth' });
    } else if (scrollable?.scrollBy) scrollable.scrollBy({ top, left, behavior: 'smooth' }); else this.win.scrollBy({ top, left, behavior: 'smooth' });
    return { ok: true, text: `Scrolled ${direction}` };
  }
  private find(query?: string, backwards = false): PageResult {
    if (query !== undefined) {
      this.matches = findPageText(this.doc, query, element => this.readable(element), 1_000_000, 500, { onLimit: () => { this.scanLimited = true; } }); this.matchIndex = -1;
    }
    const previous = this.matches[this.matchIndex];
    this.matches = this.matches.filter(match => match.range.startContainer.isConnected && match.range.endContainer.isConnected && match.parents.every(parent => this.readable(parent)) && normalizePageText(match.range.toString()) === match.text);
    if (previous) this.matchIndex = this.matches.indexOf(previous);
    if (!this.matches.length) return { ok: false, text: query ? `No visible text matching “${query}” found.` : 'Find some text on this page first.' };
    this.matchIndex = (this.matchIndex + (backwards ? -1 : 1) + this.matches.length) % this.matches.length;
    const match = this.matches[this.matchIndex]!.range; const selection = this.win.getSelection(); selection?.removeAllRanges(); selection?.addRange(match);
    match.startContainer.parentElement?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return { ok: true, text: `Match ${this.matchIndex + 1} of ${this.matches.length}` };
  }
  private media(): HTMLMediaElement | PageResult {
    const media = this.elements().filter(element => /^(VIDEO|AUDIO)$/.test(element.tagName)) as HTMLMediaElement[];
    if (this.lastMedia?.isConnected && media.includes(this.lastMedia)) return this.lastMedia;
    const playing = media.filter(element => !element.paused && !element.ended);
    const candidates = playing.length ? playing : media.filter(element => this.visible(element));
    if (!candidates.length) return { ok: false, text: 'No accessible audio or video was found in this page frame.' };
    if (candidates.length > 1) return { ...this.enumerate(candidates), text: 'Several media players are available. Click a numbered player, then try the media command.' };
    this.lastMedia = candidates[0]!; return this.lastMedia;
  }
  async execute(command: PageParams, token?: string): Promise<PageResult> {
    this.readability = new WeakMap(); this.scanLimited = false;
    const result = await this.runCommand(command, token);
    return this.scanLimited ? { ...result, text: `${result.text} Only the first part of this large page was scanned.` } : result;
  }
  private async runCommand(command: PageParams, token?: string): Promise<PageResult> {
    const op = command.operation;
    if (['show_headings', 'next_heading', 'previous_heading', 'go_heading', 'show_landmarks', 'next_landmark', 'previous_landmark', 'go_landmark'].includes(op)) return this.semantic(command, token);
    if (['select_text', 'replace_text', 'cursor_start', 'cursor_end', 'cursor_before', 'cursor_after'].includes(op)) {
      const selected = this.chooseEditing(); if ('ok' in selected) return selected;
      this.dictationEdit = null;
      const value = fieldText(selected);
      const matches = op === 'cursor_start' || op === 'cursor_end' ? [{ start: op === 'cursor_start' ? 0 : value.length, end: op === 'cursor_start' ? 0 : value.length }] : textOccurrences(value, command.query ?? '');
      if (!matches.length) return { ok: false, text: 'That text was not found in this field.' };
      if (matches.length > 1) return { ok: false, text: 'That text occurs more than once in this field. Say a longer, more specific phrase.' };
      const match = matches[0]!;
      const selection = op === 'cursor_before' ? { start: match.start, end: match.start } : op === 'cursor_after' ? { start: match.end, end: match.end } : match;
      if (!selectTextRange(selected, selection)) return { ok: false, text: 'This field or text does not support that selection.' };
      if (op === 'replace_text') return this.insertVerified(selected, command.text ?? '');
      if (op === 'cursor_before' || op === 'cursor_after') return { ok: true, text: `Cursor moved ${op === 'cursor_before' ? 'before' : 'after'} the matching text` };
      return { ok: true, text: op === 'select_text' ? 'Text selected in this field' : `Cursor moved to the ${op === 'cursor_start' ? 'start' : 'end'} of this field` };
    }
    if (op === 'field_ready') { const matches = this.matching(command.query ?? '', true); return { ok: true, editable: matches.length === 1, text: matches.length === 1 ? 'Field ready' : matches.length > 1 ? 'Several fields match; use a more specific field label.' : 'Waiting for the field' }; }
    if (op === 'scroll') return this.scroll(command);
    if (op === 'find' || op === 'find_next' || op === 'find_previous') return this.find(op === 'find' ? command.query : undefined, op === 'find_previous');
    if (op === 'show_fields') { const fields = this.elements().filter(el => this.formControl(el)); return { ...this.enumerate(fields), text: fields.length ? 'Form fields numbered. Say “click number two” to focus a field, then edit it.' : 'No available form fields on this page.' }; }
    if (op === 'next_field' || op === 'previous_field') {
      const fields = this.elements().filter(el => this.formControl(el) && (el.tabIndex >= 0 || (!el.hasAttribute('tabindex') && editingHost(el) === el))).sort((a, b) => (a.tabIndex > 0 ? a.tabIndex : Infinity) - (b.tabIndex > 0 ? b.tabIndex : Infinity));
      if (!fields.length) return { ok: false, text: 'No available form fields on this page.' };
      const current = fields.indexOf(this.activeElement()!);
      const index = current < 0 ? op === 'next_field' ? 0 : fields.length - 1 : (current + (op === 'next_field' ? 1 : -1) + fields.length) % fields.length;
      const field = fields[index]!; field.scrollIntoView({ block: 'center' }); field.focus();
      return { ok: true, text: `Focused ${this.label(field) || `field ${index + 1}`}` };
    }
    if (op === 'select_option' || op === 'check' || op === 'uncheck') {
      const selected = this.chooseControl(command, token); if ('ok' in selected) return selected;
      selected.focus();
      if (op === 'select_option') {
        const select = selected as HTMLSelectElement;
        if (select.multiple) return { ok: false, text: 'Multiple-selection lists need the page’s own controls.' };
        const options = Array.from(select.options).filter(option => !option.disabled && !option.hidden && !(option.parentElement?.tagName === 'OPTGROUP' && (option.parentElement as HTMLOptGroupElement).disabled));
        const optionLabel = (option: HTMLOptionElement): string => option.label || option.textContent || '';
        const matches = options.filter(option => key(optionLabel(option)) === key(command.text ?? ''));
        if (matches.length !== 1) return { ok: false, text: matches.length ? 'More than one option has that label. Choose it on the page.' : `No enabled option labeled “${command.text ?? ''}” found. Say the option’s full label.` };
        const index = Array.from(select.options).indexOf(matches[0]!);
        if (select.selectedIndex === index) return { ok: true, text: `Already selected ${optionLabel(matches[0]!)}` };
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex')?.set?.call(select, index);
        select.dispatchEvent(new Event('input', { bubbles: true, composed: true })); select.dispatchEvent(new Event('change', { bubbles: true }));
        if (select.selectedIndex !== index) return { ok: false, text: 'The page prevented that selection. Use its own dropdown.' };
        return { ok: true, text: `Selected ${optionLabel(matches[0]!)}` };
      }
      const input = selected as HTMLInputElement; const checked = op === 'check';
      if (input.type === 'radio' && !checked) return { ok: false, text: 'Choose another radio option to change this selection.' };
      if (input.indeterminate && input.checked === checked) return { ok: false, text: 'This checkbox represents a mixed selection. Use its own control.' };
      if (input.checked === checked && !input.indeterminate) return { ok: true, text: `Already ${checked ? 'checked' : 'unchecked'}` };
      input.click();
      return input.checked === checked && !input.indeterminate ? { ok: true, text: `${checked ? 'Checked' : 'Unchecked'} ${this.label(input)}` } : { ok: false, text: 'The page prevented that change. Use its own control.' };
    }
    if (op === 'show_links') return this.enumerate(this.clickable());
    if (op === 'hide_links') { this.clearTargets(); return { ok: true, text: 'Link numbers hidden' }; }
    if (op === 'activate') {
      let element: HTMLElement;
      if (command.index !== undefined) {
        const target = this.targets.get(command.index);
        if (!target || token !== this.token || !this.targetCurrent(target)) return { ok: false, text: 'Those numbers expired or the page changed. Show the targets again.' };
        if (target.kind) return command.new_tab ? { ok: false, text: 'That number is a page destination. Choose it in this page.' } : this.navigate(target.element, target.kind);
        element = target.element;
      } else {
        const matches = this.matching(command.query ?? '', false);
        if (!matches.length) return { ok: false, text: `No visible control named “${command.query}” found. Try “show links”.` };
        if (matches.length > 1) return { ...this.enumerate(matches), text: `Several controls match “${command.query}”. Choose a number.` };
        element = matches[0]!;
      }
      if (!this.visible(element) || this.disabled(element)) return { ok: false, text: 'That control is no longer available. Show links again.' };
      if (command.new_tab) {
        const href = (element as HTMLAnchorElement).href;
        if (!href || !isSafeUrl(href) || href.startsWith('chrome:')) return { ok: false, text: 'That target is not a web link. Use “click” to activate it in this page.' };
        return { ok: true, text: 'Opening the selected link in a new tab', url: href };
      }
      element.scrollIntoView?.({ block: 'center', behavior: 'instant' }); element.focus?.();
      if (this.formControl(element)) return { ok: true, text: `Focused ${this.label(element) || 'text field'}` };
      if (/^(VIDEO|AUDIO)$/.test(element.tagName)) { this.lastMedia = element as HTMLMediaElement; return { ok: true, text: 'Selected media player' }; }
      if (typeof element.click === 'function') element.click(); else element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true })); return { ok: true, text: `Clicked ${this.label(element) || 'selected control'}` };
    }
    if (['focus', 'type', 'fill', 'clear', 'select_all', 'delete_selection', 'dictate_start'].includes(op)) {
      const selected = this.chooseEditing(command.query, command.index, token);
      if ('ok' in selected) return selected;
      this.dictationEdit = null;
      selected.scrollIntoView({ block: 'center' }); selected.focus();
      if (op === 'focus') return { ok: true, text: `Focused ${this.label(selected) || 'text field'}` };
      if (op === 'select_all' || op === 'delete_selection') {
        if (selected.tagName === 'INPUT' || selected.tagName === 'TEXTAREA') {
          const input = selected as HTMLInputElement;
          if (input.selectionStart === null || input.selectionEnd === null) return { ok: false, text: 'This field does not support text selection.' };
          if (op === 'select_all') input.setSelectionRange(0, input.value.length);
          else if (input.selectionStart === input.selectionEnd) return { ok: false, text: 'Select some text in the field first.' };
        } else {
          const selection = this.win.getSelection();
          if (op === 'select_all') { const range = this.doc.createRange(); range.selectNodeContents(selected); selection?.removeAllRanges(); selection?.addRange(range); }
          else if (!selection?.rangeCount || selection.isCollapsed || !selected.contains(selection.getRangeAt(0).commonAncestorContainer)) return { ok: false, text: 'Select some text in the field first.' };
        }
        return op === 'select_all' ? { ok: true, text: 'Selected all text in this field' } : this.insertVerified(selected, '', false, true);
      }
      if (op === 'fill' || op === 'clear') return this.insertVerified(selected, op === 'clear' ? '' : command.text ?? '', true, op === 'clear');
      if (op === 'type') return this.insertVerified(selected, command.text ?? '');
      this.dictationTarget = selected; this.dictationToken = crypto.randomUUID();
      return { ok: true, text: 'Dictation on. Say “stop dictation” when finished.', dictating: true, token: this.dictationToken };
    }
    if (op === 'dictate_stop') { this.dictationTarget = null; this.dictationToken = null; this.dictationEdit = null; return { ok: true, text: 'Dictation stopped', dictating: false }; }
    if (op.startsWith('media_')) {
      const selected = this.media(); if ('ok' in selected) return selected;
      if (op === 'media_pause') selected.pause();
      else if (op === 'media_play' || (op === 'media_toggle' && selected.paused)) {
        try { await selected.play(); } catch { return { ok: false, text: 'Chrome or this website blocked playback. Start the player once on the page, then try again.' }; }
      } else if (op === 'media_toggle') selected.pause();
      else if (op === 'media_volume') { selected.volume = Math.max(0, Math.min(1, (command.relative ? selected.volume : 0) + (command.value ?? 0) / 100)); if (selected.volume > 0) selected.muted = false; }
      else if (op === 'media_seek') {
        const min = selected.seekable.length ? selected.seekable.start(0) : 0;
        const max = Number.isFinite(selected.duration) ? selected.duration : selected.seekable.length ? selected.seekable.end(selected.seekable.length - 1) : NaN;
        if (!Number.isFinite(max)) return { ok: false, text: 'This player does not currently support seeking.' };
        selected.currentTime = Math.max(min, Math.min(max, (command.relative ? selected.currentTime : 0) + (command.value ?? 0)));
      }
      return { ok: true, text: op === 'media_volume' ? `Volume ${Math.round(selected.volume * 100)} percent` : op === 'media_seek' ? 'Playback position changed' : selected.paused ? 'Playback paused' : 'Playback started' };
    }
    return { ok: true, text: `On this page, try “show headings”, “show landmarks”, “scroll down”, “find pricing on this page”, or “show links”.${this.elements().some(element => this.editable(element)) ? ' You can focus a text field and start dictation.' : ''}${this.elements().some(element => /^(VIDEO|AUDIO)$/.test(element.tagName)) ? ' Media playback and volume controls are also available.' : ''}` };
  }
  cancel(): void {
    const scrolling = this.scrollTarget ?? this.doc.scrollingElement as HTMLElement | null;
    scrolling?.scrollTo?.({ top: scrolling.scrollTop, left: scrolling.scrollLeft, behavior: 'instant' });
    this.dictationTarget = null; this.dictationToken = null; this.dictationEdit = null; this.clearTargets(); this.restoreTemporaryFocus();
  }
  destroy(): void { this.cancel(); this.clearTargets(); this.matches = []; this.lastMedia = null; this.navigationAnchor = {}; this.restoreTemporaryFocus(); this.doc.removeEventListener('input', this.invalidateDictationEdit, true); this.doc.removeEventListener('focusin', this.invalidateDictationEdit, true); this.doc.removeEventListener('selectionchange', this.checkDictationSelection); }
}
