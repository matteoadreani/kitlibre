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
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.xml': 'application/xml', '.txt': 'text/plain', '.webmanifest': 'application/manifest+json' };

// ---- tiny static server honouring the "/*" block of _headers
const globalHeaders = {};
{
  const lines = readFileSync(join(DIST, '_headers'), 'utf8').split('\n');
  let inGlobal = false;
  for (const l of lines) {
    if (/^\S/.test(l)) inGlobal = l.trim() === '/*';
    else if (inGlobal && l.trim()) { const i = l.indexOf(':'); globalHeaders[l.slice(0, i).trim()] = l.slice(i + 1).trim(); }
  }
}
const redirects = new Map(readFileSync(join(DIST, '_redirects'), 'utf8').split('\n').filter(Boolean).map((l) => l.split(/\s+/)));
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (redirects.has(p)) { res.writeHead(301, { Location: redirects.get(p) }); return res.end(); }
  let f = join(DIST, p);
  if (existsSync(f) && statSync(f).isDirectory()) f = join(f, 'index.html');
  let status = 200;
  if (!existsSync(f)) { f = join(DIST, '404.html'); status = 404; }
  res.writeHead(status, { 'Content-Type': TYPES[extname(f)] || 'application/octet-stream', ...globalHeaders });
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
  page.on('request', (r) => { const u = r.url(); if (!u.startsWith(BASE) && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u); });
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  await page.evaluateOnNewDocument(() => document.addEventListener('securitypolicyviolation', (e) => console.error('CSP violation: ' + e.violatedDirective + ' ' + e.blockedURI)));
  return page;
}
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
const reqBefore = external.length;
await setVal(page, '#nl-email', 'test@example.com');
await page.click('#nl-form button');
check('newsletter is a no-op placeholder (message shown, no request)', (await page.$eval('#nl-msg', (m) => m.textContent)).length > 0 && external.length === reqBefore);

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
for (const path of ['/', '/qr/', '/qr/check/', '/newsletter/', '/privacy/', '/it/', '/it/qr/', '/it/qr/verifica/', '/it/newsletter/', '/it/privacy/']) {
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
check('sitemap.xml lists 10 kitlibre.com URLs', (sm.match(/<loc>https:\/\/kitlibre\.com\//g) || []).length === 10);
check('robots.txt allows indexing + sitemap', /Allow: \/[\s\S]*Sitemap: https:\/\/kitlibre\.com\/sitemap\.xml/.test(readFileSync(join(DIST, 'robots.txt'), 'utf8')));
for (const [from, to] of [['/check/', '/qr/check/'], ['/it/verifica/', '/it/qr/verifica/'], ['/check', '/qr/check/']]) {
  const r = await fetch(BASE + from, { redirect: 'manual' });
  check(`legacy ${from} → 301 ${to}`, r.status === 301 && r.headers.get('location') === to, `${r.status} ${r.headers.get('location')}`);
}
// Hub + newsletter page
for (const [path, lang] of [['/', 'en'], ['/it/', 'it']]) {
  const hp = await newPage();
  await hp.goto(BASE + path, { waitUntil: 'networkidle0' });
  const hub = await hp.evaluate(() => ({ cards: document.querySelectorAll('.tool-card').length, soon: document.querySelectorAll('.tool-card.soon').length,
    links: [...document.querySelectorAll('.tool-card:not(.soon) h3 a')].map((a) => a.getAttribute('href')), nl: document.querySelector('.nl-teaser a')?.getAttribute('href'), h1: document.querySelector('h1').textContent }));
  const exp = lang === 'it' ? ['/it/qr/', '/it/qr/verifica/'] : ['/qr/', '/qr/check/'];
  check(`hub[${lang}] 2 live tools + 5 coming soon`, hub.cards === 7 && hub.soon === 5, JSON.stringify(hub));
  check(`hub[${lang}] links to QR tools + newsletter`, hub.links.join() === exp.join() && hub.nl === (lang === 'it' ? '/it/newsletter/' : '/newsletter/'));
  check(`hub[${lang}] tagline h1`, lang === 'it' ? hub.h1.startsWith('Strumenti gratuiti') : hub.h1 === 'Free tools. No subscription. No signup required. Forever.', hub.h1);
  await hp.goto(BASE + (lang === 'it' ? '/it/newsletter/' : '/newsletter/'), { waitUntil: 'networkidle0' });
  const before = external.length;
  await setVal(hp, '#nl-email', 'test@example.com');
  await hp.click('#nl-form button');
  await settle(hp);
  check(`newsletter page[${lang}] named + placeholder no-op`, (await hp.$eval('h1', (h) => h.textContent)) === 'SaaS Trap of the Week' && (await hp.$eval('#nl-msg', (m) => m.textContent)).length > 0 && external.length === before);
  await hp.close();
}

check('no requests to external origins (no CDN / tracking)', external.length === 0, external.slice(0, 5).join(', '));
check('no console errors / CSP violations', consoleErrors.length === 0, consoleErrors.slice(0, 5).join(' | '));

await browser.close();
server.close();
console.log(results.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
