// WebKit (Safari engine) checks for the background remover, via Playwright. Optional: if Playwright and its
// WebKit build are not installed the script prints SKIP and exits 0.
//   npm i --no-save playwright && npx playwright install --with-deps webkit && npm run build && npm run test:webkit
// (or PLAYWRIGHT_MODULE=/path/to/node_modules/playwright/index.mjs). Runs against dist/ with _headers emulated.
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const FIX = join(ROOT, 'tests/fixtures/bg');
let pw;
try { pw = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright'); }
catch { console.log('SKIP webkit tests: playwright not installed'); process.exit(0); }

// _headers emulation (same semantics as Cloudflare Pages: all matching rules combine, "! Name" detaches)
const rules = [];
for (const line of readFileSync(join(DIST, '_headers'), 'utf8').split('\n')) {
  if (!line.trim() || line.trim().startsWith('#')) continue;
  if (!/^\s/.test(line)) { rules.push({ re: new RegExp('^' + line.trim().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'), set: [], del: [] }); continue; }
  const t = line.trim(), r = rules.at(-1);
  if (t.startsWith('!')) r.del.push(t.slice(1).trim().toLowerCase());
  else { const i = t.indexOf(':'); r.set.push([t.slice(0, i).trim().toLowerCase(), t.slice(i + 1).trim()]); }
}
function headersFor(p) {
  const h = {};
  for (const r of rules) if (r.re.test(p)) { for (const d of r.del) delete h[d]; for (const [k, v] of r.set) h[k] = h[k] ? h[k] + ', ' + v : v; }
  return h;
}
const T = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.bin': 'application/octet-stream', '.json': 'application/json', '.txt': 'text/plain' };
const srv = http.createServer((q, r) => {
  const p = decodeURIComponent(new URL(q.url, 'http://x').pathname);
  let f = join(DIST, p);
  if (existsSync(f) && statSync(f).isDirectory()) f = join(f, 'index.html');
  if (!existsSync(f)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'Content-Type': T[extname(f)] || 'application/octet-stream', ...headersFor(p) });
  r.end(readFileSync(f));
}).listen(0);
const BASE = `http://localhost:${srv.address().port}`;

let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  webkit: ${name}${info ? '  — ' + info : ''}`); };

let browser;
try { browser = await pw.webkit.launch(); }
catch (e) { console.log('SKIP webkit tests: WebKit not launchable (' + String(e.message).split('\n')[0] + ')'); srv.close(); process.exit(0); }
const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';
const ctx = await browser.newContext({ userAgent: IOS_UA, viewport: { width: 390, height: 844 }, isMobile: false, hasTouch: true, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
// iOS Safari exposes navigator.share/canShare for files; WebKit on Linux does not, so they are mocked
// (the click → share call path and its user activation are what is tested here).
await page.addInitScript(() => {
  window.__shares = [];
  navigator.canShare = (d) => !!d?.files?.length;
  navigator.share = (d) => { window.__shares.push(d.files.map((f) => ({ name: f.name, type: f.type, size: f.size }))); return Promise.resolve(); };
});
await page.goto(BASE + '/it/rimuovi-sfondo/', { waitUntil: 'networkidle' });
const env = await page.evaluate(() => ({ coi: self.crossOriginIsolated, sab: typeof SharedArrayBuffer, clip: typeof ClipboardItem, share: window.__kitBg?.shareMode }));
check('page loads, iOS share mode on', env.share === true, JSON.stringify(env));
await page.setInputFiles('#bg-file', join(FIX, 'dog-labrador.jpg'));
const t0 = Date.now();
await page.waitForFunction(() => ['done', 'error'].includes(window.__kitBg?.status), null, { timeout: 300000 });
const st = await page.evaluate(() => ({ status: window.__kitBg.status, ms: window.__kitBg.ms, threads: window.__kitBg.threads, isolated: window.__kitBg.isolated, err: window.__kitBg.lastError, text: document.querySelector('#bg-status').textContent }));
check(`cut-out in WebKit (${Date.now() - t0} ms wall)`, st.status === 'done', JSON.stringify(st));
if (st.status === 'done') {
  const grid = await page.evaluate(() => window.__kitBg.alphaGrid(64));
  check('background transparent / subject opaque', grid[2 * 64 + 2] < 20 && grid[Math.floor(0.4 * 64) * 64 + Math.floor(0.55 * 64)] > 235);
  await page.waitForTimeout(400);
  await page.click('#bg-share');
  const sh = await page.evaluate(() => window.__shares);
  check('"Salva in Foto" → share() with dog-labrador-nobg.png', sh.length === 1 && sh[0][0].name === 'dog-labrador-nobg.png' && sh[0][0].type === 'image/png' && sh[0][0].size > 10000, JSON.stringify(sh));
  // real <a download> still works in WebKit
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.click('#bg-dl-file')]);
  check('"Scarica file" triggers a real download', dl.suggestedFilename() === 'dog-labrador-nobg.png', dl.suggestedFilename());
  // real clipboard: WebKit only accepts write() synchronously inside a user gesture, with a Promise<Blob>
  if (env.clip === 'function') {
    await page.click('#bg-copy');
    await page.waitForFunction(() => document.querySelector('#bg-copy').textContent !== 'Copia immagine', null, { timeout: 10000 }).catch(() => {});
    const label = await page.$eval('#bg-copy', (b) => b.textContent);
    check('"Copia immagine" with the real WebKit clipboard', label === 'Copiata', label);
  } else check('ClipboardItem missing in this WebKit build: copy button hidden', await page.$eval('#bg-copy', (b) => b.hidden));
}
check('no page errors', errors.length === 0, JSON.stringify(errors.slice(0, 3)));
await browser.close();
srv.close();
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
