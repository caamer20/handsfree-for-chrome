import { test, expect, message, state, activateExtension } from './fixtures';
import type { Page } from '@playwright/test';

async function run(control: Page, text: string, phase = 'success'): Promise<void> {
  expect((await message(control, { target: 'background', type: 'RUN_TEXT', text })).ok).toBe(true);
  await expect.poll(async () => { const current = await state(control); return [current.transcript, current.hud.phase]; }).toEqual([text, phase]);
}

test('navigates a page outline and landmarks without activating heading links', async ({ context, control, extensionId }) => {
  await context.route('https://handsfree.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Navigation fixture</title><nav aria-label="Primary"><a href="#pricing">Pricing</a></nav><main><h1>Overview</h1><div style="height:1000px">Intro</div><h2 id="pricing"><a href="/checkout">Pricing</a></h2><p>Plan details</p><h2 id="faq">Questions</h2></main><aside aria-label="Related">Related information</aside>' }));
  const page = await context.newPage(); await page.goto('https://handsfree.test/navigation');
  await activateExtension(page, extensionId); await page.bringToFront();
  await run(control, 'go to the Pricing heading');
  await expect(page.locator('#pricing')).toBeFocused();
  expect(page.url()).toBe('https://handsfree.test/navigation');
  await run(control, 'next heading'); await expect(page.locator('#faq')).toBeFocused();
  await run(control, 'previous heading'); await expect(page.locator('#pricing')).toBeFocused();
  await run(control, 'show page regions', 'clarify');
  const question = (await state(control)).question!;
  const main = question.choices.find(choice => /main/i.test(choice.label)); expect(main).toBeTruthy();
  await message(control, { target: 'background', type: 'ANSWER_CLARIFICATION', questionId: question.id, answer: `choice:${main!.id}` });
  await expect.poll(async () => (await state(control)).question).toBeNull();
  await expect(page.locator('main')).toBeFocused();
  await run(control, 'show headings', 'clarify');
  expect((await state(control)).question?.choices.map(choice => choice.label).join(' ')).toContain('Pricing');
});

test('finds phrases across formatting and scrolls the focused horizontal panel', async ({ context, control, extensionId }) => {
  await context.route('https://handsfree.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Reading fixture</title><p>Pricing <strong>for</strong> teams</p><div id="horizontal" style="width:220px;height:90px;overflow-x:auto;overflow-y:hidden"><div style="width:1200px"><button>Table control</button><span style="margin-left:900px">Last column</span></div></div><div style="height:1800px">Below</div><div id="host" style="display:contents"></div><script>document.querySelector("#host").attachShadow({mode:"open"}).innerHTML = `<h2>Shadow heading</h2>`;</script>' }));
  const page = await context.newPage(); await page.goto('https://handsfree.test/reading');
  await activateExtension(page, extensionId); await page.bringToFront();
  await run(control, 'find Pricing for teams on this page');
  expect(await page.evaluate(() => getSelection()?.toString())).toBe('Pricing for teams');
  await page.getByRole('button', { name: 'Table control' }).focus();
  await run(control, 'scroll right');
  await expect.poll(() => page.locator('#horizontal').evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
  await run(control, 'go to the Shadow heading');
  await expect(page.locator('#host h2')).toBeFocused();
});

test('excludes hidden SVG text and never reports an empty selection across reordered slots', async ({ context, control, extensionId }) => {
  await context.route('https://handsfree.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Find boundaries</title><svg aria-hidden="true" width="320" height="40"><text x="0" y="20">hidden vector text</text></svg><svg width="320" height="40"><text x="0" y="20">visible vector text</text></svg><div id="host"><span slot="a">Alpha</span><span slot="b">Beta</span></div><script>document.querySelector("#host").attachShadow({mode:"open"}).innerHTML = `<slot name="b"></slot><slot name="a"></slot>`;</script>' }));
  const page = await context.newPage(); await page.goto('https://handsfree.test/find-boundaries');
  await activateExtension(page, extensionId); await page.bringToFront();
  await run(control, 'find hidden vector text on this page', 'error');
  await run(control, 'find visible vector text on this page'); expect(await page.evaluate(() => getSelection()?.toString())).toBe('visible vector text');
  await run(control, 'find BetaAlpha on this page', 'error');
  await run(control, 'find Beta on this page'); expect(await page.evaluate(() => getSelection()?.toString())).toBe('Beta');
  expect(await page.evaluate(() => getSelection()?.isCollapsed)).toBe(false);
});
