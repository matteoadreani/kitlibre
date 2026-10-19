import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  applyAlpha, concatParts, daysUntil, fitSize, isImageFile, matteToAlpha, outputName, overColor, parseHex, partSize, partUrls, pickThreads, toHex, toTensor, ENGINE_CFG,
} from '../src/bg/pipeline';
import { STRINGS, ROUTES, LEGACY_REDIRECTS } from '../src/i18n';
import { redirectsFile, sitemapXml, generatePages } from '../scripts/pages';

const ROOT = join(import.meta.dirname, '..');

describe('background remover: pure pipeline', () => {
  it('fitSize caps the long edge and never upscales', () => {
    expect(fitSize(800, 600)).toEqual({ w: 800, h: 600, scaled: false });
    expect(fitSize(8000, 4000, 4096)).toEqual({ w: 4096, h: 2048, scaled: true });
    expect(fitSize(3000, 6000, 2560)).toEqual({ w: 1280, h: 2560, scaled: true });
    expect(() => fitSize(0, 10)).toThrow();
  });
  it('toTensor builds planar CHW in [0,1] without mean/std', () => {
    const px = new Uint8ClampedArray([255, 0, 51, 255, 0, 102, 255, 255]);
    const t = toTensor(px.slice(0, 4), 1);
    expect(t.length).toBe(3);
    const t2 = toTensor(new Uint8ClampedArray(16).map((_, i) => (i % 4 === 3 ? 255 : i * 10)), 2);
    expect(Array.from(t2.slice(0, 4)).map((v) => Math.round(v * 255))).toEqual([0, 40, 80, 120]); // R plane
    expect(Array.from(t2.slice(4, 8)).map((v) => Math.round(v * 255))).toEqual([10, 50, 90, 130]); // G plane
    expect(Math.round(t[0] * 255)).toBe(255);
    expect(() => toTensor(px, 3)).toThrow();
    expect(() => toTensor(px, 1)).toThrow();
  });
  it('matteToAlpha clamps and handles NaN', () => {
    expect(Array.from(matteToAlpha([0, 0.5, 1, -2, 7, NaN]))).toEqual([0, 128, 255, 0, 255, 0]);
  });
  it('applyAlpha keeps colours and multiplies existing alpha', () => {
    const rgba = new Uint8ClampedArray([10, 20, 30, 255, 1, 2, 3, 128]);
    expect(Array.from(applyAlpha(rgba, new Uint8ClampedArray([0, 255])))).toEqual([10, 20, 30, 0, 1, 2, 3, 128]);
    expect(Array.from(rgba)).toEqual([10, 20, 30, 255, 1, 2, 3, 128]); // input untouched
    expect(() => applyAlpha(rgba, new Uint8ClampedArray(3))).toThrow();
  });
  it('overColor composites straight alpha over a solid colour', () => {
    const out = overColor(new Uint8ClampedArray([200, 100, 0, 0, 200, 100, 0, 255, 200, 100, 0, 128]), [0, 0, 255]);
    expect(Array.from(out)).toEqual([0, 0, 255, 255, 200, 100, 0, 255, 100, 50, 127, 255]);
  });
  it('parseHex', () => {
    expect(parseHex('#0f766e')).toEqual([15, 118, 110]);
    expect(parseHex('fff')).toEqual([255, 255, 255]);
    expect(parseHex('#12345')).toBeNull();
  });
  it('model parts: urls, sizes and reassembly', () => {
    const m = { dir: '/x/', bytes: 10, partBytes: 4 };
    expect(partUrls(m)).toEqual(['/x/part-0.bin', '/x/part-1.bin', '/x/part-2.bin']);
    expect([0, 1, 2].map((i) => partSize(m, i))).toEqual([4, 4, 2]);
    const parts = [new Uint8Array([1, 2, 3, 4]), new Uint8Array([5, 6, 7, 8]), new Uint8Array([9, 10])];
    expect(Array.from(concatParts(parts, 10))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(() => concatParts(parts.slice(0, 2), 10)).toThrow(/smaller/);
    expect(() => concatParts(parts, 9)).toThrow(/larger/);
    expect(toHex(new Uint8Array([0, 15, 255]).buffer)).toBe('000fff');
  });
  it('output names, file types, countdown, threads', () => {
    expect(outputName('holiday photo.JPG', 'png')).toBe('holiday photo-nobg.png');
    expect(outputName('a/b:c?.webp', 'jpg')).toBe('a_b_c_-nobg.jpg');
    expect(outputName('', 'png')).toBe('image-nobg.png');
    expect(isImageFile({ type: 'image/webp', name: 'x' })).toBe(true);
    expect(isImageFile({ type: '', name: 'IMG_1.HEIC' })).toBe(true);
    expect(isImageFile({ type: 'application/pdf', name: 'a.pdf' })).toBe(false);
    const d = new Date('2026-12-01T08:00:00Z');
    expect(daysUntil(d, new Date('2026-10-30T10:00:00Z'))).toBe(32);
    expect(daysUntil(d, new Date('2026-12-01T07:00:00Z'))).toBe(1);
    expect(daysUntil(d, new Date('2026-12-02T00:00:00Z'))).toBe(0);
    expect(pickThreads(false, 16)).toBe(1);
    expect(pickThreads(true, 16)).toBe(4);
    expect(pickThreads(true, 2)).toBe(2);
    expect(pickThreads(true, undefined)).toBe(4);
  });
});

describe('background remover: engine manifest and hosting', () => {
  const m = ENGINE_CFG.model;
  it('every part stays below the Cloudflare Pages 25 MiB file limit', () => {
    expect(ENGINE_CFG.pagesFileLimit).toBe(25 * 1024 * 1024);
    expect(m.partBytes).toBeLessThan(ENGINE_CFG.pagesFileLimit);
    expect(partUrls(m).length).toBe(Math.ceil(m.bytes / m.partBytes));
    expect(m.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(m.dir).toContain(m.sha256.slice(0, 8)); // content-addressed → safe to cache as immutable
    expect(m.source).toMatch(/\/resolve\/[0-9a-f]{40}\//); // pinned revision
  });
  it('licences are declared and shipped', () => {
    expect(m.licence).toBe('Apache-2.0');
    expect(ENGINE_CFG.ort.licence).toBe('MIT');
    expect(readFileSync(join(ROOT, m.licenceFile), 'utf8')).toContain('Apache License');
    expect(readFileSync(join(ROOT, ENGINE_CFG.ort.licenceFile), 'utf8')).toContain('MIT License');
    expect(readFileSync(join(ROOT, 'THIRD_PARTY_NOTICES.md'), 'utf8')).toMatch(/ormbg[\s\S]*Apache-2\.0[\s\S]*ONNX Runtime[\s\S]*MIT/);
  });
  it('pinned onnxruntime-web version matches package.json', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.dependencies['onnxruntime-web']).toBe(ENGINE_CFG.ort.version);
  });
});

describe('background remover: headers, routes, SEO', () => {
  const headers = readFileSync(join(ROOT, 'public/_headers'), 'utf8');
  const blocks = Object.fromEntries(headers.split(/\n(?=\S)/).filter((b) => !b.startsWith('#')).map((b) => [b.split('\n')[0].trim(), b]));
  it('the site-wide CSP is unchanged and still strict', () => {
    expect(blocks['/*']).toContain(
      "Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' https://assets.mailerlite.com; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self' https://assets.mailerlite.com; frame-ancestors 'none'",
    );
    expect(blocks['/*']).not.toContain('wasm-unsafe-eval');
    expect(blocks['/*']).not.toContain('Cross-Origin-Embedder-Policy');
  });
  for (const path of [ROUTES.bg.en + '*', ROUTES.bg.it + '*', '/engine/*']) {
    it(`${path}: detaches the global CSP, allows WASM, sets COEP`, () => {
      const b = blocks[path];
      expect(b, path).toBeTruthy();
      expect(b).toMatch(/! Content-Security-Policy\n/);
      expect(b).toMatch(/Content-Security-Policy: [^\n]*script-src 'self' 'wasm-unsafe-eval'/);
      expect(b).toMatch(/worker-src 'self'/);
      expect(b).not.toMatch(/'unsafe-inline'|'unsafe-eval'|\*\.|https?:\/\/(?!assets\.mailerlite\.com)/);
      expect(b).toContain('Cross-Origin-Embedder-Policy: require-corp');
    });
  }
  it('the tool pages keep MailerLite in connect-src / form-action', () => {
    for (const p of [ROUTES.bg.en + '*', ROUTES.bg.it + '*']) {
      expect(blocks[p]).toContain("connect-src 'self' https://assets.mailerlite.com");
      expect(blocks[p]).toContain("form-action 'self' https://assets.mailerlite.com");
    }
  });
  it('routes and 301s', () => {
    expect(ROUTES.bg).toEqual({ en: '/remove-bg/', it: '/it/rimuovi-sfondo/' });
    expect(ROUTES.bgAlt).toEqual({ en: '/remove-bg-alternative/', it: '/it/alternativa-remove-bg/' });
    const r = redirectsFile();
    for (const l of ['/bg/ /remove-bg/ 301', '/bg /remove-bg/ 301', '/remove-background/ /remove-bg/ 301', '/remove-background /remove-bg/ 301', '/it/bg/ /it/rimuovi-sfondo/ 301'])
      expect(r).toContain(l);
    expect(LEGACY_REDIRECTS.every(([, to]) => Object.values(ROUTES).some((x) => x.en === to || x.it === to))).toBe(true);
  });
  it('sitemap lists the new pages with hreflang', () => {
    const sm = sitemapXml();
    for (const u of ['/remove-bg/', '/it/rimuovi-sfondo/', '/remove-bg-alternative/', '/it/alternativa-remove-bg/']) expect(sm).toContain(`<loc>https://kitlibre.com${u}</loc>`);
    expect(sm).toContain('hreflang="it" href="https://kitlibre.com/it/alternativa-remove-bg/"');
  });
  it('EN/IT copy has the same shape', () => {
    const en = STRINGS.en as Record<string, unknown>, itS = STRINGS.it as Record<string, unknown>;
    for (const k of Object.keys(en).filter((k) => /^(bg|alt|nav)/.test(k))) {
      expect(typeof itS[k], k).toBe(typeof en[k]);
      if (Array.isArray(en[k])) expect((itS[k] as unknown[]).length, k).toBe((en[k] as unknown[]).length);
    }
  });
  it('alternative page: source link, disclaimer, CTA to the tool, newsletter, no remove.bg logo or images', () => {
    const pages = generatePages();
    for (const [file, tool] of [['remove-bg-alternative/index.html', '/remove-bg/'], ['it/alternativa-remove-bg/index.html', '/it/rimuovi-sfondo/']]) {
      const html = pages.find((p) => p.file === file)!.html;
      expect(html).toContain('href="https://www.remove.bg/faq"');
      expect(html).toMatch(/trademark of its owner|marchio del suo titolare/);
      expect(html).toMatch(/not affiliated|non è affiliato/);
      expect(html).toContain(`href="${tool}"`);
      expect(html).toContain('id="nl-form"');
      expect(html).not.toMatch(/<img[^>]*remove/i);
      expect(html).toMatch(/1 December 2026|1° dicembre 2026/);
    }
  });
});
