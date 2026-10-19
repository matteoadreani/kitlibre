// End-to-end tests in real headless Chrome against the built static site (dist/).
// Serves dist/ with the same _headers (CSP etc.) Cloudflare Pages would apply.
import http from 'node:http';
import { readFileSync, existsSync, statSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const FIX = join(ROOT, 'tests/fixtures');
const DL = join(ROOT, 'tests/fixtures/out');
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.xml': 'application/xml', '.txt': 'text/plain', '.webmanifest': 'application/manifest+json', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.bin': 'application/octet-stream', '.json': 'application/json', '.jpg': 'image/jpeg' };

// ---- tiny static server honouring _headers like Cloudflare Pages: every matching rule applies in order,
// "Name: value" adds (same name twice is comma-joined), "! Name" detaches a header set by an earlier rule.
const headerRules = [];
{
  let cur = null;
  for (const l of readFileSync(join(DIST, '_headers'), 'utf8').split('\n')) {
    if (!l.trim() || l.trim().startsWith('#')) continue;
    if (/^\S/.test(l)) { cur = { re: new RegExp('^' + l.trim().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'), ops: [] }; headerRules.push(cur); }
    else if (cur) {
      const t = l.trim();
      if (t.startsWith('!')) cur.ops.push(['del', t.slice(1).trim().toLowerCase()]);
      else { const i = t.indexOf(':'); cur.ops.push(['add', t.slice(0, i).trim(), t.slice(i + 1).trim()]); }
    }
  }
}
function headersFor(path) {
  const out = new Map(); // lower-case name → [name, value]
  for (const r of headerRules) {
    if (!r.re.test(path)) continue;
    for (const [op, name, value] of r.ops) {
      if (op === 'del') out.delete(name);
      else { const k = name.toLowerCase(); out.set(k, out.has(k) ? [name, out.get(k)[1] + ', ' + value] : [name, value]); }
    }
  }
  return Object.fromEntries([...out.values()]);
}
const redirects = new Map(readFileSync(join(DIST, '_redirects'), 'utf8').split('\n').filter(Boolean).map((l) => l.split(/\s+/)));
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (redirects.has(p)) { res.writeHead(301, { Location: redirects.get(p) }); return res.end(); }
  let f = join(DIST, p);
  if (existsSync(f) && statSync(f).isDirectory()) f = join(f, 'index.html');
  let status = 200;
  if (!existsSync(f)) { f = join(DIST, '404.html'); status = 404; }
  res.writeHead(status, { 'Content-Type': TYPES[extname(f)] || 'application/octet-stream', ...headersFor(p) });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(4319, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:4319';

let pass = 0, fail = 0;
const results = [];
function check(name, ok, info = '') {
  ok ? pass++ : fail++;
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
}
const decodePngBuffer = (buf) => { const png = PNG.sync.read(buf); return jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data ?? null; };
const decodeDataUrl = (u) => decodePngBuffer(Buffer.from(u.split(',')[1], 'base64'));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const external = [], consoleErrors = [], cspViolations = [];
async function newPage(viewport = { width: 1280, height: 900 }) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  page.on('request', (r) => { const u = r.url(); if (!u.startsWith(BASE) && !u.startsWith('data:') && !u.startsWith('blob:') && !u.startsWith('https://assets.mailerlite.com/')) external.push(u); });
  page.on('console', (m) => { if (m.type() === 'error' && !(m.location()?.url || '').startsWith('https://assets.mailerlite.com/')) consoleErrors.push(m.text()); }); // mocked MailerLite error cases log expected network errors
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  await page.evaluateOnNewDocument(() => document.addEventListener('securitypolicyviolation', (e) => console.error('CSP violation: ' + e.violatedDirective + ' ' + e.blockedURI)));
  return page;
}
// MailerLite is never contacted by the tests: requests to it are intercepted and answered locally.
const ML = 'https://assets.mailerlite.com/';
const mlPosts = [];
async function mockMailerLite(page) {
  const state = { mode: 'ok' };
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    if (!r.url().startsWith(ML)) return r.continue();
    const cors = { 'Access-Control-Allow-Origin': '*' };
    if (r.method() === 'OPTIONS') return r.respond({ status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'POST' } });
    mlPosts.push({ url: r.url(), method: r.method(), body: r.postData() || '', type: r.headers()['content-type'] || '', cookie: r.headers()['cookie'] || '' });
    if (state.mode === 'down') return r.abort('failed');
    const body = state.mode === 'ok' ? { success: true } : { success: false, errors: { fields: { email: ['The email must be a valid email address.'] } } };
    setTimeout(() => r.respond({ status: state.mode === 'ok' ? 200 : 422, contentType: 'application/json', headers: cors, body: JSON.stringify(body) }), 150);
  });
  return state;
}
// Same mock, but only MailerLite requests are paused (CDP Fetch with a URL pattern). Used on the background
// remover pages: page-wide request interception can stall the module worker and its pthread workers.
async function mockMailerLiteScoped(page) {
  const state = { mode: 'ok' };
  const cdp = await page.createCDPSession();
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: ML + '*' }] });
  cdp.on('Fetch.requestPaused', async ({ requestId, request }) => {
    const cors = [{ name: 'Access-Control-Allow-Origin', value: '*' }];
    if (request.method === 'OPTIONS') return cdp.send('Fetch.fulfillRequest', { requestId, responseCode: 204, responseHeaders: [...cors, { name: 'Access-Control-Allow-Methods', value: 'POST' }] });
    mlPosts.push({ url: request.url, method: request.method, body: request.postData || '', type: request.headers['Content-Type'] || request.headers['content-type'] || '', cookie: request.headers['Cookie'] || '' });
    if (state.mode === 'down') return cdp.send('Fetch.failRequest', { requestId, errorReason: 'Failed' });
    const body = state.mode === 'ok' ? { success: true } : { success: false, errors: { fields: { email: ['The email must be a valid email address.'] } } };
    await new Promise((r) => setTimeout(r, 150));
    await cdp.send('Fetch.fulfillRequest', { requestId, responseCode: state.mode === 'ok' ? 200 : 422, responseHeaders: [...cors, { name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(body)).toString('base64') });
  });
  return state;
}
const nlMsg = (page) => page.$eval('#nl-msg', (m) => ({ text: m.textContent, cls: m.className }));
const waitNlDone = (page) => page.waitForFunction(() => document.querySelector('#nl-form button').getAttribute('aria-busy') !== 'true' && document.querySelector('#nl-msg').textContent !== '', { timeout: 5000 });

async function setVal(page, sel, value) {
  await page.$eval(sel, (el, v) => { if (el.type === 'checkbox') el.checked = v; else el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, value);
}
async function pickType(page, type) { await page.click(`input[name=qrtype][value=${type}]`); }
const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
async function svgDecode(page) {
  // Rasterise the SVG output in the browser and return pixels for jsQR in Node.
  const { w, data } = await page.evaluate(async () => {
    const svg = window.__kitQr.svg();
    const img = new Image();
    img.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    await img.decode();
    const c = document.createElement('canvas'); c.width = c.height = 800;
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, 800, 800);
    return { w: 800, data: Array.from(ctx.getImageData(0, 0, 800, 800).data) };
  });
  return jsQR(new Uint8ClampedArray(data), w, w)?.data ?? null;
}

// ---------------- Generator: every type, PNG + SVG round-trip
const page = await newPage();
await mockMailerLite(page);
await page.goto(BASE + '/qr/', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!window.__kitQr);
const genCases = [
  { type: 'url', fill: { '#f-url': 'example.com/menu', '#utm-source': 'flyer', '#utm-medium': 'qr', '#utm-campaign': 'spring sale' }, open: '#utm', expect: 'https://example.com/menu?utm_source=flyer&utm_medium=qr&utm_campaign=spring+sale' },
  { type: 'text', fill: { '#f-text': 'Ciao àèìòù 🎉 €100\nriga 2' }, expect: 'Ciao àèìòù 🎉 €100\nriga 2' },
  { type: 'wifi', fill: { '#f-ssid': 'Casa;Rossi', '#f-wpass': 'p@ss:w"rd', '#f-whidden': true }, expect: 'WIFI:T:WPA;S:Casa\\;Rossi;P:p@ss\\:w\\"rd;H:true;;' },
  { type: 'vcard', fill: { '#v-first': 'Mario', '#v-last': 'Rossi', '#v-org': 'Rossi, Srl', '#v-mobile': '+39 333 1234567', '#v-email': 'mario@example.it', '#v-city': 'Milano' },
    expect: 'BEGIN:VCARD\r\nVERSION:3.0\r\nN:Rossi;Mario;;;\r\nFN:Mario Rossi\r\nORG:Rossi\\, Srl\r\nTEL;TYPE=CELL:+39 333 1234567\r\nEMAIL;TYPE=INTERNET:mario@example.it\r\nADR;TYPE=WORK:;;;Milano;;;\r\nEND:VCARD' },
  { type: 'email', fill: { '#e-to': 'info@example.com', '#e-subject': 'Prenotazione', '#e-body': 'Tavolo per 2?' }, expect: 'mailto:info@example.com?subject=Prenotazione&body=Tavolo%20per%202%3F' },
  { type: 'phone', fill: { '#p-phone': '+39 02 123 456' }, expect: 'tel:+3902123456' },
  { type: 'sms', fill: { '#s-phone': '+1 555 0100', '#s-msg': 'Hello: table 4' }, expect: 'SMSTO:+15550100:Hello: table 4' },
];
for (const c of genCases) {
  await pickType(page, c.type);
  if (c.open) await page.$eval(c.open, (d) => (d.open = true));
  for (const [sel, v] of Object.entries(c.fill)) await setVal(page, sel, v);
  await settle(page);
  const cur = await page.evaluate(() => window.__kitQr.current());
  check(`generator ${c.type}: payload`, cur?.text === c.expect, cur ? JSON.stringify(cur.text) : 'none');
  const png = decodeDataUrl(await page.evaluate(() => window.__kitQr.pngDataUrl()));
  check(`generator ${c.type}: PNG decodes back`, png === c.expect, JSON.stringify(png));
  const svg = await svgDecode(page);
  check(`generator ${c.type}: SVG decodes back`, svg === c.expect, JSON.stringify(svg));
  const visible = await page.$eval(`.panel[data-for=${c.type}]`, (p) => !p.hidden);
  check(`generator ${c.type}: only its panel is visible`, visible && (await page.$$eval('.panel:not([hidden])', (l) => l.length)) === 1);
}

// Colours / EC / margin / size variants (URL)
await pickType(page, 'url');
for (const [ec, fg, bg, margin] of [['L', '#1d4ed8', '#fefce8', '2'], ['Q', '#7c2d12', '#ffffff', '6'], ['H', '#000000', '#ffffff', '0']]) {
  await setVal(page, '#d-ec', ec); await setVal(page, '#d-fg', fg); await setVal(page, '#d-bg', bg); await setVal(page, '#d-margin', margin);
  await settle(page);
  const exp = (await page.evaluate(() => window.__kitQr.current())).text;
  const got = margin === '0' ? 'skip' : decodeDataUrl(await page.evaluate(() => window.__kitQr.pngDataUrl()));
  if (margin !== '0') check(`design EC=${ec} fg=${fg} bg=${bg} margin=${margin}: PNG decodes`, got === exp, JSON.stringify(got));
  else check('margin 0 shows quiet-zone warning', (await page.$eval('#qr-warn', (w) => w.textContent)).length > 0);
}
await setVal(page, '#d-ec', 'M'); await setVal(page, '#d-fg', '#111827'); await setVal(page, '#d-bg', '#ffffff'); await setVal(page, '#d-margin', '4');
await setVal(page, '#d-fg', '#eeeeee'); await settle(page);
check('low-contrast warning shown', (await page.$eval('#qr-warn', (w) => w.textContent)).includes('contrast'));
await setVal(page, '#d-fg', '#111827');

// Logo
const logoInput = await page.$('#d-logo');
await logoInput.uploadFile(join(DIST, 'apple-touch-icon.png'));
await page.waitForFunction(() => !document.getElementById('logo-row').hidden);
await settle(page);
check('logo forces EC=H', (await page.$eval('#d-ec', (s) => s.value)) === 'H');
const expUrl = (await page.evaluate(() => window.__kitQr.current())).text;
check('logo: PNG still decodes', decodeDataUrl(await page.evaluate(() => window.__kitQr.pngDataUrl())) === expUrl);
check('logo: SVG embeds image and decodes', (await page.evaluate(() => window.__kitQr.svg())).includes('<image') && (await svgDecode(page)) === expUrl);
await page.click('#d-logo-remove'); await settle(page);
check('logo removed restores EC', (await page.$eval('#d-ec', (s) => s.value)) === 'M');

// Real downloads + newsletter placeholder
rmSync(DL, { recursive: true, force: true }); mkdirSync(DL, { recursive: true });
const cdp = await page.createCDPSession();
await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL });
check('newsletter hidden before download', await page.$eval('#newsletter', (n) => n.hidden));
const waitFiles = async (n) => { for (let i = 0; i < 80 && readdirSync(DL).filter((f) => !f.endsWith('.crdownload')).length < n; i++) await new Promise((r) => setTimeout(r, 100)); };
await page.click('#dl-png');
await waitFiles(1);
await page.click('#dl-svg');
await waitFiles(2);
const files = readdirSync(DL);
const pngFile = files.find((f) => f.endsWith('.png')), svgFile = files.find((f) => f.endsWith('.svg'));
check('PNG downloaded', !!pngFile, files.join(','));
check('SVG downloaded', !!svgFile);
if (pngFile) {
  const png = PNG.sync.read(readFileSync(join(DL, pngFile)));
  check('downloaded PNG has chosen size (1024px)', png.width === 1024 && png.height === 1024, `${png.width}x${png.height}`);
  check('downloaded PNG decodes back', decodePngBuffer(readFileSync(join(DL, pngFile))) === expUrl);
}
if (svgFile) check('downloaded SVG is valid SVG', /^<\?xml[\s\S]*<svg [^>]*width="1024"/.test(readFileSync(join(DL, svgFile), 'utf8')));
check('newsletter shown after download', !(await page.$eval('#newsletter', (n) => n.hidden)));
{
  const mlBefore = mlPosts.length;
  await setVal(page, '#nl-email', 'test@example.com');
  await page.click('#nl-form button');
  await waitNlDone(page);
  const m = await nlMsg(page);
  check('generator newsletter box posts to MailerLite and confirms', mlPosts.length === mlBefore + 1 && m.text === 'Check your inbox to confirm.' && m.cls.includes('ok'), JSON.stringify(m));
}

// Prefill via fragment
const p2 = await newPage();
await p2.goto(BASE + '/qr/#url=' + encodeURIComponent('https://example.org/x?y=1'), { waitUntil: 'networkidle0' });
await p2.waitForFunction(() => window.__kitQr?.current());
check('prefill #url= works', (await p2.evaluate(() => window.__kitQr.current().text)) === 'https://example.org/x?y=1');
await p2.goto(BASE + '/it/qr/#raw=' + encodeURIComponent('WIFI:T:WPA;S:x;P:y;;'), { waitUntil: 'networkidle0' });
await p2.waitForFunction(() => window.__kitQr?.current());
check('prefill #raw= works (IT page)', (await p2.evaluate(() => window.__kitQr.current().text)) === 'WIFI:T:WPA;S:x;P:y;;');

// ---------------- Trap checker with sample images
const manifest = JSON.parse(readFileSync(join(FIX, 'manifest.json'), 'utf8'));
for (const [path, lang] of [['/qr/check/', 'en'], ['/it/qr/verifica/', 'it']]) {
  const cp = await newPage({ width: 390, height: 844 });
  await cp.goto(BASE + path, { waitUntil: 'networkidle0' });
  for (const f of manifest) {
    const input = await cp.$('#chk-file');
    await cp.$eval('#result', (r) => { r.hidden = true; delete r.dataset.verdict; });
    await input.uploadFile(join(FIX, f.file));
    await cp.waitForFunction(() => { const r = document.getElementById('result'); return !r.hidden && (r.dataset.verdict || r.classList.contains('warning') && !r.querySelector('pre')); }, { timeout: 15000 }).catch(() => {});
    const res = await cp.evaluate(() => { const r = document.getElementById('result'); return { v: r.dataset.verdict || null, content: r.querySelector('pre')?.textContent ?? null, text: r.textContent }; });
    check(`checker[${lang}] ${f.file} → ${f.verdict}`, res.v === f.verdict && res.content === f.content, `got ${res.v} / ${JSON.stringify(res.content)}`);
  }
  // CTA for static: identical copy link goes to generator with fragment
  const cta = await cp.$eval('#result .cta a', (a) => a.getAttribute('href'));
  check(`checker[${lang}] static CTA links to generator`, cta.startsWith(lang === 'it' ? '/it/qr/#raw=' : '/qr/#raw='), cta);
  await setVal(cp, '#paste-input', 'https://qrco.de/bf4Y2u');
  await cp.click('#paste-form button');
  check(`checker[${lang}] pasted link flagged dynamic`, (await cp.$eval('#result', (r) => r.dataset.verdict)) === 'dynamic');
  await cp.$eval('#result', (r) => { r.hidden = true; delete r.dataset.verdict; });
  await (await cp.$('#chk-file')).uploadFile(join(DIST, 'favicon.svg'));
  await cp.waitForFunction(() => !document.getElementById('result').hidden && !document.getElementById('result').textContent.includes('…'), { timeout: 10000 }).catch(() => {});
  check(`checker[${lang}] image without QR handled`, (await cp.$eval('#result', (r) => r.classList.contains('warning') && !r.dataset.verdict)));
  const overflow = await cp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check(`checker[${lang}] no horizontal overflow on mobile`, !overflow);
}

// ---------------- SEO / i18n / a11y smoke checks on every page
for (const path of ['/', '/remove-bg/', '/remove-bg-alternative/', '/qr/', '/qr/check/', '/newsletter/', '/privacy/', '/it/', '/it/rimuovi-sfondo/', '/it/alternativa-remove-bg/', '/it/qr/', '/it/qr/verifica/', '/it/newsletter/', '/it/privacy/']) {
  for (const vp of [{ width: 1280, height: 900 }, { width: 360, height: 740 }]) {
    const sp = await newPage(vp);
    const resp = await sp.goto(BASE + path, { waitUntil: 'networkidle0' });
    if (vp.width === 360) {
      check(`${path} mobile: no horizontal overflow`, !(await sp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)));
      await sp.close();
      continue;
    }
    const info = await sp.evaluate(() => {
      const q = (s) => document.querySelector(s);
      const unlabeled = [...document.querySelectorAll('input:not([type=radio]):not([type=hidden]), select, textarea')]
        .filter((el) => !(el.id && document.querySelector(`label[for="${el.id}"]`)) && !el.getAttribute('aria-label') && !el.closest('label'))
        .map((el) => el.id || el.name);
      let ldOk = true, ldTypes = [];
      for (const s of document.querySelectorAll('script[type="application/ld+json"]')) { try { ldTypes.push(JSON.parse(s.textContent)['@type']); } catch { ldOk = false; } }
      return {
        lang: document.documentElement.lang, title: document.title, desc: q('meta[name=description]')?.content,
        canonical: q('link[rel=canonical]')?.href, og: q('meta[property="og:image"]')?.content, hreflang: document.querySelectorAll('link[rel=alternate][hreflang]').length,
        h1: document.querySelectorAll('h1').length, ogPath: new URL(q('meta[property="og:image"]').content).pathname, canonPath: new URL(q('link[rel=canonical]').href).pathname,
        canonHost: new URL(q('link[rel=canonical]').href).host, robots: q('meta[name=robots]')?.content, brandInTitle: document.title.includes('Kitlibre'), unlabeled, ldOk, ldTypes, imgsNoAlt: [...document.querySelectorAll('img:not([alt])')].length,
        tw: Object.fromEntries(['card', 'site', 'title', 'description', 'image', 'image:alt'].map((k) => [k, q(`meta[name="twitter:${k}"]`)?.content ?? null])),
        ogTitle: q('meta[property="og:title"]')?.content, ogDesc: q('meta[property="og:description"]')?.content, ogAlt: q('meta[property="og:image:alt"]')?.content,
      };
    });
    const isIt = path.startsWith('/it/');
    check(`${path} status 200`, resp.status() === 200);
    check(`${path} lang=${isIt ? 'it' : 'en'}`, info.lang === (isIt ? 'it' : 'en'));
    check(`${path} title/description/canonical/og/hreflang`, info.title.length > 10 && info.desc?.length > 50 && !!info.canonical && !!info.og && info.hreflang === 3, `${info.title} | hreflang=${info.hreflang}`);
    check(`${path} exactly one h1`, info.h1 === 1);
    check(`${path} canonical = https://kitlibre.com${path}`, info.canonHost === 'kitlibre.com' && info.canonPath === path, info.canonHost + info.canonPath);
    check(`${path} robots index,follow (production build)`, info.robots === 'index,follow', info.robots);
    check(`${path} brand in title`, info.brandInTitle, info.title);
    check(`${path} OG image exists (${info.ogPath})`, existsSync(join(DIST, info.ogPath)));
    check(`${path} X/Twitter card tags (site @kitlibrehq, title/description = OG, image = og:image, alt)`, info.tw.card === 'summary_large_image' && info.tw.site === '@kitlibrehq' && info.tw.title === info.ogTitle && info.tw.description === info.ogDesc && info.tw.image === info.og && /^https:\/\/kitlibre\.com\/og-[a-z-]+\.png$/.test(info.tw.image) && info.tw['image:alt']?.length > 10 && info.ogAlt === info.tw['image:alt'], JSON.stringify(info.tw));
    check(`${path} all form controls labelled`, info.unlabeled.length === 0, info.unlabeled.join(','));
    check(`${path} JSON-LD valid`, info.ldOk, info.ldTypes.join(','));
    await sp.close();
  }
}
const errorsBefore404 = consoleErrors.length;
const nf = await (await newPage()).goto(BASE + '/does-not-exist/', { waitUntil: 'networkidle0' });
consoleErrors.splice(errorsBefore404); // the expected 404 of this navigation itself
check('unknown path → 404 page', nf.status() === 404);
const sm = readFileSync(join(DIST, 'sitemap.xml'), 'utf8');
check('sitemap.xml lists 14 kitlibre.com URLs', (sm.match(/<loc>https:\/\/kitlibre\.com\//g) || []).length === 14);
check('robots.txt allows indexing + sitemap', /Allow: \/[\s\S]*Sitemap: https:\/\/kitlibre\.com\/sitemap\.xml/.test(readFileSync(join(DIST, 'robots.txt'), 'utf8')));
for (const [from, to] of [['/check/', '/qr/check/'], ['/it/verifica/', '/it/qr/verifica/'], ['/check', '/qr/check/'], ['/bg/', '/remove-bg/'], ['/bg', '/remove-bg/'], ['/remove-background/', '/remove-bg/'], ['/remove-background', '/remove-bg/'], ['/it/bg/', '/it/rimuovi-sfondo/']]) {
  const r = await fetch(BASE + from, { redirect: 'manual' });
  check(`legacy ${from} → 301 ${to}`, r.status === 301 && r.headers.get('location') === to, `${r.status} ${r.headers.get('location')}`);
}
// Hub + newsletter page
for (const [path, lang] of [['/', 'en'], ['/it/', 'it']]) {
  const hp = await newPage();
  await hp.goto(BASE + path, { waitUntil: 'networkidle0' });
  const hub = await hp.evaluate(() => ({ cards: document.querySelectorAll('.tool-card').length, soon: document.querySelectorAll('.tool-card.soon').length,
    links: [...document.querySelectorAll('.tool-card:not(.soon) h3 a')].map((a) => a.getAttribute('href')), nl: document.querySelector('.nl-teaser a')?.getAttribute('href'), h1: document.querySelector('h1').textContent }));
  const exp = lang === 'it' ? ['/it/rimuovi-sfondo/', '/it/qr/', '/it/qr/verifica/'] : ['/remove-bg/', '/qr/', '/qr/check/'];
  check(`hub[${lang}] 3 live tools + 5 coming soon`, hub.cards === 8 && hub.soon === 5, JSON.stringify(hub));
  check(`hub[${lang}] links to background remover, QR tools + newsletter`, hub.links.join() === exp.join() && hub.nl === (lang === 'it' ? '/it/newsletter/' : '/newsletter/'));
  check(`hub[${lang}] tagline h1`, lang === 'it' ? hub.h1.startsWith('Strumenti gratuiti') : hub.h1 === 'Free tools. No subscription. No signup required. Forever.', hub.h1);
  await hp.goto(BASE + (lang === 'it' ? '/it/newsletter/' : '/newsletter/'), { waitUntil: 'networkidle0' });
  check(`newsletter page[${lang}] named`, (await hp.$eval('h1', (h) => h.textContent)) === 'SaaS Trap of the Week');
  await hp.close();
  const np = await newPage();
  const ml = await mockMailerLite(np);
  await np.goto(BASE + (lang === 'it' ? '/it/newsletter/' : '/newsletter/'), { waitUntil: 'networkidle0' });
  const okText = lang === 'it' ? 'Controlla la posta per confermare.' : 'Check your inbox to confirm.';
  const form = await np.evaluate(() => { const f = document.querySelector('#nl-form'); return { action: f.action, method: f.method, email: f.querySelector('#nl-email').name,
    hidden: [...f.querySelectorAll('input[type=hidden]')].map((i) => i.name + '=' + i.value).join('&'), consent: document.querySelector('#nl-consent').textContent,
    privacy: document.querySelector('#nl-consent a')?.getAttribute('href'), hpVisible: document.querySelector('#nl-website').getBoundingClientRect().left >= 0 }; });
  check(`newsletter[${lang}] form targets MailerLite embedded endpoint`, form.action === 'https://assets.mailerlite.com/jsonp/2342555/forms/201738245033166731/subscribe' && form.method === 'post' && form.email === 'fields[email]' && form.hidden === 'ml-submit=1&anticsrf=true', JSON.stringify(form));
  check(`newsletter[${lang}] consent mentions MailerLite + double opt-in + privacy link`, /MailerLite/.test(form.consent) && /opt-in/i.test(form.consent) && form.privacy === (lang === 'it' ? '/it/privacy/' : '/privacy/'));
  check(`newsletter[${lang}] honeypot is off-screen`, !form.hpVisible);
  // invalid email: no request, error shown
  let n0 = mlPosts.length;
  await setVal(np, '#nl-email', 'not-an-email');
  await np.click('#nl-form button');
  let m = await nlMsg(np);
  check(`newsletter[${lang}] invalid email → error, no request`, mlPosts.length === n0 && m.cls.includes('err') && (await np.$eval('#nl-email', (i) => i.getAttribute('aria-invalid'))) === 'true', JSON.stringify(m));
  // success: loading state, then confirmation
  await setVal(np, '#nl-email', 'reader@example.com');
  await np.click('#nl-form button');
  const busy = await np.$eval('#nl-form button', (b) => ({ busy: b.getAttribute('aria-busy'), disabled: b.disabled, text: b.textContent }));
  check(`newsletter[${lang}] loading state while sending`, busy.busy === 'true' && busy.disabled && busy.text === (lang === 'it' ? 'Invio…' : 'Sending…'), JSON.stringify(busy));
  await waitNlDone(np);
  m = await nlMsg(np);
  const post = mlPosts.at(-1);
  check(`newsletter[${lang}] success → "${okText}"`, m.text === okText && m.cls.includes('ok') && (await np.$eval('#nl-email', (i) => i.value)) === '', JSON.stringify(m));
  check(`newsletter[${lang}] request: urlencoded email + ml-submit + anticsrf only, no cookies`, post && post.method === 'POST' && /x-www-form-urlencoded/.test(post.type) && post.body === 'fields%5Bemail%5D=reader%40example.com&ml-submit=1&anticsrf=true' && !post.cookie, JSON.stringify(post));
  // API error
  ml.mode = 'invalid';
  await setVal(np, '#nl-email', 'reader@example.com');
  await np.click('#nl-form button');
  await waitNlDone(np);
  m = await nlMsg(np);
  check(`newsletter[${lang}] MailerLite validation error shown`, m.cls.includes('err') && m.text === (lang === 'it' ? 'Inserisci un indirizzo email valido.' : 'Please enter a valid email address.'), JSON.stringify(m));
  // network failure
  ml.mode = 'down';
  await setVal(np, '#nl-email', 'reader@example.com');
  await np.click('#nl-form button');
  await waitNlDone(np);
  m = await nlMsg(np);
  check(`newsletter[${lang}] network error shown, button re-enabled`, m.cls.includes('err') && m.text.length > 0 && !(await np.$eval('#nl-form button', (b) => b.disabled)), JSON.stringify(m));
  // honeypot filled: fake success, nothing sent
  ml.mode = 'ok';
  n0 = mlPosts.length;
  await setVal(np, '#nl-website', 'http://spam.example');
  await setVal(np, '#nl-email', 'bot@example.com');
  await np.click('#nl-form button');
  m = await nlMsg(np);
  check(`newsletter[${lang}] honeypot → no request`, mlPosts.length === n0 && m.text === okText);
  await np.close();
}

for (const [path, lang] of [['/privacy/', 'en'], ['/it/privacy/', 'it']]) {
  const pp = await newPage();
  await pp.goto(BASE + path, { waitUntil: 'networkidle0' });
  const txt = await pp.$eval('main', (m) => m.textContent);
  check(`privacy[${lang}] explains MailerLite, double opt-in, unsubscribe`, /MailerLite/.test(txt) && (lang === 'it' ? /doppio opt-in/.test(txt) && /disiscriverti/.test(txt) : /double opt-in/.test(txt) && /unsubscribe at any time/.test(txt)));
  await pp.close();
}
// ---------------- Background remover (/remove-bg/, /it/rimuovi-sfondo/) and the remove.bg alternative pages
{
  const GLOBAL_CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' https://assets.mailerlite.com; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self' https://assets.mailerlite.com; frame-ancestors 'none'";
  const BGFIX = join(FIX, 'bg');
  // headers: page-scoped CSP + COEP, global CSP untouched elsewhere
  for (const path of ['/remove-bg/', '/it/rimuovi-sfondo/']) {
    const r = await fetch(BASE + path);
    const csp = r.headers.get('content-security-policy') || '';
    check(`${path} CSP allows WASM + same-origin worker only (single policy)`, csp.includes("script-src 'self' 'wasm-unsafe-eval'") && csp.includes("worker-src 'self'") && !csp.includes(', ') && !csp.includes("'unsafe-inline'"), csp);
    check(`${path} COOP + COEP (cross-origin isolation)`, r.headers.get('cross-origin-embedder-policy') === 'require-corp' && r.headers.get('cross-origin-opener-policy') === 'same-origin');
  }
  for (const path of ['/', '/qr/', '/qr/check/', '/remove-bg-alternative/', '/it/alternativa-remove-bg/', '/newsletter/']) {
    const r = await fetch(BASE + path);
    check(`${path} keeps the strict site CSP, no COEP`, r.headers.get('content-security-policy') === GLOBAL_CSP && !r.headers.get('cross-origin-embedder-policy'));
  }
  const engineFiles = readdirSync(join(DIST, 'engine'));
  const workerFile = engineFiles.find((f) => /^worker-.*\.js$/.test(f));
  const wr = await fetch(`${BASE}/engine/${workerFile}`);
  check('worker script served from /engine/ with WASM CSP + COEP + immutable cache', !!workerFile && wr.headers.get('content-security-policy')?.includes("'wasm-unsafe-eval'") && wr.headers.get('cross-origin-embedder-policy') === 'require-corp' && /immutable/.test(wr.headers.get('cache-control') || ''), workerFile);
  const engine = JSON.parse(readFileSync(join(ROOT, 'src/bg/engine.json'), 'utf8'));
  const partsDir = join(DIST, engine.model.dir);
  const parts = readdirSync(partsDir).filter((f) => f.endsWith('.bin'));
  const sizes = parts.map((f) => statSync(join(partsDir, f)).size);
  check(`model split into ${parts.length} parts, each < 25 MiB, total = manifest`, parts.length >= 2 && sizes.every((x) => x < 25 * 1024 * 1024) && sizes.reduce((a, b) => a + b, 0) === engine.model.bytes, sizes.join(','));
  check('model + runtime licence files served', existsSync(join(partsDir, 'LICENSE.txt')) && existsSync(join(partsDir, 'NOTICE.txt')) && existsSync(join(DIST, engine.ort.dir, 'LICENSE.txt')));
  const wasm = await fetch(`${BASE}${engine.ort.dir}ort-wasm-simd-threaded.wasm`, { method: 'HEAD' });
  check('ORT wasm served as application/wasm', wasm.headers.get('content-type') === 'application/wasm');

  const readMask = (f) => { const png = PNG.sync.read(readFileSync(join(BGFIX, f))); const a = []; for (let i = 0; i < png.width * png.height; i++) a.push(png.data[i * 4]); return a; };
  const iou = (a, b) => { let i = 0, u = 0; for (let k = 0; k < a.length; k++) { const x = a[k] >= 128, y = b[k] >= 128; if (x && y) i++; if (x || y) u++; } return u ? i / u : 1; };
  const waitBg = (p, timeout = 180000) => p.waitForFunction(() => ['done', 'error'].includes(window.__kitBg?.status), { timeout });
  const bgState = (p) => p.evaluate(() => ({ status: window.__kitBg.status, ms: window.__kitBg.ms, totalMs: window.__kitBg.totalMs, threads: window.__kitBg.threads, isolated: window.__kitBg.isolated, fromCache: window.__kitBg.fromCache, err: window.__kitBg.lastError, text: document.querySelector('#bg-status').textContent, size: window.__kitBg.size }));
  const upload = async (p, f) => { await (await p.$('#bg-file')).uploadFile(f); await new Promise((r) => setTimeout(r, 50)); await waitBg(p); return bgState(p); };
  const timings = [];

  const bp = await newPage();
  await mockMailerLiteScoped(bp);
  await bp.goto(BASE + '/remove-bg/', { waitUntil: 'networkidle0' });
  check('bg[en] page is crossOriginIsolated (threads possible)', await bp.evaluate(() => crossOriginIsolated));
  check('bg[en] remove.bg countdown rendered', /\d+ days left\.|1 day left\.|closed/.test(await bp.$eval('[data-deadline]', (e) => (e.hidden ? '' : e.textContent))));
  check('bg[en] result hidden before an image is chosen', await bp.$eval('#bg-result', (e) => e.hidden));
  // non-image → friendly error, nothing loaded
  await (await bp.$('#bg-file')).uploadFile(join(DIST, 'robots.txt'));
  await bp.waitForFunction(() => window.__kitBg.status === 'error');
  check('bg[en] non-image file → error message', (await bp.$eval('#bg-status', (e) => e.textContent)).startsWith('This file is not an image'));
  // fixtures: first one downloads the model
  const fixtures = [
    ['portrait-aldrin.jpg', 0.9, [[0.03, 0.03], [0.97, 0.03]], [[0.5, 0.45]]],
    ['dog-labrador.jpg', 0.9, [[0.03, 0.03], [0.97, 0.97]], [[0.55, 0.4]]],
    ['cat-grass.jpg', 0.9, [[0.03, 0.97], [0.97, 0.97]], [[0.5, 0.35]]],
    ['product-shoe.jpg', 0.85, [[0.03, 0.97]], [[0.5, 0.75]]],
  ];
  let first = true;
  for (const [f, minIou, bgPts, fgPts] of fixtures) {
    const st = await upload(bp, join(BGFIX, f));
    check(`bg[en] ${f}: done`, st.status === 'done', JSON.stringify(st));
    if (st.status !== 'done') continue;
    if (first) check('bg[en] first run downloads the model (not from cache), 4 threads', st.fromCache === false && st.threads === 4 && st.isolated === true, JSON.stringify(st));
    first = false;
    timings.push(`${f} ${st.ms} ms inference / ${st.totalMs} ms total`);
    const grid = await bp.evaluate(() => window.__kitBg.alphaGrid(256));
    const score = iou(grid, readMask(f.replace('.jpg', '.mask.png')));
    check(`bg[en] ${f}: matte matches fp32 reference (IoU ${score.toFixed(3)} ≥ ${minIou})`, score >= minIou);
    const at = (x, y) => grid[Math.floor(y * 255) * 256 + Math.floor(x * 255)];
    check(`bg[en] ${f}: background transparent, subject opaque`, bgPts.every(([x, y]) => at(x, y) < 20) && fgPts.every(([x, y]) => at(x, y) > 235), JSON.stringify([bgPts.map(([x, y]) => at(x, y)), fgPts.map(([x, y]) => at(x, y))]));
  }
  check('bg[en] result keeps the original resolution', JSON.stringify((await bgState(bp)).size) === JSON.stringify({ w: 1024, h: 769 }));
  check('bg[en] status says done on device', /^Done in \d+\.\d s\./.test((await bgState(bp)).text));
  // background modes, JPG, compare
  check('bg[en] desktop: no share button, Download PNG/JPG visible', (await bp.evaluate(() => window.__kitBg.shareMode)) === false && (await bp.$eval('#bg-share', (e) => e.hidden)) && (await bp.$eval('#bg-dl-file', (e) => e.hidden)) && !(await bp.$eval('#bg-dl-png', (e) => e.hidden)));
  check('bg[en] JPG disabled while transparent', await bp.$eval('#bg-dl-jpg', (b) => b.disabled));
  const cornerOf = (type) => bp.evaluate(async (t) => { const u = await window.__kitBg.exportDataUrl(t); const i = new Image(); i.src = u; await i.decode(); const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const x = c.getContext('2d'); x.drawImage(i, 0, 0); return { type: u.slice(5, u.indexOf(';')), px: Array.from(x.getImageData(5, i.height - 5, 1, 1).data) }; }, type);
  let c = await cornerOf('image/png');
  check('bg[en] transparent PNG: corner alpha 0', c.type === 'image/png' && c.px[3] < 20, JSON.stringify(c));
  await bp.click('input[name=bgmode][value=white]');
  c = await cornerOf('image/jpeg');
  check('bg[en] white background → JPG enabled, corner white', !(await bp.$eval('#bg-dl-jpg', (b) => b.disabled)) && c.type === 'image/jpeg' && c.px.slice(0, 3).every((v) => v > 245), JSON.stringify(c));
  await setVal(bp, '#bg-color', '#ff0000');
  c = await cornerOf('image/png');
  check('bg[en] custom colour → opaque red corner', (await bp.$eval('input[name=bgmode][value=color]', (r) => r.checked)) && c.px[0] > 240 && c.px[1] < 15 && c.px[2] < 15 && c.px[3] === 255, JSON.stringify(c));
  await bp.$eval('#bg-compare', (b) => b.click());
  check('bg[en] "Show original" toggles', (await bp.$eval('#bg-compare', (b) => b.getAttribute('aria-pressed'))) === 'true');
  await bp.$eval('#bg-compare', (b) => b.click());
  check('bg[en] "Show original" toggles back', (await bp.$eval('#bg-compare', (b) => b.getAttribute('aria-pressed'))) === 'false');
  // real download
  await bp.click('input[name=bgmode][value=transparent]');
  const before = new Set(readdirSync(DL));
  await bp.click('#bg-dl-png');
  let dl = null;
  for (let i = 0; i < 80 && !dl; i++) { dl = readdirSync(DL).find((f) => !before.has(f) && f.endsWith('-nobg.png')); if (!dl) await new Promise((r) => setTimeout(r, 100)); }
  const dlPng = dl ? PNG.sync.read(readFileSync(join(DL, dl))) : null;
  check('bg[en] Download PNG: product-shoe-nobg.png, full size, with transparency', dl === 'product-shoe-nobg.png' && dlPng?.width === 1024 && dlPng?.height === 769 && dlPng.data[(dlPng.width * (dlPng.height - 5) + 5) * 4 + 3] < 20, String(dl));
  // newsletter on the tool page, under COEP
  await setVal(bp, '#nl-email', 'reader@example.com');
  await bp.click('#nl-form button');
  await waitNlDone(bp);
  const nm = await nlMsg(bp);
  check('bg[en] newsletter signup works under COEP (mocked MailerLite)', nm.text === 'Check your inbox to confirm.' && nm.cls.includes('ok') && mlPosts.at(-1)?.body === 'fields%5Bemail%5D=reader%40example.com&ml-submit=1&anticsrf=true', JSON.stringify(nm));
  await bp.close();

  // second visit: model comes from the Cache API; ?threads=1 = single-thread fallback path
  const bp2 = await newPage();
  await bp2.goto(BASE + '/remove-bg/?threads=1', { waitUntil: 'networkidle0' });
  const st2 = await upload(bp2, join(BGFIX, 'dog-labrador.jpg'));
  check('bg[en] second visit: model loaded from the browser cache', st2.status === 'done' && st2.fromCache === true, JSON.stringify(st2));
  check('bg[en] single-thread fallback works', st2.status === 'done' && st2.threads === 1, JSON.stringify(st2));
  timings.push(`dog-labrador.jpg single-thread ${st2.ms} ms inference`);
  await bp2.close();

  // Italian page
  const ip = await newPage();
  const iml = await mockMailerLiteScoped(ip);
  await ip.goto(BASE + '/it/rimuovi-sfondo/', { waitUntil: 'networkidle0' });
  const ist = await upload(ip, join(BGFIX, 'portrait-aldrin.jpg'));
  check('bg[it] works, Italian status', ist.status === 'done' && /^Fatto in \d+\.\d s\./.test(ist.text), JSON.stringify(ist));
  check('bg[it] countdown in Italian', /Mancan|chiuso/.test(await ip.$eval('[data-deadline]', (e) => e.textContent)));
  iml.mode = 'ok';
  await setVal(ip, '#nl-email', 'lettore@example.it');
  await ip.click('#nl-form button');
  await waitNlDone(ip);
  check('bg[it] newsletter signup works', (await nlMsg(ip)).text === 'Controlla la posta per confermare.');
  await ip.close();

  // Optional SaaS Trap box after a cut-out: hidden before, shown after, below the downloads, closable + remembered
  {
    const stState = (p) => p.evaluate(() => { const b = document.querySelector('#st-box'); const r = b.getBoundingClientRect(); const dl = document.querySelector('#bg-result .dl').getBoundingClientRect(); const cv = document.querySelector('#bg-canvas').getBoundingClientRect(); return { hidden: b.hidden || r.height === 0, belowDl: r.top >= dl.bottom - 1, belowCanvas: r.top >= cv.bottom - 1, text: document.querySelector('#st-text').textContent, h: document.querySelector('#st-h').textContent, stored: localStorage.getItem('kitlibre:saastrap-box'), close: (() => { const c = document.querySelector('#st-close').getBoundingClientRect(); return [Math.round(c.width), Math.round(c.height)]; })(), overflowX: document.scrollingElement.scrollWidth > innerWidth } });
    const sp = await newPage({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await mockMailerLiteScoped(sp);
    await sp.goto(BASE + '/remove-bg/', { waitUntil: 'networkidle0' });
    await sp.evaluate(() => localStorage.removeItem('kitlibre:saastrap-box'));
    check('st[en] box hidden before any cut-out', (await sp.$eval('#st-box', (b) => b.hidden)) && !(await sp.$eval('#bg-result', (r) => !r.hidden)));
    await (await sp.$('#bg-file')).uploadFile(join(DIST, 'robots.txt'));
    await sp.waitForFunction(() => window.__kitBg.status === 'error');
    check('st[en] box not shown after a failed attempt', await sp.$eval('#st-box', (b) => b.hidden));
    let s0 = await upload(sp, join(BGFIX, 'portrait-aldrin.jpg'));
    let st = await stState(sp);
    check('st[en] box shown after a successful cut-out, below the download buttons, not over the result', s0.status === 'done' && !st.hidden && st.belowDl && st.belowCanvas && !st.overflowX, JSON.stringify(st));
    check('st[en] copy + 44px close button', st.h === 'SaaS Trap of the Week' && st.text.startsWith('remove.bg shuts down on 1 December. Every week, SaaS Trap tells you') && st.close[0] >= 44 && st.close[1] >= 44, JSON.stringify(st));
    check('st[en] box form posts to the existing SaaS Trap MailerLite form', (await sp.$eval('#st-form', (f) => f.action)) === (await sp.$eval('#nl-form', (f) => f.action)) && (await sp.$eval('#st-form', (f) => f.action)).includes('/forms/201738245033166731/'));
    // tool fully usable without the email: download works with the box open and untouched
    await sp.click('#bg-dl-png');
    await sp.waitForFunction(() => window.__kitBg.lastDownload?.name === 'portrait-aldrin-nobg.png', { timeout: 5000 }).catch(() => {});
    check('st[en] download works without giving an email', (await sp.evaluate(() => window.__kitBg.lastDownload?.name)) === 'portrait-aldrin-nobg.png');
    // invalid email → error, nothing posted
    const n0 = mlPosts.length;
    await setVal(sp, '#st-email', 'nope');
    await sp.click('#st-form button');
    check('st[en] invalid email → error, no request', (await sp.$eval('#st-msg', (m) => m.textContent)) === 'Please enter a valid email address.' && mlPosts.length === n0);
    // close → hidden, remembered, focus back on the primary download button; next cut-out: not shown
    await sp.click('#st-close');
    st = await stState(sp);
    check('st[en] X closes the box and remembers it (localStorage)', st.hidden && st.stored === 'dismissed' && (await sp.evaluate(() => document.activeElement?.id)) === 'bg-dl-png', JSON.stringify(st));
    await sp.reload({ waitUntil: 'networkidle0' });
    s0 = await upload(sp, join(BGFIX, 'dog-labrador.jpg'));
    check('st[en] closed box stays closed after reload + new cut-out', s0.status === 'done' && (await stState(sp)).hidden);
    // subscribe from the box (MailerLite mocked) → success message, remembered
    await sp.evaluate(() => localStorage.removeItem('kitlibre:saastrap-box'));
    await sp.reload({ waitUntil: 'networkidle0' });
    await upload(sp, join(BGFIX, 'dog-labrador.jpg'));
    await setVal(sp, '#st-email', 'reader@example.com');
    await sp.click('#st-form button');
    await sp.waitForFunction(() => document.querySelector('#st-msg').textContent !== '', { timeout: 5000 });
    st = await stState(sp);
    check('st[en] signup from the box (mocked): double opt-in message, same body as the other forms, remembered', (await sp.$eval('#st-msg', (m) => m.textContent)) === 'Check your inbox to confirm.' && mlPosts.at(-1)?.url.includes('/forms/201738245033166731/') && mlPosts.at(-1)?.body === 'fields%5Bemail%5D=reader%40example.com&ml-submit=1&anticsrf=true' && st.stored === 'subscribed', JSON.stringify(mlPosts.at(-1)));
    await sp.reload({ waitUntil: 'networkidle0' });
    await upload(sp, join(BGFIX, 'cat-grass.jpg'));
    check('st[en] after subscribing the box is not shown again', (await stState(sp)).hidden);
    await sp.evaluate(() => localStorage.removeItem('kitlibre:saastrap-box'));
    await sp.close();
    // Italian + after the deadline
    const ip2 = await newPage({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await mockMailerLiteScoped(ip2);
    await ip2.goto(BASE + '/it/rimuovi-sfondo/', { waitUntil: 'networkidle0' });
    await upload(ip2, join(BGFIX, 'dog-labrador.jpg'));
    st = await stState(ip2);
    check('st[it] Italian copy', !st.hidden && st.h === 'SaaS Trap della settimana' && st.text === 'remove.bg chiude il 1° dicembre. Ogni settimana SaaS Trap ti dice quale tool sta per mettere un paywall, e l’alternativa gratuita.' && (await ip2.$eval('#st-close', (b) => b.getAttribute('aria-label'))) === 'Chiudi il riquadro della newsletter', JSON.stringify(st));
    await ip2.close();
    const late = await newPage();
    await late.evaluateOnNewDocument(() => { const R = Date, fixed = R.parse('2026-12-05T10:00:00Z'); window.Date = class extends R { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } }; });
    await late.goto(BASE + '/remove-bg/', { waitUntil: 'networkidle0' });
    check('st[en] after 1 December the box says remove.bg has shut down', (await late.$eval('#st-text', (e) => e.textContent)).startsWith('remove.bg has shut down.'));
    await late.close();
  }
  // iOS share sheet ("Save to Photos" primary) and Copy, with navigator.share / canShare / clipboard mocked
  const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';
  const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
  const mockShare = () => {
    window.__shares = []; window.__copies = []; window.__shareReject = null;
    navigator.canShare = (d) => !!d?.files?.length && d.files.every((f) => f instanceof File);
    navigator.share = (d) => {
      window.__shares.push({ active: navigator.userActivation.isActive, files: d.files.map((f) => ({ name: f.name, type: f.type, size: f.size })) });
      return window.__shareReject ? Promise.reject(new DOMException('x', window.__shareReject)) : Promise.resolve();
    };
    window.ClipboardItem = class { constructor(items) { this.items = items; } };
    Object.defineProperty(navigator, 'clipboard', { value: { write: (list) => {
      const v = list[0].items['image/png'];
      const rec = { active: navigator.userActivation.isActive, promise: typeof v?.then === 'function' };
      window.__copies.push(rec);
      return Promise.resolve(v).then((b) => { rec.type = b.type; rec.size = b.size; });
    } }, configurable: true });
  };
  const shareMobile = async (ua, path) => {
    const p = await newPage();
    await p.setUserAgent(ua);
    await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await p.evaluateOnNewDocument(mockShare);
    await p.goto(BASE + path, { waitUntil: 'networkidle0' });
    return p;
  };
  const vis = (p, sel) => p.$eval(sel, (e) => !e.hidden && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0);
  for (const [lang, path, save, dlf] of [['it', '/it/rimuovi-sfondo/', 'Salva in Foto', 'Scarica file'], ['en', '/remove-bg/', 'Save to Photos', 'Download file']]) {
    const sp = await shareMobile(IOS_UA, path);
    const sst = await upload(sp, join(BGFIX, 'dog-labrador.jpg'));
    check(`ios[${lang}] cut-out done`, sst.status === 'done', JSON.stringify(sst));
    const ui = await sp.evaluate(() => ({ share: document.querySelector('#bg-share').textContent, primary: document.querySelector('#bg-share').classList.contains('primary'), file: document.querySelector('#bg-dl-file').textContent, mode: window.__kitBg.shareMode }));
    check(`ios[${lang}] "${save}" is the primary button, "${dlf}" secondary, PNG/JPG buttons hidden`, ui.mode === true && ui.share === save && ui.primary && ui.file === dlf && (await vis(sp, '#bg-share')) && (await vis(sp, '#bg-dl-file')) && !(await vis(sp, '#bg-dl-png')) && !(await vis(sp, '#bg-dl-jpg')), JSON.stringify(ui));
    await new Promise((r) => setTimeout(r, 400)); // let the File be prepared after render
    await sp.click('#bg-share');
    let sh = await sp.evaluate(() => ({ shares: window.__shares, last: window.__kitBg.lastShare }));
    check(`ios[${lang}] share sheet opened synchronously in the click with a prepared PNG -nobg File`, sh.shares.length === 1 && sh.shares[0].active === true && sh.shares[0].files.length === 1 && sh.shares[0].files[0].name === 'dog-labrador-nobg.png' && sh.shares[0].files[0].type === 'image/png' && sh.shares[0].files[0].size > 10000 && sh.last.prepared === true, JSON.stringify(sh));
    if (lang === 'it') {
      // solid background → JPG; click right after the change (File not ready yet → synchronous encode, still in the click)
      await sp.click('input[name=bgmode][value=white]');
      await sp.click('#bg-share');
      sh = await sp.evaluate(() => ({ shares: window.__shares, last: window.__kitBg.lastShare }));
      check('ios[it] solid background → shares a JPG -nobg File, still inside the click', sh.shares.length === 2 && sh.shares[1].active === true && sh.shares[1].files[0].name === 'dog-labrador-nobg.jpg' && sh.shares[1].files[0].type === 'image/jpeg' && sh.shares[1].files[0].size > 10000, JSON.stringify(sh.shares[1]));
      await sp.click('#bg-dl-file');
      await sp.waitForFunction(() => window.__kitBg.lastDownload?.name === 'dog-labrador-nobg.jpg', { timeout: 5000 }).catch(() => {});
      check('ios[it] "Scarica file" still downloads via <a download> (JPG on solid background)', (await sp.evaluate(() => window.__kitBg.lastDownload?.name)) === 'dog-labrador-nobg.jpg');
      await sp.evaluate(() => { window.__shareReject = 'AbortError'; });
      const before = await sp.$eval('#bg-status', (e) => e.textContent);
      await sp.click('#bg-share');
      await new Promise((r) => setTimeout(r, 200));
      check('ios[it] cancelling the share sheet shows no error', (await sp.$eval('#bg-status', (e) => e.textContent)) === before);
      await sp.evaluate(() => { window.__shareReject = 'NotAllowedError'; });
      await sp.click('#bg-share');
      await new Promise((r) => setTimeout(r, 200));
      check('ios[it] share failure → hint to use "Scarica file"', (await sp.$eval('#bg-status', (e) => e.textContent)) === 'La condivisione non ha funzionato: usa Scarica file.');
    }
    // Copy: clipboard.write() called synchronously in the click, with a Promise<Blob> (what Safari requires)
    await sp.click('#bg-copy');
    await sp.waitForFunction(() => window.__copies.length && window.__copies[0].type, { timeout: 5000 }).catch(() => {});
    const cp = await sp.evaluate(() => ({ c: window.__copies[0], label: document.querySelector('#bg-copy').textContent }));
    check(`ios[${lang}] Copy: clipboard.write in the click with a promise → image/png`, cp.c?.active === true && cp.c.promise === true && cp.c.type === 'image/png' && cp.c.size > 10000 && cp.label === (lang === 'it' ? 'Copiata' : 'Copied'), JSON.stringify(cp));
    await sp.close();
  }
  // Android (share API available too) and desktop keep Download PNG as the primary button
  const ap0 = await shareMobile(ANDROID_UA, '/remove-bg/');
  const ast = await upload(ap0, join(BGFIX, 'cat-grass.jpg'));
  check('android: Download PNG stays primary, no share button', ast.status === 'done' && (await ap0.evaluate(() => window.__kitBg.shareMode)) === false && (await vis(ap0, '#bg-dl-png')) && !(await vis(ap0, '#bg-share')) && !(await vis(ap0, '#bg-dl-file')));
  await ap0.close();
  // remove.bg alternative pages
  for (const [path, lang, tool] of [['/remove-bg-alternative/', 'en', '/remove-bg/'], ['/it/alternativa-remove-bg/', 'it', '/it/rimuovi-sfondo/']]) {
    const ap = await newPage();
    await mockMailerLite(ap);
    await ap.goto(BASE + path, { waitUntil: 'networkidle0' });
    const info = await ap.evaluate(() => ({
      text: document.querySelector('main').textContent,
      toolLinks: [...document.querySelectorAll('main a.btn.primary')].map((a) => a.getAttribute('href')),
      faq: [...document.querySelectorAll('main a[href="https://www.remove.bg/faq"]')].length,
      rows: document.querySelectorAll('main table tbody tr').length,
      imgs: document.querySelectorAll('main img').length,
      nl: !!document.querySelector('#nl-form'),
    }));
    check(`alt[${lang}] cites the remove.bg FAQ and the 1 Dec 2026 date`, info.faq >= 1 && (lang === 'it' ? /1° dicembre 2026 alle 9:00 CET/ : /1 December 2026 at 9:00 CET/).test(info.text));
    check(`alt[${lang}] trademark + not-affiliated disclaimer`, lang === 'it' ? /marchio del suo titolare[\s\S]*non è affiliato/.test(info.text) : /trademark of its owner[\s\S]*not affiliated/.test(info.text));
    check(`alt[${lang}] CTAs to the tool, comparison table, no images/logos`, info.toolLinks.length >= 2 && info.toolLinks.every((h) => h === tool) && info.rows === 6 && info.imgs === 0, JSON.stringify(info.toolLinks));
    await setVal(ap, '#nl-email', 'reader@example.com');
    await ap.click('#nl-form button');
    await waitNlDone(ap);
    check(`alt[${lang}] newsletter signup works`, (await nlMsg(ap)).cls.includes('ok'));
    // internal links: tool page links here, footer links both
    await ap.close();
  }
  const lp = await newPage();
  await lp.goto(BASE + '/qr/', { waitUntil: 'networkidle0' });
  const nav = await lp.evaluate(() => ({ nav: [...document.querySelectorAll('.site-header nav a')].map((a) => a.getAttribute('href')), foot: [...document.querySelectorAll('.foot-links a')].map((a) => a.getAttribute('href')) }));
  check('header nav + footer link the background remover and the alternative page', nav.nav.includes('/remove-bg/') && nav.foot.includes('/remove-bg/') && nav.foot.includes('/remove-bg-alternative/'), JSON.stringify(nav));
  await lp.goto(BASE + '/remove-bg/', { waitUntil: 'networkidle0' });
  check('bg page links to the alternative page and the IT version', (await lp.$$eval('a[href="/remove-bg-alternative/"]', (l) => l.length)) >= 1 && (await lp.$eval('a[hreflang=it]', (a) => a.getAttribute('href'))) === '/it/rimuovi-sfondo/');
  await lp.close();
  console.log('bg timings (box, headless Chrome, WASM):\n  ' + timings.join('\n  '));
}

check('MailerLite only contacted on submit (all mocked)', mlPosts.every((p) => p.url === 'https://assets.mailerlite.com/jsonp/2342555/forms/201738245033166731/subscribe'), String(mlPosts.length));
check('no requests to external origins (no CDN / tracking)', external.length === 0, external.slice(0, 5).join(', '));
check('no console errors / CSP violations', consoleErrors.length === 0, consoleErrors.slice(0, 5).join(' | '));

await browser.close();
server.close();
console.log(results.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
