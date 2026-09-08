// UI-only fixture server. Never included in the extension or release ZIP.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const root = resolve('dist');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.wasm': 'application/wasm' };
createServer(async (req, res) => {
  try {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('Content-Security-Policy', "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; connect-src 'self'");
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (path === '/preview.js' || path === '/engine-harness.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(await readFile(path === '/preview.js' ? 'scripts/preview-runtime.js' : 'scripts/engine-harness.js')); return; }
    const file = resolve(root, `.${path === '/' ? '/src/popup/popup.html' : path}`);
    if (!file.startsWith(`${root}/`)) { res.writeHead(403).end(); return; }
    let data = await readFile(file);
    if (extname(file) === '.html') data = Buffer.from(data.toString().replace('<head>', `<head><script src="/${path.includes('/offscreen/') ? 'engine-harness' : 'preview'}.js"></script>`));
    res.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream'); res.end(data);
  } catch { res.writeHead(404).end('Not found'); }
}).listen(4173, '127.0.0.1', () => console.log('UI fixture preview: http://127.0.0.1:4173 (not a live extension)'));
