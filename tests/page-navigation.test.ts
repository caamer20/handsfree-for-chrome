// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PageController } from '../src/content/page-controller';
import { findPageText, pageElements } from '../src/content/page-navigation';

let controller: PageController;
beforeEach(() => {
  document.body.innerHTML = '';
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 10, y: 10, top: 10, left: 10, right: 200, bottom: 50, width: 190, height: 40, toJSON: () => ({}) });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  controller = new PageController(document);
});
afterEach(() => { controller.destroy(); vi.restoreAllMocks(); });

it('lists native and ARIA headings and focuses numbered destinations without clicking links', async () => {
  document.body.innerHTML = '<h1>Welcome</h1><h2><a href="#danger">Pricing</a></h2><div role="heading" aria-level="3">Details</div><h2 hidden>Hidden</h2><h2 role="button">Not a heading</h2>';
  const click = vi.fn(); document.querySelector('h2')!.addEventListener('click', click);
  const listed = await controller.execute({ operation: 'show_headings' });
  expect(listed.choices?.map(choice => choice.label)).toEqual(['Heading 1: Welcome', 'Heading 2: Pricing', 'Heading 3: Details']);
  expect(await controller.execute({ operation: 'activate', index: 2 }, listed.token)).toMatchObject({ ok: true, text: 'Heading 2: Pricing' });
  expect(document.activeElement).toBe(document.querySelector('h2')); expect(click).not.toHaveBeenCalled();
  expect((await controller.execute({ operation: 'activate', index: 2, new_tab: true }, listed.token)).ok).toBe(false);
});

it('supports show-heading choice continuations and rejects stale kind, role, label, and level changes', async () => {
  document.body.innerHTML = '<h2>Pricing</h2><h2>Details</h2>';
  const listed = await controller.execute({ operation: 'show_headings' });
  expect((await controller.execute({ operation: 'show_headings', index: 2 }, listed.token)).ok).toBe(true);
  expect((await controller.execute({ operation: 'go_landmark', index: 1 }, listed.token)).ok).toBe(false);
  const first = document.querySelector('h2')!;
  first.setAttribute('aria-level', '3'); expect((await controller.execute({ operation: 'activate', index: 1 }, listed.token)).ok).toBe(false);
  first.removeAttribute('aria-level'); first.textContent = 'Changed'; expect((await controller.execute({ operation: 'activate', index: 1 }, listed.token)).ok).toBe(false);
  first.textContent = 'Pricing'; first.setAttribute('role', 'button'); expect((await controller.execute({ operation: 'activate', index: 1 }, listed.token)).ok).toBe(false);
});

it('clarifies duplicate heading names without moving, and chooses the requested indexed match', async () => {
  document.body.innerHTML = '<input><h2>Overview</h2><h3>Overview</h3>'; document.querySelector('input')!.focus();
  const choice = await controller.execute({ operation: 'go_heading', query: 'overview' }); expect(choice.choices).toHaveLength(2); expect(document.activeElement?.tagName).toBe('INPUT');
  expect((await controller.execute({ operation: 'go_heading', query: 'overview', index: 2 }, choice.token)).ok).toBe(true); expect(document.activeElement?.tagName).toBe('H3');
});

it('navigates headings in order, wraps, and recomputes available targets after removal', async () => {
  document.body.innerHTML = '<h1>First</h1><h2>Second</h2><h2>Third</h2>';
  expect((await controller.execute({ operation: 'next_heading' })).text).toContain('1 of 3');
  expect((await controller.execute({ operation: 'next_heading' })).text).toContain('2 of 3');
  expect((await controller.execute({ operation: 'previous_heading' })).text).toContain('1 of 3');
  expect((await controller.execute({ operation: 'previous_heading' })).text).toContain('3 of 3. Heading 2: Third (wrapped)');
  document.querySelectorAll('h2')[1]!.remove();
  expect((await controller.execute({ operation: 'next_heading' })).text).toContain('1 of 2');
});

it('restores temporary tabindex while preserving existing or subsequently changed values', async () => {
  document.body.innerHTML = '<h2>Temporary</h2><h3 tabindex="2">Existing</h3><input>';
  const heading = document.querySelector('h2')!;
  await controller.execute({ operation: 'go_heading', query: 'Temporary' }); expect(heading.getAttribute('tabindex')).toBe('-1');
  document.querySelector('input')!.focus(); expect(heading.hasAttribute('tabindex')).toBe(false);
  await controller.execute({ operation: 'go_heading', query: 'Existing' }); document.querySelector('input')!.focus(); expect(document.querySelector('h3')!.getAttribute('tabindex')).toBe('2');
  await controller.execute({ operation: 'go_heading', query: 'Temporary' }); heading.setAttribute('tabindex', '3'); controller.destroy(); expect(heading.getAttribute('tabindex')).toBe('3');
});

it('recognizes landmark semantics without exposing all region contents as labels', async () => {
  document.body.innerHTML = '<header>Site header</header><nav aria-label="Primary">Private menu text</nav><main><h1>Article</h1><header>Article header</header><section>Unlabelled content</section><section aria-label="Details">Many words here</section><form>Private form contents</form><form aria-label="Subscribe"><input></form></main><aside>Side text</aside><footer>Copyright text</footer>';
  const listed = await controller.execute({ operation: 'show_landmarks' });
  expect(listed.choices?.map(choice => choice.label)).toEqual(['Banner', 'Navigation: Primary', 'Main content', 'Region: Details', 'Form: Subscribe', 'Complementary content', 'Footer']);
  expect(JSON.stringify(listed)).not.toMatch(/Private|Many words|Copyright text/);
  expect((await controller.execute({ operation: 'go_landmark', query: 'main' })).ok).toBe(true); expect(document.activeElement?.tagName).toBe('MAIN');
  expect((await controller.execute({ operation: 'next_landmark' })).text).toContain('Region: Details');
  expect((await controller.execute({ operation: 'previous_landmark' })).text).toContain('Main content');
});

it('keeps landmark numbers valid when ordinary contents change but refuses a semantic name change', async () => {
  document.body.innerHTML = '<main aria-label="Article"><p>Old text</p></main>';
  const listed = await controller.execute({ operation: 'show_landmarks' }); document.querySelector('p')!.textContent = 'New text';
  expect((await controller.execute({ operation: 'show_landmarks', index: 1 }, listed.token)).ok).toBe(true);
  document.querySelector('main')!.setAttribute('aria-label', 'Different article'); expect((await controller.execute({ operation: 'activate', index: 1 }, listed.token)).ok).toBe(false);
});

it('uses open shadow and slot reading order, with root-local accessible names', async () => {
  document.body.innerHTML = '<span id="title">Wrong</span><div id="host"><h2 slot="middle">Slotted</h2></div><h2>After</h2>';
  const host = document.querySelector<HTMLElement>('#host')!;
  host.attachShadow({ mode: 'open' }).innerHTML = '<span id="title">Shadow label</span><h1 aria-labelledby="title" aria-label="Lower priority">Before</h1><slot name="middle"></slot><h2>Last shadow</h2>';
  expect((await controller.execute({ operation: 'show_headings' })).choices?.map(choice => choice.label)).toEqual(['Heading 1: Shadow label', 'Heading 2: Slotted', 'Heading 2: Last shadow', 'Heading 2: After']);
});

it('retains visible shadow controls under display-contents hosts but respects inert ancestors', async () => {
  document.body.innerHTML = '<div id="host" style="display:contents"></div>';
  const host = document.querySelector<HTMLElement>('#host')!; host.attachShadow({ mode: 'open' }).innerHTML = '<h2>Shadow heading</h2><button>Shadow button</button>';
  Object.defineProperty(host, 'getBoundingClientRect', { value: () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }) });
  expect((await controller.execute({ operation: 'show_headings' })).choices).toHaveLength(1); expect((await controller.execute({ operation: 'show_links' })).choices).toHaveLength(1);
  host.setAttribute('inert', ''); expect((await controller.execute({ operation: 'show_headings' })).ok).toBe(false); expect((await controller.execute({ operation: 'show_links' })).choices).toEqual([]);
});

it('invalidates prior numbering when switching from headings to links', async () => {
  document.body.innerHTML = '<h2>Overview</h2><button>Action</button>';
  const old = await controller.execute({ operation: 'show_headings' }); await controller.execute({ operation: 'show_links' });
  expect((await controller.execute({ operation: 'activate', index: 1 }, old.token)).ok).toBe(false);
});

it('scrolls the nearest container for the requested axis, including repeated horizontal scrolling', async () => {
  document.body.innerHTML = '<div id="vertical" style="overflow-y:auto"><div id="horizontal" style="overflow-x:auto;overflow-y:hidden"><button>Inside</button></div></div>';
  const vertical = document.querySelector<HTMLElement>('#vertical')!; const horizontal = document.querySelector<HTMLElement>('#horizontal')!;
  for (const [element, dimensions] of [[vertical, { scrollHeight: 1000, clientHeight: 300, scrollWidth: 500, clientWidth: 500 }], [horizontal, { scrollHeight: 50, clientHeight: 50, scrollWidth: 1500, clientWidth: 500 }]] as const) {
    for (const [property, value] of Object.entries(dimensions)) Object.defineProperty(element, property, { configurable: true, value });
    element.scrollBy = vi.fn();
  }
  document.querySelector('button')!.focus();
  await controller.execute({ operation: 'scroll', direction: 'right', amount: 'half' }); expect(horizontal.scrollBy).toHaveBeenLastCalledWith({ top: 0, left: 250, behavior: 'smooth' }); expect(vertical.scrollBy).not.toHaveBeenCalled();
  await controller.execute({ operation: 'scroll', amount: 'repeat' }); expect(horizontal.scrollBy).toHaveBeenCalledTimes(2);
  await controller.execute({ operation: 'scroll', direction: 'down', amount: 'little' }); expect(vertical.scrollBy).toHaveBeenCalledWith({ top: 75, left: 0, behavior: 'smooth' });
});

it('finds phrases across inline markup and collapsed whitespace with original Unicode offsets', async () => {
  document.body.innerHTML = '<p>İstanbul Pricing <strong>for</strong>\n\t teams and café 🐈</p>';
  expect(await controller.execute({ operation: 'find', query: 'pricing for teams' })).toMatchObject({ ok: true, text: 'Match 1 of 1' }); expect(window.getSelection()!.toString()).toBe('Pricing for\n\t teams');
  expect((await controller.execute({ operation: 'find', query: 'CAFÉ 🐈' })).ok).toBe(true); expect(window.getSelection()!.toString()).toBe('café 🐈');
});

it('does not find phrases across block or line-break boundaries or inside editable/private controls', async () => {
  document.body.innerHTML = '<p>alpha</p><p>beta</p><p>gamma<br>delta</p><textarea>private draft</textarea><select><option>private choice</option></select><div contenteditable="true">private note</div><div role="textbox">private editor</div><p hidden>private hidden</p><div id="handsfree-chrome-hud-root">private hud</div>';
  for (const query of ['alpha beta', 'gamma delta', 'private']) expect((await controller.execute({ operation: 'find', query })).ok).toBe(false);
});

it('finds text in open shadow roots without spanning separate roots', async () => {
  document.body.innerHTML = '<p>outside <span id="host"></span> tail</p>';
  const host = document.querySelector<HTMLElement>('#host')!; host.attachShadow({ mode: 'open' }).innerHTML = '<p>shadow <strong>phrase</strong></p>';
  expect((await controller.execute({ operation: 'find', query: 'shadow phrase' })).ok).toBe(true); expect(window.getSelection()!.toString()).toBe('shadow phrase');
  expect((await controller.execute({ operation: 'find', query: 'outside shadow' })).ok).toBe(false);
});

it('excludes hidden SVG text and revalidates SVG visibility for saved matches', async () => {
  document.body.innerHTML = '<svg aria-hidden="true"><text>hidden vector text</text></svg><svg><text id="visible-vector">visible vector text</text></svg><svg style="display:none"><text>display none text</text></svg>';
  expect((await controller.execute({ operation: 'find', query: 'hidden vector text' })).ok).toBe(false);
  expect((await controller.execute({ operation: 'find', query: 'display none text' })).ok).toBe(false);
  expect((await controller.execute({ operation: 'find', query: 'visible vector text' })).ok).toBe(true); expect(window.getSelection()!.toString()).toBe('visible vector text');
  document.querySelector('#visible-vector')!.setAttribute('aria-hidden', 'true');
  expect((await controller.execute({ operation: 'find_next' })).ok).toBe(false);
});

it('does not manufacture empty ranges from slots whose rendered order differs from DOM order', async () => {
  document.body.innerHTML = '<div id="host"><span slot="a">Alpha</span><span slot="b">Beta</span></div>';
  document.querySelector('#host')!.attachShadow({ mode: 'open' }).innerHTML = '<slot name="b"></slot><slot name="a"></slot>';
  expect((await controller.execute({ operation: 'find', query: 'BetaAlpha' })).ok).toBe(false);
  expect((await controller.execute({ operation: 'find', query: 'Beta' })).ok).toBe(true); expect(window.getSelection()!.toString()).toBe('Beta');
  expect((await controller.execute({ operation: 'find', query: 'Alpha' })).ok).toBe(true); expect(window.getSelection()!.toString()).toBe('Alpha');
});

it('removes stale find matches after text or visibility changes', async () => {
  document.body.innerHTML = '<p>one match</p><p>second match</p>';
  await controller.execute({ operation: 'find', query: 'match' }); document.querySelector('p')!.textContent = 'changed text';
  expect((await controller.execute({ operation: 'find_next' })).text).toBe('Match 1 of 1');
  document.querySelectorAll('p')[1]!.hidden = true; expect((await controller.execute({ operation: 'find_next' })).ok).toBe(false);
});

it('bounds indexed text and result counts on long pages', () => {
  document.body.innerHTML = '<p>match match match match match</p>';
  expect(findPageText(document, 'match', () => true, 10, 50)).toHaveLength(1);
  expect(findPageText(document, 'match', () => true, 1000, 2)).toHaveLength(2);
});

it('walks extremely deep markup iteratively without overflowing the call stack', () => {
  document.body.innerHTML = '<div>'.repeat(6000) + '</div>'.repeat(6000);
  const chain: Element[] = []; let element = document.body.firstElementChild;
  while (element) { chain.push(element); element = element.firstElementChild; }
  try {
    expect(pageElements(document, () => false, { maxDepth: 10_000, maxNodes: 10_000 }).length).toBeGreaterThanOrEqual(6000);
    const limited = vi.fn(); expect(pageElements(document, () => false, { maxDepth: 20, onLimit: limited }).length).toBeLessThan(30); expect(limited).toHaveBeenCalledOnce();
  } finally {
    // Happy DOM's own recursive teardown cannot dispose a 6000-deep tree.
    for (let index = chain.length - 1; index >= 0; index--) chain[index]!.remove();
  }
});

it('limits empty-node traversal independently of the accepted text budget', () => {
  document.body.innerHTML = '<div>' + '<span></span>'.repeat(1000) + '</div>';
  const readable = vi.fn(() => true); const limited = vi.fn();
  expect(findPageText(document, 'missing', readable, 1, 1, { maxNodes: 50, onLimit: limited })).toEqual([]);
  expect(readable.mock.calls.length).toBeLessThanOrEqual(50); expect(limited).toHaveBeenCalledOnce();
  const elementsLimited = vi.fn(); const elements = pageElements(document, () => false, { maxNodes: 50, onLimit: elementsLimited });
  expect(elements.length).toBeGreaterThan(0); expect(elements.length).toBeLessThanOrEqual(50); expect(elementsLimited).toHaveBeenCalledOnce();
});

it('stops reading later blocks after enough matches are found', () => {
  document.body.innerHTML = '<p>match</p>'.repeat(1000);
  const readable = vi.fn(() => true); const limited = vi.fn();
  expect(findPageText(document, 'match', readable, 1_000_000, 2, { onLimit: limited })).toHaveLength(2);
  expect(readable.mock.calls.length).toBeLessThan(10); expect(limited).toHaveBeenCalledOnce();
});

it('bounds dense text segments while preserving original match offsets', () => {
  document.body.innerHTML = '<p>' + 'match '.repeat(6000) + '</p>';
  const limited = vi.fn(); const matches = findPageText(document, 'match', () => true, 1_000_000, 500, { onLimit: limited });
  expect(matches).toHaveLength(500); expect(matches[0]!.range.startOffset).toBe(0); expect(matches[499]!.range.startOffset).toBe(499 * 6); expect(limited).toHaveBeenCalledOnce();
  const segmentsLimited = vi.fn(); const capped = findPageText(document, 'match', () => true, 1_000_000, 500, { maxSegments: 10, onLimit: segmentsLimited });
  expect(capped).toHaveLength(5); expect(segmentsLimited).toHaveBeenCalledOnce();
});

it('reports a partial scan when page depth exceeds the supported bound', async () => {
  document.body.innerHTML = '<div>'.repeat(520) + '<h2>Too deeply nested</h2>' + '</div>'.repeat(520);
  expect(await controller.execute({ operation: 'show_headings' })).toMatchObject({ ok: false, text: expect.stringContaining('Only the first part') });
});
