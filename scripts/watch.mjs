import { watch } from 'node:fs';
import { spawn } from 'node:child_process';
let running = false;
let queued = false;
let timer;
function compile() {
  if (running) { queued = true; return; }
  running = true;
  const child = spawn(process.execPath, ['scripts/build.mjs'], { stdio: 'inherit' });
  child.on('exit', () => { running = false; if (queued) { queued = false; compile(); } });
}
function schedule() { clearTimeout(timer); timer = setTimeout(compile, 200); }
for (const path of ['src', 'public']) watch(path, { recursive: true }, schedule);
for (const path of ['vite.config.ts', 'tailwind.config.js', 'postcss.config.js']) watch(path, schedule);
compile();
console.log('Watching extension source. Reload the unpacked extension in Chrome after each build.');
