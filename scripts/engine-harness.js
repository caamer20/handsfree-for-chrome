// Browser integration harness: real built offscreen engine, simulated runtime transport.
// No privileged Chrome action is executed. Never included in the extension package.
const engineListeners = new Set();
if (new URLSearchParams(location.search).has('cpu')) Object.defineProperty(navigator, 'gpu', { value: undefined });
globalThis.chrome = { runtime: {
  id: 'handsfree-test',
  getURL: path => `${location.origin}/${path}`,
  onMessage: { addListener: fn => engineListeners.add(fn), removeListener: fn => engineListeners.delete(fn) },
  sendMessage: async message => {
    const output = document.getElementById('engine-output');
    if (output) output.textContent += `${JSON.stringify(message)}\n`;
    return { ok: true };
  },
} };
document.addEventListener('DOMContentLoaded', () => {
  const main = document.createElement('main');
  const title = document.createElement('h1'); title.textContent = 'HandsFree browser engine test';
  const description = document.createElement('p'); description.textContent = `Real offscreen code, simulated Chrome transport. Cross-origin isolated: ${crossOriginIsolated}. GPU available: ${!!navigator.gpu}. No browser actions will execute.`;
  const input = document.createElement('input'); input.id = 'engine-command'; input.setAttribute('aria-label', 'Test command'); input.value = 'Open a new tab';
  const run = document.createElement('button'); run.textContent = 'Run engine test';
  const output = document.createElement('pre'); output.id = 'engine-output'; output.setAttribute('aria-live', 'polite');
  run.onclick = () => {
    output.textContent = '';
    const message = { target: 'offscreen', type: 'PARSE_TEXT', requestId: crypto.randomUUID(), text: input.value, settings: { mode: 'power-saver', triggerPhrase: '', language: 'en-US', aiEnabled: true, saveTranscripts: false, micGranted: false } };
    engineListeners.forEach(fn => fn(message, { id: 'handsfree-test', url: `${location.origin}/background.js` }, reply => { output.textContent += `Acknowledged: ${JSON.stringify(reply)}\n`; }));
  };
  main.append(title, description, input, run, output); document.body.append(main);
});
