import { test, expect, message, state } from './fixtures';
import { ExtensionTarget } from './extension-target';
import { writeFile } from 'node:fs/promises';
import { platform, arch } from 'node:os';

test('records cold/warm command latency and retained engine heap over 20 cycles', async ({ context, control, worker }) => {
  const latency: number[] = [];
  const run = async () => {
    const started = performance.now();
    await message(control, { target: 'background', type: 'RUN_TEXT', text: 'open a new tab' });
    await expect.poll(async () => (await state(control)).hud.phase).toBe('success');
    latency.push(Math.round(performance.now() - started));
    const tab = await worker.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]);
    if (tab?.id && tab.url === 'chrome://newtab/') await worker.evaluate(id => chrome.tabs.remove(id), tab.id);
  };
  await run();
  const engine = await ExtensionTarget.attach(control, '/offscreen.html');
  await engine.send('Performance.enable');
  await engine.send('HeapProfiler.collectGarbage');
  const before = await engine.send<{ usedSize: number }>('Runtime.getHeapUsage');
  for (let cycle = 0; cycle < 20; cycle++) await run();
  await engine.send('HeapProfiler.collectGarbage');
  const after = await engine.send<{ usedSize: number }>('Runtime.getHeapUsage');
  const metrics = await engine.send<{ metrics: { name: string; value: number }[] }>('Performance.getMetrics');
  const warm = latency.slice(1).sort((a, b) => a - b);
  const report = {
    measuredAt: new Date().toISOString(), platform: `${platform()} ${arch()}`, browser: context.browser()?.version(),
    edition: (await state(control)).localAiAvailable ? 'local-ai' : 'standard', input: 'typed open a new tab; real Chrome APIs',
    coldCommandMs: latency[0], warmCommandMs: { samples: warm.length, median: warm[Math.floor(warm.length / 2)], p95: warm[Math.ceil(warm.length * .95) - 1], max: warm.at(-1) },
    engineHeapBytes: { before: before.usedSize, after: after.usedSize, retainedGrowth: after.usedSize - before.usedSize },
    engineTaskDurationSeconds: metrics.metrics.find(metric => metric.name === 'TaskDuration')?.value,
    limitations: 'Synthetic task loop in headless Chrome. Heap is offscreen JavaScript only, not total RSS. Task duration is an engine activity proxy, not battery consumption. No audio/network transcription latency or hardware battery measurement.',
  };
  await writeFile('test-results/performance.json', JSON.stringify(report, null, 2) + '\n');
  expect(after.usedSize - before.usedSize).toBeLessThan(8 * 1024 * 1024);
  await engine.detach();
  await message(control, { target: 'background', type: 'SLEEP_ENGINE' });
  expect((await state(control)).engineOpen).toBe(false);
});
