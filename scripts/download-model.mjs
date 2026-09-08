import { mkdir, rename, access, writeFile, readFile, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';

// Immutable official Hugging Face revision; data only, no remote executable code.
const lock = JSON.parse(await readFile('models/model-lock.json', 'utf8'));
const { repo, revision } = lock;
const files = Object.keys(lock.hashes);
const root = 'models/smollm2-135m-quant';
const hashes = {};
for (const file of files) {
  const dest = `${root}/${file}`;
  await mkdir(dirname(dest), { recursive: true });
  let exists = false;
  try { await access(dest); exists = true; } catch { /* first download */ }
  if (!exists) {
    console.log(`Downloading ${file}…`);
    const response = await fetch(`https://huggingface.co/${repo}/resolve/${revision}/${file}`, { signal: AbortSignal.timeout(600_000) });
    if (!response.ok || !response.body) throw new Error(`${file}: HTTP ${response.status}`);
    try {
      await pipeline(Readable.fromWeb(response.body), createWriteStream(`${dest}.partial`));
      await rename(`${dest}.partial`, dest);
    } catch (error) { await rm(`${dest}.partial`, { force: true }); throw error; }
  }
  hashes[file] = createHash('sha256').update(await readFile(dest)).digest('hex');
  if (hashes[file] !== lock.hashes[file]) throw new Error(`Checksum mismatch: ${file}. Remove this file and retry the download.`);
}
await writeFile(`${root}/provenance.json`, JSON.stringify({ repo, revision, hashes }, null, 2));
console.log('Local INT4 + INT8 model weights ready. Run npm run build to bundle them.');
