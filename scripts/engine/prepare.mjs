// Prepares the background-remover engine in public/engine/ (git-ignored, regenerated on every build):
//  - copies the pinned onnxruntime-web WASM runtime from node_modules,
//  - downloads the pinned model once into .cache/models/ (sha256-verified),
//  - splits it into parts below Cloudflare Pages' 25 MiB per-file limit,
//  - writes licence files next to the redistributed binaries.
// Usage: node scripts/engine/prepare.mjs   (runs automatically in `npm run build`)
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const ENGINE = JSON.parse(readFileSync(join(ROOT, 'src/bg/engine.json'), 'utf8'));
const PUB = join(ROOT, 'public');
const out = (p) => join(PUB, p.replace(/^\//, ''));
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const LIMIT = ENGINE.pagesFileLimit;
if (ENGINE.model.partBytes >= LIMIT) throw new Error('partBytes must be below the Pages file limit');

// ---- ONNX Runtime Web (pinned version must match node_modules)
const ortPkg = JSON.parse(readFileSync(join(ROOT, 'node_modules', ENGINE.ort.package, 'package.json'), 'utf8'));
if (ortPkg.version !== ENGINE.ort.version) throw new Error(`onnxruntime-web ${ortPkg.version} installed, engine.json pins ${ENGINE.ort.version}`);
// remove stale versions so old runtimes are not deployed
mkdirSync(out('/engine'), { recursive: true });
for (const d of readdirSync(out('/engine'))) if (d.startsWith('ort-') && `/engine/${d}/` !== ENGINE.ort.dir) rmSync(out('/engine/' + d), { recursive: true });
const ortDir = out(ENGINE.ort.dir);
mkdirSync(ortDir, { recursive: true });
for (const f of ENGINE.ort.files) {
  const src = join(ROOT, 'node_modules', ENGINE.ort.package, 'dist', f);
  if (statSync(src).size >= LIMIT) throw new Error(`${f} is over the Pages file limit`);
  copyFileSync(src, join(ortDir, f));
}
copyFileSync(join(ROOT, ENGINE.ort.licenceFile), join(ortDir, 'LICENSE.txt'));

// ---- Model: download once (pinned revision), verify, split
const m = ENGINE.model;
const cacheFile = join(ROOT, '.cache/models', `${m.sha256}.onnx`);
if (!existsSync(cacheFile)) {
  console.log(`engine: downloading ${m.id} (${(m.bytes / 2 ** 20).toFixed(1)} MiB) from ${m.source}`);
  const res = await fetch(m.source);
  if (!res.ok) throw new Error(`model download failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length !== m.bytes || sha256(buf) !== m.sha256) throw new Error('model download: size or sha256 mismatch');
  mkdirSync(dirname(cacheFile), { recursive: true });
  writeFileSync(cacheFile, buf);
}
const model = readFileSync(cacheFile);
if (model.length !== m.bytes || sha256(model) !== m.sha256) throw new Error(`cached model ${cacheFile} is corrupt: delete it and rebuild`);
for (const d of existsSync(out('/engine/models')) ? readdirSync(out('/engine/models')) : [])
  if (`/engine/models/${d}/` !== m.dir) rmSync(out('/engine/models/' + d), { recursive: true });
const modelDir = out(m.dir);
mkdirSync(modelDir, { recursive: true });
const parts = Math.ceil(m.bytes / m.partBytes);
for (let i = 0; i < parts; i++) {
  const f = join(modelDir, `part-${i}.bin`);
  const chunk = model.subarray(i * m.partBytes, Math.min(m.bytes, (i + 1) * m.partBytes));
  if (!existsSync(f) || statSync(f).size !== chunk.length || sha256(readFileSync(f)) !== sha256(chunk)) writeFileSync(f, chunk);
}
for (const f of readdirSync(modelDir)) if (/^part-\d+\.bin$/.test(f) && Number(f.slice(5, -4)) >= parts) rmSync(join(modelDir, f));
writeFileSync(join(modelDir, 'LICENSE.txt'), readFileSync(join(ROOT, m.licenceFile)));
writeFileSync(join(modelDir, 'NOTICE.txt'), `${m.name}\nAuthor: ${m.author} (${m.homepage})\nLicence: ${m.licence} (see LICENSE.txt)\nSource: ${m.source}\nsha256: ${m.sha256}\nSplit into ${parts} parts of up to ${m.partBytes} bytes for static hosting; concatenated unchanged in the browser.\n`);
console.log(`engine: ORT ${ENGINE.ort.version} + ${m.id} in ${parts} parts ready in public${m.dir}`);
