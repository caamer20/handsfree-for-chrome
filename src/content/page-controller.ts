import type { PageParams } from '../common/expanded-schema';
import type { PageResult } from '../common/page';
import { isSafeUrl } from '../common/urls';

const EDIT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'number', '']);
interface Target { element: HTMLElement; label: string; href: string; badge?: HTMLElement; }
const clean = (text: string): string => text.replace(/\s+/g, ' ').trim();
const key = (text: string): string => clean(text).toLowerCase().replace(/[“”"']/g, '');
export class PageController {
  private token = crypto.randomUUID();
  private targets = new Map<number, Target>();
  private overlay: HTMLDivElement | null = null;
  private expiration: ReturnType<typeof setTimeout> | undefined;
  private matches: Range[] = [];
  private matchIndex = -1;
  private scrollTarget: HTMLElement | null = null;
  private lastScroll = { direction: 'down', amount: 'page' };
  private dictationTarget: HTMLElement | null = null;
  private dictationToken: string | null = null;
  private lastMedia: HTMLMediaElement | null = null;
  constructor(private doc: Document = document) {}
  private get win(): Window { return this.doc.defaultView ?? window; }
  private own(element: Element): boolean { return !!element.closest('#handsfree-chrome-hud-root, #handsfree-page-overlay'); }
  private elements(root: Document | ShadowRoot = this.doc): HTMLElement[] {
    const result: HTMLElement[] = [];
    for (const element of root.querySelectorAll<HTMLElement>('*')) {
      if (this.own(element)) continue;
      result.push(element);
      if (element.shadowRoot) result.push(...this.elements(element.shadowRoot));
    }
    return result;
  }
  private visible(element: HTMLElement, viewport = false): boolean {
    if (!element.isConnected || element.hidden || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
    const style = this.win.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && (!viewport || (rect.bottom > 0 && rect.right > 0 && rect.top < this.win.innerHeight && rect.left < this.win.innerWidth));
  }
  private label(element: HTMLElement): string {
    const labelled = element.getAttribute('aria-labelledby')?.split(/\s+/).map(id => this.doc.getElementById(id)?.textContent ?? '').join(' ');
    const associated = 'labels' in element ? Array.from((element as HTMLInputElement).labels ?? []).map(label => { const clone = label.cloneNode(true) as HTMLElement; clone.querySelectorAll('input, textarea, select, button').forEach(control => control.remove()); return clone.textContent ?? ''; }).join(' ') : '';
    const valueField = /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName) || element.isContentEditable || ['true', 'plaintext-only', ''].includes(element.getAttribute('contenteditable') ?? 'false');
    return clean(element.getAttribute('aria-label') || labelled || associated || element.getAttribute('placeholder') || element.getAttribute('title') || ((element.tagName === 'INPUT' && ['submit', 'button'].includes((element as HTMLInputElement).type)) ? (element as HTMLInputElement).value : '') || (!valueField ? element.textContent : '') || '').slice(0, 150);
  }
  private activeElement(): HTMLElement | null {
    let element = this.doc.activeElement;
    while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
    return element as HTMLElement | null;
  }
  private editable(element: HTMLElement | null): boolean {
    if (!element || !this.visible(element) || element.getAttribute('aria-disabled') === 'true' || element.matches(':disabled')) return false;
    if (element.tagName === 'INPUT') { const input = element as HTMLInputElement; return EDIT_TYPES.has(input.type) && !input.disabled && !input.readOnly; }
    if (element.tagName === 'TEXTAREA') return !(element as HTMLTextAreaElement).disabled && !(element as HTMLTextAreaElement).readOnly;
    return element.isContentEditable || ['true', 'plaintext-only', ''].includes(element.getAttribute('contenteditable') ?? 'false');
  }
  probe(): PageResult { const active = this.activeElement(); return { ok: true, text: 'Page ready', focused: this.doc.hasFocus() && active?.tagName !== 'IFRAME', editable: this.editable(active) }; }
  private clearTargets(): void {
    clearTimeout(this.expiration); this.targets.clear(); this.overlay?.remove(); this.overlay = null;
    this.win.removeEventListener('scroll', this.positionBadges, true); this.win.removeEventListener('resize', this.positionBadges);
    this.token = crypto.randomUUID();
  }
  private positionBadges = (): void => {
    for (const target of this.targets.values()) {
      if (!target.badge) continue;
      const rect = target.element.getBoundingClientRect();
      target.badge.style.display = this.visible(target.element, true) ? 'block' : 'none';
      target.badge.style.left = `${Math.max(1, Math.min(this.win.innerWidth - 26, rect.left))}px`;
      target.badge.style.top = `${Math.max(1, Math.min(this.win.innerHeight - 22, rect.top))}px`;
    }
  };
  private enumerate(elements: HTMLElement[]): PageResult {
    this.clearTargets();
    this.overlay = this.doc.createElement('div'); this.overlay.id = 'handsfree-page-overlay';
    this.overlay.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483646;pointer-events:none;';
    const shadow = this.overlay.attachShadow({ mode: 'closed' });
    const choices: { id: number; label: string }[] = [];
    elements.slice(0, 200).forEach((element, index) => {
      const id = index + 1; const label = this.label(element) || `Item ${id}`;
      const badge = this.doc.createElement('span'); badge.textContent = String(id);
      badge.style.cssText = 'all:initial;position:fixed;background:#175c4c;color:white;border:1px solid white;border-radius:5px;padding:2px 5px;font:bold 12px/16px system-ui;box-shadow:0 1px 5px #0006;pointer-events:none;';
      shadow.append(badge); this.targets.set(id, { element, label: this.label(element), href: element.getAttribute('href') ?? '', badge }); choices.push({ id, label });
    });
    this.doc.documentElement.append(this.overlay); this.positionBadges();
    this.win.addEventListener('scroll', this.positionBadges, true); this.win.addEventListener('resize', this.positionBadges);
    this.expiration = setTimeout(() => this.clearTargets(), 60_000);
    return { ok: true, text: choices.length ? `${choices.length} targets numbered. Say “click number five” or “open number five in a new tab”.` : 'No visible links or buttons found. Scroll, then try again.', token: this.token, choices };
  }
  private clickable(): HTMLElement[] {
    return this.elements().filter(element => /^(?:A|BUTTON|SUMMARY)$/.test(element.tagName) || ['button', 'link', 'tab', 'menuitem'].includes(element.getAttribute('role') ?? '') || (element.tagName === 'INPUT' && ['submit', 'button'].includes((element as HTMLInputElement).type))).filter(element => this.visible(element, true) && element.getAttribute('aria-disabled') !== 'true' && !('disabled' in element && (element as HTMLButtonElement).disabled));
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
    if (!target || token !== this.token || !this.visible(target.element) || this.label(target.element) !== target.label || (target.element.getAttribute('href') ?? '') !== target.href) return { ok: false, text: 'Those numbers expired or the page changed. Show the fields or links again.' };
    return target.element;
  }
  private formControl(element: HTMLElement): boolean {
    return this.editable(element) || (this.visible(element) && !element.matches(':disabled') && element.getAttribute('aria-disabled') !== 'true' && (element.tagName === 'SELECT' || (element.tagName === 'INPUT' && ['checkbox', 'radio'].includes((element as HTMLInputElement).type))));
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
      return { ok: false, text: 'Focus a text field first, or say “type into the search box”. Password fields are excluded.' };
    }
    const matches = this.matching(query, true);
    if (!matches.length) return { ok: false, text: `No editable field named “${query}” found on this page.` };
    if (matches.length > 1) return { ...this.enumerate(matches), text: `Several fields match “${query}”. Choose a number to continue.` };
    return matches[0]!;
  }
  private insert(element: HTMLElement, text: string, replace = false, deleting = false): PageResult {
    if (!this.editable(element)) return { ok: false, text: 'That text field is no longer available.' };
    const inputType = deleting ? 'deleteContentBackward' : replace ? 'insertReplacementText' : 'insertText';
    const inputEvent = new InputEvent('beforeinput', { bubbles: true, composed: true, cancelable: true, data: text, inputType });
    if (!element.dispatchEvent(inputEvent)) return { ok: false, text: 'This editor handled the input itself. Use its editing controls.' };
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
      const selection = this.win.getSelection(); let range: Range;
      if (!replace && selection?.rangeCount && element.contains(selection.getRangeAt(0).commonAncestorContainer)) range = selection.getRangeAt(0);
      else { range = this.doc.createRange(); range.selectNodeContents(element); if (!replace) range.collapse(false); }
      range.deleteContents(); const node = this.doc.createTextNode(text); range.insertNode(node); range.setStartAfter(node); range.collapse(true);
      selection?.removeAllRanges(); selection?.addRange(range);
      expected = element.textContent ?? '';
    }
    element.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data: text, inputType }));
    if (!element.isConnected || this.fieldValue(element) !== expected) return { ok: false, text: 'The page changed or rejected the entered text. Check the field before trying again.' };
    return { ok: true, text: 'Text entered' };
  }
  private fieldValue(element: HTMLElement): string { return /^(INPUT|TEXTAREA)$/.test(element.tagName) ? (element as HTMLInputElement).value : element.textContent ?? ''; }
  private async insertVerified(element: HTMLElement, text: string, replace = false, deleting = false): Promise<PageResult> {
    const result = this.insert(element, text, replace, deleting); if (!result.ok) return result;
    const expected = this.fieldValue(element);
    // Give controlled editors one turn to apply or reject their input update.
    await new Promise<void>(resolve => this.win.setTimeout(resolve, 0));
    return element.isConnected && this.fieldValue(element) === expected ? result : { ok: false, text: 'The editor changed or rejected the entered text. Check the field before trying again.' };
  }
  dictate(text: string, token?: string): PageResult {
    const element = this.dictationTarget;
    if (!element || token !== this.dictationToken || this.activeElement() !== element || !this.doc.hasFocus()) { this.dictationTarget = null; return { ok: false, text: 'Dictation stopped because the field or focus changed.', dictating: false }; }
    const current = element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' ? (element as HTMLInputElement).value : element.textContent ?? '';
    const spoken = text.replace(/\bnew paragraph\b/gi, '\n\n').replace(/\bnew line\b/gi, '\n');
    return this.insert(element, `${current && !/\s$/.test(current) && !/^\s|^[.,!?;:]/.test(spoken) ? ' ' : ''}${spoken}`);
  }
  private scroll(command: PageParams): PageResult {
    const active = this.activeElement(); let scrollable: HTMLElement | null = active;
    while (scrollable && !(scrollable.scrollHeight > scrollable.clientHeight + 5 && /auto|scroll/.test(this.win.getComputedStyle(scrollable).overflowY))) scrollable = scrollable.parentElement;
    if (!scrollable) scrollable = this.elements().filter(el => this.visible(el, true) && el.scrollHeight > el.clientHeight + 20 && /auto|scroll/.test(this.win.getComputedStyle(el).overflowY)).sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0] ?? this.doc.scrollingElement as HTMLElement | null;
    this.scrollTarget = scrollable;
    const direction = command.direction ?? this.lastScroll.direction;
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
      this.matches = []; this.matchIndex = -1;
      const walker = this.doc.createTreeWalker(this.doc.body ?? this.doc.documentElement, NodeFilter.SHOW_TEXT);
      let node: Node | null; let scanned = 0; const q = query.toLowerCase();
      while ((node = walker.nextNode()) && scanned < 1_000_000 && this.matches.length < 500) {
        const parent = node.parentElement;
        if (!parent || /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA)$/.test(parent.tagName) || this.own(parent) || !this.visible(parent)) continue;
        const text = node.textContent ?? ''; scanned += text.length;
        let index = text.toLowerCase().indexOf(q);
        while (index >= 0 && this.matches.length < 500) {
          const range = this.doc.createRange(); range.setStart(node, index); range.setEnd(node, index + q.length); this.matches.push(range);
          index = text.toLowerCase().indexOf(q, index + Math.max(1, q.length));
        }
      }
    }
    this.matches = this.matches.filter(range => range.startContainer.isConnected);
    if (!this.matches.length) return { ok: false, text: query ? `No visible text matching “${query}” found.` : 'Find some text on this page first.' };
    this.matchIndex = (this.matchIndex + (backwards ? -1 : 1) + this.matches.length) % this.matches.length;
    const match = this.matches[this.matchIndex]!; const selection = this.win.getSelection(); selection?.removeAllRanges(); selection?.addRange(match);
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
    const op = command.operation;
    if (op === 'field_ready') { const matches = this.matching(command.query ?? '', true); return { ok: true, editable: matches.length === 1, text: matches.length === 1 ? 'Field ready' : matches.length > 1 ? 'Several fields match; use a more specific field label.' : 'Waiting for the field' }; }
    if (op === 'scroll') return this.scroll(command);
    if (op === 'find' || op === 'find_next' || op === 'find_previous') return this.find(op === 'find' ? command.query : undefined, op === 'find_previous');
    if (op === 'show_fields') { const fields = this.elements().filter(el => this.formControl(el)); return { ...this.enumerate(fields), text: fields.length ? 'Form fields numbered. Say “click number two” to focus a field, then edit it.' : 'No available form fields on this page.' }; }
    if (op === 'next_field' || op === 'previous_field') {
      const fields = this.elements().filter(el => this.formControl(el) && el.tabIndex >= 0).sort((a, b) => (a.tabIndex > 0 ? a.tabIndex : Infinity) - (b.tabIndex > 0 ? b.tabIndex : Infinity));
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
        if (!target || token !== this.token || !target.element.isConnected || this.label(target.element) !== target.label || (target.element.getAttribute('href') ?? '') !== target.href) return { ok: false, text: 'Those numbers expired or the page changed. Say “show links” again.' };
        element = target.element;
      } else {
        const matches = this.matching(command.query ?? '', false);
        if (!matches.length) return { ok: false, text: `No visible control named “${command.query}” found. Try “show links”.` };
        if (matches.length > 1) return { ...this.enumerate(matches), text: `Several controls match “${command.query}”. Choose a number.` };
        element = matches[0]!;
      }
      if (command.new_tab) {
        const href = (element as HTMLAnchorElement).href;
        if (!href || !isSafeUrl(href) || href.startsWith('chrome:')) return { ok: false, text: 'That target is not a web link. Use “click” to activate it in this page.' };
        return { ok: true, text: 'Opening the selected link in a new tab', url: href };
      }
      if (!this.visible(element) || element.getAttribute('aria-disabled') === 'true' || ('disabled' in element && (element as HTMLButtonElement).disabled)) return { ok: false, text: 'That control is no longer available. Show links again.' };
      element.scrollIntoView?.({ block: 'center', behavior: 'instant' }); element.focus?.();
      if (this.formControl(element)) return { ok: true, text: `Focused ${this.label(element) || 'text field'}` };
      if (/^(VIDEO|AUDIO)$/.test(element.tagName)) { this.lastMedia = element as HTMLMediaElement; return { ok: true, text: 'Selected media player' }; }
      if (typeof element.click === 'function') element.click(); else element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true })); return { ok: true, text: `Clicked ${this.label(element) || 'selected control'}` };
    }
    if (['focus', 'type', 'fill', 'clear', 'select_all', 'delete_selection', 'dictate_start'].includes(op)) {
      const selected = this.chooseEditing(command.query, command.index, token);
      if ('ok' in selected) return selected;
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
    if (op === 'dictate_stop') { this.dictationTarget = null; this.dictationToken = null; return { ok: true, text: 'Dictation stopped', dictating: false }; }
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
    return { ok: true, text: `On this page, try “scroll down”, “find pricing on this page”, or “show links”.${this.elements().some(element => this.editable(element)) ? ' You can focus a text field and start dictation.' : ''}${this.elements().some(element => /^(VIDEO|AUDIO)$/.test(element.tagName)) ? ' Media playback and volume controls are also available.' : ''}` };
  }
  cancel(): void {
    const scrolling = this.scrollTarget ?? this.doc.scrollingElement as HTMLElement | null;
    scrolling?.scrollTo?.({ top: scrolling.scrollTop, left: scrolling.scrollLeft, behavior: 'instant' });
    this.dictationTarget = null; this.dictationToken = null; this.clearTargets();
  }
  destroy(): void { this.cancel(); this.clearTargets(); this.matches = []; this.lastMedia = null; }
}
