// Fails the build if any file in dist/ would be rejected by Cloudflare Pages (25 MiB per file, 20,000 files).
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const DIST = join(ROOT, 'dist');
const LIMIT = JSON.parse(readFileSync(join(ROOT, 'src/bg/engine.json'), 'utf8')).pagesFileLimit;
const files = [];
(function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : files.push([relative(DIST, p), statSync(p).size]); } })(DIST);
const tooBig = files.filter(([, s]) => s >= LIMIT);
const top = [...files].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([f, s]) => `${f} ${(s / 2 ** 20).toFixed(1)} MiB`).join(', ');
if (tooBig.length || files.length >= 20000) {
  console.error(`check-dist: FAIL. Files at or over ${LIMIT / 2 ** 20} MiB: ${tooBig.map(([f, s]) => `${f} (${(s / 2 ** 20).toFixed(1)} MiB)`).join(', ') || 'none'}; file count ${files.length}`);
  process.exit(1);
}
console.log(`check-dist: ${files.length} files, all below ${LIMIT / 2 ** 20} MiB (largest: ${top})`);
