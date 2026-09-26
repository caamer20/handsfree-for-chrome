// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PageController } from '../src/content/page-controller';

let controller: PageController;
beforeEach(() => {
  document.body.innerHTML = '';
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 10, y: 10, top: 10, left: 10, right: 200, bottom: 50, width: 190, height: 40, toJSON: () => ({}) });
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  controller = new PageController(document);
});
afterEach(() => { controller.destroy(); vi.restoreAllMocks(); });
it('labels visible targets, opens a selected URL without clicking, and rejects a changed destination', async () => {
  document.body.innerHTML = '<a href="https://example.com/one">First</a><a href="https://example.com/two">Second</a><button disabled>Disabled</button><button aria-disabled="true">Unavailable</button><button style="display:none">Hidden</button>';
  const shown = await controller.execute({ operation: 'show_links' }); expect(shown.choices?.map(item => item.label)).toEqual(['First', 'Second']);
  expect(await controller.execute({ operation: 'activate', index: 2, new_tab: true }, shown.token)).toMatchObject({ ok: true, url: 'https://example.com/two' });
  document.querySelector('a')!.href = 'https://changed.example/';
  expect(await controller.execute({ operation: 'activate', index: 1 }, shown.token)).toMatchObject({ ok: false });
});
it('asks for a numbered choice before clicking duplicate labels and does not submit during field entry', async () => {
  document.body.innerHTML = '<button>Continue</button><button>Continue</button><form><label>Search<input type="search"></label><button>Submit</button></form>';
  const click = vi.fn(); const submit = vi.fn(event => event.preventDefault());
  document.querySelectorAll('button')[1]!.addEventListener('click', click); document.querySelector('form')!.addEventListener('submit', submit);
  const choice = await controller.execute({ operation: 'activate', query: 'Continue' }); expect(choice.choices).toHaveLength(2); expect(click).not.toHaveBeenCalled();
  await controller.execute({ operation: 'activate', index: 2 }, choice.token); expect(click).toHaveBeenCalledOnce();
  await controller.execute({ operation: 'type', query: 'Search', text: 'black holes' });
  expect(document.querySelector('input')!.value).toBe('black holes'); expect(submit).not.toHaveBeenCalled();
});
it('inserts at the selected text, fires input events, and respects a cancelled beforeinput event', async () => {
  document.body.innerHTML = '<input aria-label="Query" value="hello world">'; const input = document.querySelector('input')!; input.focus(); input.setSelectionRange(6, 11);
  const change = vi.fn(); input.addEventListener('input', change);
  expect(await controller.execute({ operation: 'type', text: 'Chrome' })).toMatchObject({ ok: true }); expect(input.value).toBe('hello Chrome'); expect(change).toHaveBeenCalledOnce();
  input.addEventListener('beforeinput', event => event.preventDefault());
  expect(await controller.execute({ operation: 'type', text: 'blocked' })).toMatchObject({ ok: false }); expect(input.value).toBe('hello Chrome');
});
it('reports a synchronous controlled-editor rejection instead of claiming text was entered', async () => {
  document.body.innerHTML = '<input aria-label="Search" value="original">'; const field = document.querySelector('input')!;
  field.addEventListener('input', () => { field.value = 'original'; });
  expect(await controller.execute({ operation: 'fill', query: 'Search', text: 'replacement' })).toMatchObject({ ok: false, text: expect.stringContaining('rejected') });
  expect(field.value).toBe('original');
});
it('verifies that text survives the editor’s next update before reporting success', async () => {
  document.body.innerHTML = '<input aria-label="Search" value="original">'; const field = document.querySelector('input')!;
  field.addEventListener('input', () => { queueMicrotask(() => { field.value = 'original'; }); });
  expect(await controller.execute({ operation: 'fill', query: 'Search', text: 'replacement' })).toMatchObject({ ok: false, text: expect.stringContaining('rejected') });
});
it('dictates command-like text literally and stops when focus changes', async () => {
  document.body.innerHTML = '<textarea></textarea><input aria-label="Other"><input type="password" aria-label="Password">';
  const field = document.querySelector('textarea')!; field.focus();
  const started = await controller.execute({ operation: 'dictate_start' }); expect(started.dictating).toBe(true);
  expect((await controller.dictate('close all tabs', started.token)).ok).toBe(true); expect(field.value).toBe('close all tabs');
  await controller.dictate('new paragraph keep writing', started.token); expect(field.value).toContain('\n\n');
  document.querySelector('input')!.focus(); expect(await controller.dictate('must not leak', started.token)).toMatchObject({ ok: false, dictating: false }); expect(document.querySelector('input')!.value).toBe('');
  expect(await controller.execute({ operation: 'focus', query: 'Password' })).toMatchObject({ ok: false });
});
it('enters literal text in contenteditable and never interprets it as HTML', async () => {
  document.body.innerHTML = '<div contenteditable="true" aria-label="Editor"></div>';
  const result = await controller.execute({ operation: 'type', query: 'Editor', text: '<img src=x onerror=alert(1)>' }); expect(result.ok).toBe(true);
  expect(document.querySelector('[contenteditable]')!.textContent).toBe('<img src=x onerror=alert(1)>'); expect(document.querySelector('img')).toBeNull();
});
it('finds visible page text and wraps next/previous matches', async () => {
  document.body.innerHTML = '<p>Pricing is clear. Pricing for teams.</p><p hidden>Pricing hidden.</p>';
  expect(await controller.execute({ operation: 'find', query: 'pricing' })).toMatchObject({ text: 'Match 1 of 2' });
  expect(await controller.execute({ operation: 'find_next' })).toMatchObject({ text: 'Match 2 of 2' });
  expect(await controller.execute({ operation: 'find_next' })).toMatchObject({ text: 'Match 1 of 2' });
  expect(await controller.execute({ operation: 'find_previous' })).toMatchObject({ text: 'Match 2 of 2' });
});
it('controls a media player with bounded volume and seek values', async () => {
  document.body.innerHTML = '<video></video>'; const video = document.querySelector('video')!;
  Object.defineProperty(video, 'duration', { configurable: true, value: 120 }); video.currentTime = 30;
  expect((await controller.execute({ operation: 'media_volume', value: 40, relative: false })).ok).toBe(true); expect(video.volume).toBe(0.4);
  await controller.execute({ operation: 'media_seek', value: -10, relative: true }); expect(video.currentTime).toBe(20);
  await controller.execute({ operation: 'media_seek', value: 999, relative: true }); expect(video.currentTime).toBe(120);
});
it('discovers controls in open shadow roots and invalidates old number sets', async () => {
  const host = document.createElement('div'); document.body.append(host); host.attachShadow({ mode: 'open' }).innerHTML = '<button>Shadow action</button>';
  const click = vi.fn(); host.shadowRoot!.querySelector('button')!.addEventListener('click', click);
  const first = await controller.execute({ operation: 'show_links' }); expect(first.choices).toHaveLength(1);
  const second = await controller.execute({ operation: 'show_links' }); expect((await controller.execute({ operation: 'activate', index: 1 }, first.token)).ok).toBe(false);
  expect((await controller.execute({ operation: 'activate', index: 1 }, second.token)).ok).toBe(true); expect(click).toHaveBeenCalledOnce();
});
it('replaces and clears entire fields without submitting, while preserving literal markup', async () => {
  document.body.innerHTML = '<form><input aria-label="Search" value="old words"><button>Go</button></form>';
  const field = document.querySelector('input')!; const submit = vi.fn(); document.querySelector('form')!.addEventListener('submit', submit);
  field.focus(); field.setSelectionRange(4, 9);
  expect((await controller.execute({ operation: 'fill', query: 'Search', text: '<b>new and then close tabs</b>' })).ok).toBe(true);
  expect(field.value).toBe('<b>new and then close tabs</b>'); expect(submit).not.toHaveBeenCalled();
  await controller.execute({ operation: 'clear' }); expect(field.value).toBe('');
});
it('selects field text, deletes only the selection, and refuses to delete without a selection', async () => {
  document.body.innerHTML = '<textarea>hello world</textarea>'; const field = document.querySelector('textarea')!; field.focus();
  field.setSelectionRange(6, 11); await controller.execute({ operation: 'delete_selection' }); expect(field.value).toBe('hello ');
  expect((await controller.execute({ operation: 'delete_selection' })).ok).toBe(false); expect(field.value).toBe('hello ');
  await controller.execute({ operation: 'select_all' }); expect(field.selectionStart).toBe(0); expect(field.selectionEnd).toBe(6);
  await controller.execute({ operation: 'type', text: 'replacement' }); expect(field.value).toBe('replacement');
});
it('fills contenteditable as plain text and selects within that editor only', async () => {
  document.body.innerHTML = '<p>Keep me</p><div contenteditable="true" aria-label="Notes">before <strong>bold</strong></div>';
  await controller.execute({ operation: 'fill', query: 'Notes', text: '<script>literal</script>' });
  const editor = document.querySelector('[contenteditable]')!; expect(editor.textContent).toBe('<script>literal</script>'); expect(editor.children).toHaveLength(0);
  await controller.execute({ operation: 'select_all' }); await controller.execute({ operation: 'delete_selection' }); expect(editor.textContent).toBe(''); expect(document.querySelector('p')!.textContent).toBe('Keep me');
});
it('pauses for duplicate fields and binds replacement to the selected numbered field', async () => {
  document.body.innerHTML = '<input aria-label="Name" value="first"><input aria-label="Name" value="second">';
  const question = await controller.execute({ operation: 'fill', query: 'Name', text: 'Taylor' }); expect(question.choices).toHaveLength(2);
  expect(Array.from(document.querySelectorAll('input')).map(el => el.value)).toEqual(['first', 'second']);
  expect((await controller.execute({ operation: 'fill', query: 'Name', index: 2, text: 'Taylor' }, question.token)).ok).toBe(true);
  expect(Array.from(document.querySelectorAll('input')).map(el => el.value)).toEqual(['first', 'Taylor']);
  document.querySelectorAll('input')[0]!.setAttribute('aria-label', 'Changed');
  expect((await controller.execute({ operation: 'clear', index: 1 }, question.token)).ok).toBe(false);
});
it('never replaces password, disabled, readonly, or hidden fields and respects limits', async () => {
  document.body.innerHTML = '<input type="password" aria-label="Secret" value="keep"><input disabled aria-label="Disabled" value="keep"><textarea readonly aria-label="Read only">keep</textarea><input hidden aria-label="Hidden" value="keep"><input aria-label="Short" maxlength="3" value="abc">';
  for (const query of ['Secret', 'Disabled', 'Read only', 'Hidden', 'Short']) expect((await controller.execute({ operation: 'fill', query, text: 'longer' })).ok).toBe(false);
  expect(Array.from(document.querySelectorAll('input')).map(el => el.value)).toEqual(['keep', 'keep', 'keep', 'abc']);
});
it('chooses a native dropdown option and dispatches exactly one input and change', async () => {
  document.body.innerHTML = '<label>Country<select><option>United States</option><option>Canada</option><option disabled>France</option></select></label>';
  const select = document.querySelector('select')!; const input = vi.fn(); const change = vi.fn(); select.addEventListener('input', input); select.addEventListener('change', change);
  expect((await controller.execute({ operation: 'select_option', query: 'Country', text: 'Canada' })).ok).toBe(true); expect(select.selectedIndex).toBe(1);
  await controller.execute({ operation: 'select_option', query: 'Country', text: 'Canada' }); expect(input).toHaveBeenCalledOnce(); expect(change).toHaveBeenCalledOnce();
  expect((await controller.execute({ operation: 'select_option', query: 'Country', text: 'France' })).ok).toBe(false); expect(select.selectedIndex).toBe(1);
});
it('clarifies duplicate dropdown labels and refuses unavailable or duplicate options', async () => {
  document.body.innerHTML = '<select aria-label="Size"><option>Small</option><option>Large</option></select><select aria-label="Size"><option>Small</option><option>Large</option><option>Large</option></select>';
  const choice = await controller.execute({ operation: 'select_option', query: 'Size', text: 'Large' }); expect(choice.choices).toHaveLength(2);
  expect((await controller.execute({ operation: 'select_option', query: 'Size', index: 2, text: 'Large' }, choice.token)).ok).toBe(false);
  expect((await controller.execute({ operation: 'select_option', query: 'Size', index: 1, text: 'Large' }, choice.token)).ok).toBe(true);
  expect(Array.from(document.querySelectorAll('select')).map(el => el.selectedIndex)).toEqual([1, 0]);
});
it('sets checkbox state idempotently and cannot deselect a radio button', async () => {
  document.body.innerHTML = '<label><input type="checkbox">Remember me</label><label><input type="radio" name="shipping">Express</label><label><input type="radio" name="shipping" checked>Standard</label>';
  const checkbox = document.querySelector('input')!; const change = vi.fn(); checkbox.addEventListener('change', change);
  await controller.execute({ operation: 'check', query: 'Remember me' }); await controller.execute({ operation: 'check', query: 'Remember me' }); expect(checkbox.checked).toBe(true); expect(change).toHaveBeenCalledOnce();
  await controller.execute({ operation: 'uncheck', query: 'Remember me' }); expect(checkbox.checked).toBe(false);
  await controller.execute({ operation: 'check', query: 'Express' }); expect(document.querySelectorAll('input')[1]!.checked).toBe(true);
  expect((await controller.execute({ operation: 'uncheck', query: 'Express' })).ok).toBe(false);
});
it('numbers fields and moves focus without toggling checkboxes or entering passwords', async () => {
  document.body.innerHTML = '<input aria-label="Name"><input type="password" aria-label="Secret"><input disabled aria-label="Disabled"><input aria-label="Opt in" type="checkbox"><select aria-label="Country"><option>Canada</option></select>';
  const shown = await controller.execute({ operation: 'show_fields' }); expect(shown.choices?.map(el => el.label)).toEqual(['Name', 'Opt in', 'Country']);
  await controller.execute({ operation: 'activate', index: 2 }, shown.token); const check = document.querySelectorAll('input')[3]!; expect(document.activeElement).toBe(check); expect(check.checked).toBe(false);
  await controller.execute({ operation: 'next_field' }); expect(document.activeElement?.tagName).toBe('SELECT');
  await controller.execute({ operation: 'next_field' }); expect(document.activeElement?.getAttribute('aria-label')).toBe('Name');
  await controller.execute({ operation: 'previous_field' }); expect(document.activeElement?.tagName).toBe('SELECT');
});
it('honors cancelled replacement and clearing events', async () => {
  document.body.innerHTML = '<textarea aria-label="Notes">keep this</textarea>'; const field = document.querySelector('textarea')!;
  const observed: string[] = []; field.addEventListener('beforeinput', event => { observed.push((event as InputEvent).inputType); event.preventDefault(); });
  for (const operation of ['fill', 'clear'] as const) expect((await controller.execute({ operation, query: 'Notes', text: 'new' })).ok).toBe(false);
  expect(field.value).toBe('keep this'); expect(observed).toEqual(['insertReplacementText', 'deleteContentBackward']);
});

it('does not expose field contents as numbered labels', async () => {
  document.body.innerHTML = '<textarea>private draft</textarea><div contenteditable="true">private note</div><select><option>personal choice</option></select><input value="personal name">';
  const result = await controller.execute({ operation: 'show_fields' });
  expect(result.choices?.map(item => item.label)).toEqual(['Item 1', 'Item 2', 'Item 3', 'Item 4']);
  expect(JSON.stringify(result)).not.toMatch(/private|personal/);
  expect((await controller.execute({ operation: 'activate', index: 1 }, result.token)).ok).toBe(true);
  expect(document.activeElement).toBe(document.querySelector('textarea'));
});
it('rejects invalid numeric text instead of silently clearing the number field', async () => {
  document.body.innerHTML = '<input type="number" aria-label="Quantity" value="12">';
  expect((await controller.execute({ operation: 'fill', query: 'Quantity', text: 'twelve' })).ok).toBe(false);
  expect(document.querySelector('input')!.value).toBe('12');
  expect((await controller.execute({ operation: 'fill', query: 'Quantity', text: '24' })).ok).toBe(true);
  expect(document.querySelector('input')!.value).toBe('24');
});
it('probes field readiness without focusing, changing, or numbering the field', async () => {
  expect(await controller.execute({ operation: 'field_ready', query: 'Search' })).toMatchObject({ ok: true, editable: false });
  document.body.innerHTML = '<input aria-label="Search" value="keep">';
  expect(await controller.execute({ operation: 'field_ready', query: 'Search' })).toMatchObject({ ok: true, editable: true });
  expect(document.querySelector('input')!.value).toBe('keep'); expect(document.activeElement).not.toBe(document.querySelector('input')); expect(document.getElementById('handsfree-page-overlay')).toBeNull();
  document.body.insertAdjacentHTML('beforeend', '<input aria-label="Search">'); expect(await controller.execute({ operation: 'field_ready', query: 'Search' })).toMatchObject({ editable: false, text: expect.stringContaining('Several') });
});

it('spaces dictated text at the caret and replaces selected text without an extra leading space', async () => {
  document.body.innerHTML = '<textarea>hello world</textarea>'; const field = document.querySelector('textarea')!; field.focus();
  const started = await controller.execute({ operation: 'dictate_start' });
  field.setSelectionRange(0, field.value.length);
  expect((await controller.dictate('replacement', started.token)).ok).toBe(true); expect(field.value).toBe('replacement');
  field.setSelectionRange(0, 0); await controller.dictate('before', started.token); expect(field.value).toBe('before replacement');
  field.setSelectionRange(6, 6); await controller.dictate('middle', started.token); expect(field.value).toBe('before middle replacement');
  field.setSelectionRange(field.value.length, field.value.length); await controller.dictate('.', started.token); expect(field.value).toBe('before middle replacement.');
});

it('verifies each dictated chunk and does not run queued text after an editor rejects it', async () => {
  document.body.innerHTML = '<textarea>original</textarea>'; const field = document.querySelector('textarea')!; field.focus(); field.setSelectionRange(8, 8);
  const started = await controller.execute({ operation: 'dictate_start' });
  field.addEventListener('input', () => { queueMicrotask(() => { field.value = 'original'; }); });
  const [first, second] = await Promise.all([controller.dictate('rejected', started.token), controller.dictate('must not continue', started.token)]);
  expect(first).toMatchObject({ ok: false, dictating: false, text: expect.stringContaining('rejected') }); expect(second.ok).toBe(false); expect(field.value).toBe('original');
});

it('serializes accepted dictation chunks and honors a stop before queued work starts', async () => {
  document.body.innerHTML = '<textarea></textarea>'; const field = document.querySelector('textarea')!; field.focus();
  const started = await controller.execute({ operation: 'dictate_start' });
  expect((await Promise.all([controller.dictate('one', started.token), controller.dictate('two', started.token)])).every(result => result.ok)).toBe(true); expect(field.value).toBe('one two');
  const pending = controller.dictate('cancelled', started.token); controller.cancel(); expect((await pending).ok).toBe(false); expect(field.value).toBe('one two');
});

it('undoes only the last dictated insertion and restores the original text selection', async () => {
  document.body.innerHTML = '<textarea>hello world</textarea>'; const field = document.querySelector('textarea')!; field.focus(); field.setSelectionRange(6, 11, 'backward');
  const started = await controller.execute({ operation: 'dictate_start' });
  await controller.dictate('Chrome', started.token); expect(field.value).toBe('hello Chrome');
  expect(await controller.dictate('scratch that', started.token)).toMatchObject({ ok: true, text: 'Last dictation undone' });
  expect(field.value).toBe('hello world'); expect([field.selectionStart, field.selectionEnd, field.selectionDirection]).toEqual([6, 11, 'backward']);
  expect((await controller.dictate('undo last dictation', started.token)).ok).toBe(false); expect(field.value).toBe('hello world');
});

it('keeps manual text or caret changes intact when undoing dictation', async () => {
  document.body.innerHTML = '<textarea></textarea>'; const field = document.querySelector('textarea')!; field.focus();
  const started = await controller.execute({ operation: 'dictate_start' });
  await controller.dictate('spoken', started.token); field.setSelectionRange(0, 0);
  expect((await controller.dictate('scratch that', started.token)).ok).toBe(false); expect(field.value).toBe('spoken');
  const restarted = await controller.execute({ operation: 'dictate_start' });
  field.setSelectionRange(6, 6); await controller.dictate('again', restarted.token); const value = field.value; expect(value).toBe('spoken again');
  field.dispatchEvent(new InputEvent('input', { bubbles: true }));
  expect((await controller.dictate('scratch that', restarted.token)).ok).toBe(false); expect(field.value).toBe(value);
});

it('does not let an older dictation token or a new session undo text', async () => {
  document.body.innerHTML = '<textarea></textarea>'; const field = document.querySelector('textarea')!; field.focus();
  const old = await controller.execute({ operation: 'dictate_start' }); await controller.dictate('keep', old.token);
  const current = await controller.execute({ operation: 'dictate_start' });
  expect((await controller.dictate('scratch that', current.token)).ok).toBe(false); expect(field.value).toBe('keep');
  const newest = await controller.execute({ operation: 'dictate_start' });
  expect((await controller.dictate('extra', old.token)).ok).toBe(false); expect(field.value).toBe('keep');
  expect((await controller.dictate('new session', newest.token)).ok).toBe(true); expect(field.value).toBe('keep new session');
});

it('can dictate reserved phrases literally without line break conversion or undo', async () => {
  document.body.innerHTML = '<textarea></textarea>'; const field = document.querySelector('textarea')!; field.focus();
  const started = await controller.execute({ operation: 'dictate_start' });
  await controller.dictate('literal scratch that', started.token);
  await controller.dictate('literal new paragraph', started.token);
  await controller.dictate('literal stop dictation', started.token);
  expect(field.value).toBe('scratch that new paragraph stop dictation');
  await controller.dictate('undo last dictation', started.token); expect(field.value).toBe('scratch that new paragraph');
});

it('respects cancellation and editor rejection of dictation undo', async () => {
  document.body.innerHTML = '<textarea>old</textarea>'; const field = document.querySelector('textarea')!; field.focus(); field.setSelectionRange(3, 3);
  const started = await controller.execute({ operation: 'dictate_start' }); await controller.dictate('new', started.token);
  field.addEventListener('beforeinput', event => { if ((event as InputEvent).inputType === 'historyUndo') event.preventDefault(); }, { once: true });
  expect((await controller.dictate('scratch that', started.token)).ok).toBe(false); expect(field.value).toBe('old new');
  const restarted = await controller.execute({ operation: 'dictate_start' });
  await controller.dictate('again', restarted.token); const keep = field.value; expect(keep).toBe('old new again');
  field.addEventListener('input', event => { if ((event as InputEvent).inputType === 'historyUndo') queueMicrotask(() => { field.value = keep; }); });
  expect(await controller.dictate('scratch that', restarted.token)).toMatchObject({ ok: false, text: expect.stringContaining('rejected') }); expect(field.value).toBe(keep);
});

it('selects and replaces a unique literal phrase in the focused field without submitting', async () => {
  document.body.innerHTML = '<form><textarea>Try (A+B) and keep the rest.</textarea><button>Send</button></form>';
  const field = document.querySelector('textarea')!; field.focus(); const submit = vi.fn(); document.querySelector('form')!.addEventListener('submit', submit);
  expect((await controller.execute({ operation: 'select_text', query: '(a+b)' })).ok).toBe(true); expect(field.value.slice(field.selectionStart, field.selectionEnd)).toBe('(A+B)');
  expect((await controller.execute({ operation: 'replace_text', query: '(A+B)', text: '<literal>' })).ok).toBe(true); expect(field.value).toBe('Try <literal> and keep the rest.'); expect(submit).not.toHaveBeenCalled();
  await controller.execute({ operation: 'cursor_start' }); expect([field.selectionStart, field.selectionEnd]).toEqual([0, 0]);
  await controller.execute({ operation: 'cursor_end' }); expect([field.selectionStart, field.selectionEnd]).toEqual([field.value.length, field.value.length]);
});

it('refuses missing and ambiguous phrases, including overlapping matches, without changing text or selection', async () => {
  document.body.innerHTML = '<textarea>banana hello HELLO</textarea>'; const field = document.querySelector('textarea')!; field.focus(); field.setSelectionRange(1, 2);
  for (const query of ['ana', 'hello', 'missing']) {
    expect((await controller.execute({ operation: 'replace_text', query, text: 'changed' })).ok).toBe(false);
    expect(field.value).toBe('banana hello HELLO'); expect([field.selectionStart, field.selectionEnd]).toEqual([1, 2]);
  }
});

it('selects text using original Unicode offsets and keeps unrelated editors untouched', async () => {
  document.body.innerHTML = '<textarea>İstanbul café 🐈 done</textarea><textarea>café</textarea>'; const field = document.querySelector('textarea')!; field.focus();
  await controller.execute({ operation: 'replace_text', query: 'CAFÉ', text: 'coffee' }); expect(field.value).toBe('İstanbul coffee 🐈 done'); expect(document.querySelectorAll('textarea')[1]!.value).toBe('café');
});

it('edits across inline text nodes in contenteditable and preserves literal replacement text', async () => {
  document.body.innerHTML = '<div contenteditable="true" aria-label="Notes">before <strong>bold</strong> after</div><p>Keep me</p>';
  const field = document.querySelector<HTMLElement>('[contenteditable]')!; field.focus();
  expect((await controller.execute({ operation: 'select_text', query: 'before bold' })).ok).toBe(true); expect(window.getSelection()!.toString()).toBe('before bold');
  expect((await controller.execute({ operation: 'replace_text', query: 'bold after', text: '<img>' })).ok).toBe(true); expect(field.textContent).toBe('before <img>'); expect(field.querySelector('img')).toBeNull(); expect(document.querySelector('p')!.textContent).toBe('Keep me');
});

it('undoes dictation in plain contenteditable and retains surrounding text', async () => {
  document.body.innerHTML = '<div contenteditable="true">hello world</div>'; const field = document.querySelector<HTMLElement>('[contenteditable]')!; field.focus();
  await controller.execute({ operation: 'select_text', query: 'world' }); const started = await controller.execute({ operation: 'dictate_start' });
  await controller.dictate('friend', started.token); expect(field.textContent).toBe('hello friend');
  expect((await controller.dictate('scratch that', started.token)).ok).toBe(true); expect(field.textContent).toBe('hello world'); expect(window.getSelection()!.toString()).toBe('world');
});

it('refuses selection across noneditable content and fields without native text selection', async () => {
  document.body.innerHTML = '<div contenteditable="true">before <span contenteditable="false">protected</span> after</div><input type="number" value="12"><input type="password" value="secret">';
  const editor = document.querySelector<HTMLElement>('[contenteditable]')!; editor.focus();
  expect((await controller.execute({ operation: 'replace_text', query: 'protected', text: 'changed' })).ok).toBe(false); expect(editor.textContent).toBe('before protected after');
  for (const input of document.querySelectorAll('input')) { input.focus(); expect((await controller.execute({ operation: 'cursor_start' })).ok).toBe(false); }
});

it('verifies phrase replacement and honors cancelled input', async () => {
  document.body.innerHTML = '<textarea>original phrase</textarea>'; const field = document.querySelector('textarea')!; field.focus();
  field.addEventListener('beforeinput', event => event.preventDefault(), { once: true });
  expect((await controller.execute({ operation: 'replace_text', query: 'original', text: 'new' })).ok).toBe(false); expect(field.value).toBe('original phrase');
  field.addEventListener('input', () => queueMicrotask(() => { field.value = 'original phrase'; }));
  expect(await controller.execute({ operation: 'replace_text', query: 'original', text: 'new' })).toMatchObject({ ok: false, text: expect.stringContaining('rejected') });
});

it('excludes disabled fieldset controls but permits controls in its first legend', async () => {
  document.body.innerHTML = '<fieldset disabled><legend><button>Allowed</button><input aria-label="Legend field"></legend><button>Blocked</button><input aria-label="Blocked field"></fieldset>';
  expect((await controller.execute({ operation: 'show_links' })).choices?.map(item => item.label)).toEqual(['Allowed']);
  expect((await controller.execute({ operation: 'show_fields' })).choices?.map(item => item.label)).toEqual(['Legend field']);
  expect((await controller.execute({ operation: 'activate', query: 'Blocked' })).ok).toBe(false);
});

it('revalidates a numbered button when its fieldset becomes disabled', async () => {
  document.body.innerHTML = '<fieldset><button>Continue</button></fieldset>'; const click = vi.fn(); document.querySelector('button')!.addEventListener('click', click);
  const numbered = await controller.execute({ operation: 'show_links' }); document.querySelector('fieldset')!.disabled = true;
  expect((await controller.execute({ operation: 'activate', index: 1 }, numbered.token)).ok).toBe(false); expect(click).not.toHaveBeenCalled();
});

it('resolves accessible labels inside their shadow root and excludes inert shadow hosts', async () => {
  document.body.innerHTML = '<span id="label">Wrong label</span><div id="host"></div>'; const host = document.querySelector<HTMLElement>('#host')!;
  host.attachShadow({ mode: 'open' }).innerHTML = '<span id="label">Shadow action</span><button aria-labelledby="label">Action</button>';
  expect((await controller.execute({ operation: 'show_links' })).choices?.map(item => item.label)).toEqual(['Shadow action']);
  host.setAttribute('inert', ''); expect((await controller.execute({ operation: 'show_links' })).choices).toEqual([]);
});
