// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PageController } from '../src/content/page-controller';
import { fieldText, selectTextRange, textSelection } from '../src/content/text-editing';
import { editableText } from '../src/content/editable-text';

let controller: PageController;
beforeEach(() => {
  document.body.innerHTML = '';
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 10, y: 10, top: 10, left: 10, right: 200, bottom: 50, width: 190, height: 40, toJSON: () => ({}) });
  vi.spyOn(document, 'hasFocus').mockReturnValue(true); HTMLElement.prototype.scrollIntoView = vi.fn();
  controller = new PageController(document);
});
afterEach(() => { controller.destroy(); vi.restoreAllMocks(); });
function editor(markup: string): HTMLElement {
  document.body.innerHTML = `<div contenteditable="true" aria-label="Draft">${markup}</div>`;
  const field = document.querySelector<HTMLElement>('[contenteditable]')!; field.focus(); return field;
}

it('numbers one real editing host, preserves independent nested editors, and traverses the host', async () => {
  document.body.innerHTML = '<input aria-label="First"><div contenteditable="true" aria-label="Draft"><p>First <strong>line</strong></p><p>Second</p><div contenteditable="false"><div contenteditable="true" aria-label="Separate">Other</div></div></div><input aria-label="Last">';
  expect((await controller.execute({ operation: 'show_fields' })).choices?.map(choice => choice.label)).toEqual(['First', 'Draft', 'Separate', 'Last']);
  document.querySelector('input')!.focus();
  await controller.execute({ operation: 'next_field' }); expect(document.activeElement?.getAttribute('aria-label')).toBe('Draft');
});

it.each(['value', 'selection', 'readonly', 'disabled', 'hidden', 'focus', 'removed'] as const)('refuses a %s change during beforeinput without adding any text', async change => {
  document.body.innerHTML = '<textarea>original</textarea><input>';
  const field = document.querySelector('textarea')!; field.focus(); field.setSelectionRange(8, 8);
  field.addEventListener('beforeinput', () => {
    if (change === 'value') field.value = 'manual change';
    if (change === 'selection') field.setSelectionRange(0, 0);
    if (change === 'readonly') field.readOnly = true;
    if (change === 'disabled') field.disabled = true;
    if (change === 'hidden') field.hidden = true;
    if (change === 'focus') document.querySelector('input')!.focus();
    if (change === 'removed') field.remove();
  }, { once: true });
  expect(await controller.execute({ operation: 'type', text: ' added' })).toMatchObject({ ok: false, text: expect.stringContaining('changed') });
  expect(field.value).toBe(change === 'value' ? 'manual change' : 'original');
});

it('guards identical text with different markup during beforeinput', async () => {
  const field = editor('<strong>original</strong>');
  field.addEventListener('beforeinput', () => { field.innerHTML = '<em>original</em>'; }, { once: true });
  expect((await controller.execute({ operation: 'type', text: ' extra' })).ok).toBe(false);
  expect(field.innerHTML).toBe('<em>original</em>');
});

it.each([
  ['first<br>second', 'first\nsecond'],
  ['<p>first</p><p>second</p>', 'first\nsecond'],
  ['<div>first</div><div><br></div><div>third</div>', 'first\n\nthird'],
  ['first<br><br>', 'first\n'],
  ['<p><br></p>', ''],
  ['<p><br></p><p><br></p>', '\n'],
  ['<div><p>first <strong>line</strong></p><p>second</p></div>', 'first line\nsecond'],
  ['<strong></strong><p>first</p><p>second</p>', 'first\nsecond'],
  ['\n  <p>first</p>\n  <p>second</p>\n', 'first\nsecond'],
])('indexes line structure: %s', (markup, expected) => {
  const field = editor(markup); expect(fieldText(field)).toBe(expected);
  for (let offset = 0; offset <= expected.length; offset++) {
    expect(selectTextRange(field, { start: offset, end: offset })).toBe(true);
    expect(textSelection(field)).toMatchObject({ start: offset, end: offset });
  }
});

it.each(['first<br>second', '<p>first</p><p>second</p>', '<div><p>first</p></div><div><p>second</p></div>'])('replaces a multiline phrase and preserves unrelated nodes: %s', async markup => {
  const field = editor(`${markup}<p id="untouched"><em>Keep me</em></p>`); const untouched = field.querySelector('#untouched');
  expect((await controller.execute({ operation: 'replace_text', query: 'firstsecond', text: 'wrong' })).ok).toBe(false);
  expect((await controller.execute({ operation: 'replace_text', query: 'rst\nsec', text: 'X\nY' })).ok).toBe(true);
  expect(fieldText(field)).toBe('fiX\nYond\nKeep me'); expect(field.querySelector('#untouched')).toBe(untouched);
});

it.each(['', '<br>', '<p><br></p>', '<p>existing</p>'])('inserts visible line breaks including a trailing blank line: %s', async markup => {
  const field = editor(markup);
  await controller.execute({ operation: 'cursor_end' });
  expect((await controller.execute({ operation: 'type', text: 'one\ntwo\n' })).ok).toBe(true);
  expect(fieldText(field)).toBe((markup.includes('existing') ? 'existing' : '') + 'one\ntwo\n');
  expect(field.querySelectorAll('br').length).toBeGreaterThanOrEqual(3);
});

it('undoes a cross-paragraph dictation with exact DOM structure, node identities, and selection', async () => {
  const field = editor('<p id="first">Hello <strong>bright</strong></p><p id="second">new <em>world</em></p><p>Keep</p>');
  const markup = field.innerHTML; const first = field.querySelector('#first'); const second = field.querySelector('#second'); const strong = field.querySelector('strong'); const clicked = vi.fn(); strong!.addEventListener('click', clicked);
  await controller.execute({ operation: 'select_text', query: 'bright\nnew' });
  const selection = textSelection(field); const session = await controller.execute({ operation: 'dictate_start' });
  expect((await controller.dictate('quiet new paragraph wide', session.token)).ok).toBe(true);
  expect(fieldText(field)).toBe('Hello quiet\n\nwide world\nKeep');
  expect((await controller.dictate('scratch that', session.token)).ok).toBe(true);
  expect(field.innerHTML).toBe(markup); expect(field.querySelector('#first')).toBe(first); expect(field.querySelector('#second')).toBe(second); expect(field.querySelector('strong')).toBe(strong); expect(textSelection(field)).toEqual(selection);
  (strong as HTMLElement).click(); expect(clicked).toHaveBeenCalledOnce();
});

it('keeps a final dictated empty line visible after replacing formatted paragraphs', async () => {
  const field = editor('<p>Hello <strong>bright</strong></p><p>new <em>world</em></p>'); const markup = field.innerHTML;
  await controller.execute({ operation: 'select_all' }); const started = await controller.execute({ operation: 'dictate_start' });
  expect((await controller.dictate('one new line two new paragraph three new line', started.token)).ok).toBe(true);
  expect(fieldText(field)).toBe('one\ntwo\n\nthree\n'); expect(field.querySelectorAll('br')).toHaveLength(5);
  expect((await controller.dictate('scratch that', started.token)).ok).toBe(true); expect(field.innerHTML).toBe(markup);
});

it('places the caret around a unique Unicode phrase without mutating text or crossing protected content', async () => {
  const field = editor('<p>İstanbul café</p><p>🐈 next</p><span contenteditable="false">protected</span>');
  expect((await controller.execute({ operation: 'cursor_before', query: '🐈' })).ok).toBe(true); expect(textSelection(field)).toMatchObject({ start: 14, end: 14 });
  expect((await controller.execute({ operation: 'cursor_after', query: 'CAFÉ' })).ok).toBe(true); expect(textSelection(field)).toMatchObject({ start: 13, end: 13 });
  const markup = field.innerHTML;
  expect((await controller.execute({ operation: 'cursor_before', query: 'protected' })).ok).toBe(false); expect(field.innerHTML).toBe(markup);
});

it.each(['a<br>b', '<p>a</p><p>b</p>', '<div>a</div><div><br></div><div>b</div>', '<p><br></p><p>b</p>', '<p>a</p><p><br></p>', '<p>a</p><p><strong></strong>b</p>', '\n  <p>a</p>\n  <p>b</p>\n'])('edits every logical range without losing line boundaries: %s', async markup => {
  const value = fieldText(editor(markup));
  for (let start = 0; start <= value.length; start++) for (let end = start; end <= value.length; end++) {
    const field = editor(markup); expect(selectTextRange(field, { start, end })).toBe(true);
    const result = await controller.execute({ operation: 'type', text: 'X\nY' });
    expect({ start, end, result: result.ok, text: fieldText(field) }).toEqual({ start, end, result: true, text: value.slice(0, start) + 'X\nY' + value.slice(end) });
  }
});

it('refuses undo when identical markup has been replaced with different nodes', async () => {
  const field = editor('<p>original</p>'); await controller.execute({ operation: 'cursor_end' });
  const started = await controller.execute({ operation: 'dictate_start' }); await controller.dictate('added', started.token);
  const selection = textSelection(field)!; const markup = field.innerHTML; field.innerHTML = markup; selectTextRange(field, selection);
  expect((await controller.dictate('scratch that', started.token)).ok).toBe(false); expect(field.innerHTML).toBe(markup);
});

it('keeps a native field readonly if the editor changes it during undo beforeinput', async () => {
  document.body.innerHTML = '<textarea>old</textarea>'; const field = document.querySelector('textarea')!; field.focus(); field.setSelectionRange(3, 3);
  const started = await controller.execute({ operation: 'dictate_start' }); await controller.dictate('new', started.token);
  field.addEventListener('beforeinput', () => { field.readOnly = true; }, { once: true });
  expect((await controller.dictate('scratch that', started.token)).ok).toBe(false); expect(field.value).toBe('old new');
});

it('restores inline attributes affected by a successful editor update', async () => {
  const field = editor('<p><strong class="original">old</strong></p>'); const markup = field.innerHTML;
  await controller.execute({ operation: 'cursor_end' });
  field.addEventListener('input', () => { field.querySelector('strong')!.className = 'updated'; }, { once: true });
  const started = await controller.execute({ operation: 'dictate_start' });
  expect((await controller.dictate('new', started.token)).ok).toBe(true);
  expect((await controller.dictate('scratch that', started.token)).ok).toBe(true); expect(field.innerHTML).toBe(markup);
});

it('leaves selection and protected fields alone when caret phrases are ambiguous or unavailable', async () => {
  document.body.innerHTML = '<textarea>cat cat</textarea><input type="password" value="secret"><textarea readonly>private</textarea>';
  const field = document.querySelector('textarea')!; field.focus(); field.setSelectionRange(1, 2);
  for (const operation of ['cursor_before', 'cursor_after'] as const) {
    expect((await controller.execute({ operation, query: 'cat' })).ok).toBe(false); expect([field.selectionStart, field.selectionEnd]).toEqual([1, 2]);
    for (const protectedField of document.querySelectorAll('input, textarea[readonly]')) { (protectedField as HTMLElement).focus(); expect((await controller.execute({ operation, query: 'secret' })).ok).toBe(false); }
    field.focus(); field.setSelectionRange(1, 2);
  }
});

it('refuses an oversized result before dispatching input or changing a near-limit editor', async () => {
  const field = editor('x'.repeat(999_999)); await controller.execute({ operation: 'cursor_end' });
  const beforeInput = vi.fn(); const input = vi.fn(); field.addEventListener('beforeinput', beforeInput); field.addEventListener('input', input);
  expect(await controller.execute({ operation: 'type', text: 'ADDED' })).toMatchObject({ ok: false, text: expect.stringContaining('size limit') });
  expect(fieldText(field)).toHaveLength(999_999); expect(beforeInput).not.toHaveBeenCalled(); expect(input).not.toHaveBeenCalled();
  expect((await controller.execute({ operation: 'clear' })).ok).toBe(true); expect(fieldText(field)).toBe('');
});

it('counts raw formatting characters when rejecting growth past the text budget', async () => {
  const field = editor(`\n<p>${'x'.repeat(999_997)}</p>\n`); await controller.execute({ operation: 'cursor_end' });
  const before = field.innerHTML; const beforeInput = vi.fn(); field.addEventListener('beforeinput', beforeInput);
  expect((await controller.execute({ operation: 'type', text: 'XY' })).ok).toBe(false); expect(beforeInput).not.toHaveBeenCalled(); expect(field.innerHTML).toBe(before);
});

it.each(['hidden', 'inert', 'aria-hidden="true"', 'style="display:none"', 'style="visibility:hidden"', 'contenteditable="false"'])('treats %s subtrees as edit barriers, even when empty', async attributes => {
  for (const content of ['hidden', '']) {
    const field = editor(`a<span ${attributes}>${content}</span>b`); const markup = field.innerHTML;
    expect((await controller.execute({ operation: 'replace_text', query: content ? 'hidden' : 'ab', text: 'changed' })).ok).toBe(false);
    expect((await controller.execute({ operation: 'clear' })).ok).toBe(false); expect(field.innerHTML).toBe(markup);
    expect((await controller.execute({ operation: 'replace_text', query: 'a', text: 'A' })).ok).toBe(true);
    expect(field.querySelector('span')!.textContent).toBe(content);
  }
});

it('rechecks external stylesheet protection after beforeinput and before undo', async () => {
  const field = editor('<span class="target">original</span>'); const style = document.createElement('style'); document.head.append(style);
  try {
    field.addEventListener('beforeinput', () => { style.textContent = '.target { visibility: hidden }'; }, { once: true });
    expect((await controller.execute({ operation: 'replace_text', query: 'original', text: 'changed' })).ok).toBe(false); expect(field.textContent).toBe('original');
    style.textContent = ''; await controller.execute({ operation: 'cursor_end' }); const started = await controller.execute({ operation: 'dictate_start' }); await controller.dictate('new', started.token);
    field.addEventListener('beforeinput', () => { style.textContent = '.target { visibility: hidden }'; }, { once: true });
    expect((await controller.dictate('scratch that', started.token)).ok).toBe(false); expect(field.textContent).toBe('original new');
  } finally { style.remove(); }
});

it.each(['moved', 'detached-text', 'detached-attribute', 'during-beforeinput'] as const)('refuses to reclaim original nodes that the page reused: %s', async mode => {
  const field = editor('<p id="first">first</p><p id="second">second</p><p>third</p>'); const retired = field.querySelector<HTMLElement>('#second')!; const originalText = retired.firstChild!;
  const outside = document.createElement('aside'); document.body.append(outside);
  await controller.execute({ operation: 'select_all' }); const started = await controller.execute({ operation: 'dictate_start' }); await controller.dictate('replacement', started.token);
  const change = (): void => {
    if (mode === 'moved' || mode === 'during-beforeinput') { outside.append(retired); retired.textContent = 'reused elsewhere'; }
    else if (mode === 'detached-text') originalText.textContent = 'new detached data';
    else retired.setAttribute('data-new-state', 'keep');
  };
  if (mode === 'during-beforeinput') field.addEventListener('beforeinput', change, { once: true }); else change();
  expect((await controller.dictate('scratch that', started.token)).ok).toBe(false); expect(fieldText(field)).toBe('replacement');
  if (mode === 'moved' || mode === 'during-beforeinput') expect(outside.textContent).toBe('reused elsewhere');
  if (mode === 'detached-text') expect(originalText.textContent).toBe('new detached data');
  if (mode === 'detached-attribute') expect(retired.getAttribute('data-new-state')).toBe('keep');
});

it.each([100, 200, 400])('uses linear style work without subtree text reads at editor depth %i', depth => {
  const host = editor(''); const branches = 8;
  for (let branch = 0; branch < branches; branch++) {
    let current = host;
    for (let level = 0; level < depth; level++) { const child = document.createElement('span'); current.append(child); current = child; }
    current.append(document.createTextNode('x'));
  }
  const style = vi.spyOn(window, 'getComputedStyle').mockReturnValue({ display: 'inline', whiteSpace: 'normal' } as CSSStyleDeclaration);
  const subtreeText = vi.spyOn(HTMLElement.prototype, 'textContent', 'get');
  expect(editableText(host).text).toBe('x'.repeat(branches));
  expect(style.mock.calls.length).toBeLessThanOrEqual(2 * (1 + branches * depth));
  expect(subtreeText).not.toHaveBeenCalled();
});

it('bounds wide, deep, and hidden oversized editor trees before mutating them', () => {
  const host = editor('');
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({ display: 'inline', whiteSpace: 'normal' } as CSSStyleDeclaration);
  // The width guard must fire before inspecting or allocating the child list.
  const children = vi.spyOn(host, 'childNodes', 'get').mockReturnValue({ length: 50_000 } as NodeListOf<ChildNode>);
  expect(() => editableText(host)).toThrow('too large'); children.mockRestore(); expect(host.childNodes.length).toBe(0);
  let current = host;
  for (let depth = 0; depth < 513; depth++) { const child = document.createElement('span'); current.append(child); current = child; }
  current.append('keep'); expect(() => editableText(host)).toThrow('too large'); expect(current.textContent).toBe('keep');
  host.innerHTML = `<span hidden>${'x'.repeat(1_000_001)}</span>`;
  expect(() => editableText(host)).toThrow('too large'); expect(host.firstChild!.textContent).toHaveLength(1_000_001);
});

it.each([
  ['<div>a<p>b</p>c</div>', 0, 2],
  ['<div>a<p>b</p>c</div>', 2, 4],
  ['<div><p>a</p>b<p>c</p></div>', 0, 2],
  ['<div><p>a</p>b<p>c</p></div>', 2, 4],
  ['<div>a<div>b</div>c</div>', 0, 2],
  ['<div>a<div>b</div>c</div>', 2, 4],
  ['<div><span>a</span><p>b</p><span>c</span></div>', 0, 2],
  ['<div><span>a</span><p>b</p><span>c</span></div>', 2, 4],
  ['a<p>b</p>c', 0, 2],
  ['a<p>b</p>c', 2, 4],
  ['<p>a</p>b<p>c</p>', 0, 2],
  ['<p>a</p>b<p>c</p>', 2, 4],
  ['a<div><p>b</p></div>', 0, 2],
  ['<div><p>a</p></div>b', 0, 2],
] as const)('refuses nested parent/child paragraph joins before changing text: %s [%i,%i]', async (markup, start, end) => {
  const field = editor(markup); const nodes = Array.from(field.querySelectorAll('*')); const value = fieldText(field);
  selectTextRange(field, { start, end }); const selection = textSelection(field); const input = vi.fn(); field.addEventListener('input', input);
  expect(await controller.execute({ operation: 'type', text: 'X\nY' })).toMatchObject({ ok: false, text: expect.stringContaining('nested paragraphs') });
  expect(field.innerHTML).toBe(markup); expect(fieldText(field)).toBe(value); expect(textSelection(field)).toEqual(selection);
  expect(Array.from(field.querySelectorAll('*'))).toEqual(nodes); expect(input).not.toHaveBeenCalled();
});

it.each([['<div>a<p>b</p>c</div>', 0], ['<div>a<p>b</p>c</div>', 2], ['a<p>b</p>c', 0], ['a<p>b</p>c', 2]] as const)('keeps nested text intact when a refused dictation join starts in %s at %i', async (markup, start) => {
  const field = editor(markup); selectTextRange(field, { start, end: start + 2 });
  const started = await controller.execute({ operation: 'dictate_start' });
  expect(await controller.dictate('replacement', started.token)).toMatchObject({ ok: false, dictating: false });
  expect(field.innerHTML).toBe(markup);
  expect((await controller.dictate('scratch that', started.token)).ok).toBe(false); expect(field.innerHTML).toBe(markup);
});

it.each(['<div>a<p>b</p>c</div>', 'a<p>b</p>c'])('preserves caret edits and whole-field replacement inside nested paragraphs: %s', async markup => {
  const value = 'a\nb\nc';
  for (let offset = 0; offset <= value.length; offset++) {
    const field = editor(markup); selectTextRange(field, { start: offset, end: offset });
    expect((await controller.execute({ operation: 'type', text: 'X' })).ok).toBe(true);
    expect(fieldText(field)).toBe(value.slice(0, offset) + 'X' + value.slice(offset));
  }
  const field = editor(markup);
  expect((await controller.execute({ operation: 'fill', text: 'Replacement' })).ok).toBe(true); expect(fieldText(field)).toBe('Replacement');
  expect((await controller.execute({ operation: 'clear' })).ok).toBe(true); expect(fieldText(field)).toBe('');
});
