import { describe, expect, it } from 'vitest';
import jsQR from 'jsqr';
import { applyUtm, buildEmail, buildPhone, buildSms, buildUrl, buildVCard, buildWifi } from '../src/payload';
import { makeMatrix, toSvg, type EcLevel, type Matrix, type RenderOptions } from '../src/render';
import { classify } from '../src/classify';
import { DOMAINS } from '../src/domains';

/** Rasterises a matrix to RGBA (like the PNG path) at `scale` px per module. */
function rasterMatrix(m: Matrix, margin: number, scale = 6) {
  const n = (m.size + margin * 2) * scale;
  const px = new Uint8ClampedArray(n * n * 4).fill(255);
  for (let y = 0; y < m.size; y++)
    for (let x = 0; x < m.size; x++)
      if (m.data[y * m.size + x])
        for (let dy = 0; dy < scale; dy++)
          for (let dx = 0; dx < scale; dx++) {
            const i = (((y + margin) * scale + dy) * n + (x + margin) * scale + dx) * 4;
            px[i] = px[i + 1] = px[i + 2] = 0;
          }
  return { px, n };
}

/** Rasterises our SVG output by interpreting its path (M x y h w v1 h-w z), proving the SVG encodes the same modules. */
function rasterSvg(svg: string, scale = 6) {
  const total = Number(/viewBox="0 0 (\d+) /.exec(svg)![1]);
  const d = /<path fill="[^"]+" d="([^"]*)"/.exec(svg)![1];
  const n = total * scale;
  const px = new Uint8ClampedArray(n * n * 4).fill(255);
  for (const [, xs, ys, ws] of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    const [x, y, w] = [Number(xs), Number(ys), Number(ws)];
    for (let dy = 0; dy < scale; dy++)
      for (let dx = 0; dx < w * scale; dx++) {
        const i = ((y * scale + dy) * n + x * scale + dx) * 4;
        px[i] = px[i + 1] = px[i + 2] = 0;
      }
  }
  return { px, n };
}

const cases: [string, string][] = [
  ['url', buildUrl('example.com/menu?x=1', { source: 'flyer', medium: 'qr', campaign: 'spring sale' })],
  ['text', 'Ciao! Questo è un test con accenti àèìòù, emoji 🎉 e simboli €'],
  ['wifi', buildWifi({ ssid: 'Casa;Rossi', password: 'p@ss:w"rd,1', security: 'WPA', hidden: true })],
  ['vcard', buildVCard({ firstName: 'Mario', lastName: 'Rossi', org: 'Rossi & Figli, Srl', phone: '+39 02 1234567', email: 'mario@example.it', website: 'example.it', city: 'Milano', note: 'Line1\nLine2' })],
  ['email', buildEmail({ to: 'info@example.com', subject: 'Hello there', body: 'Body & more?' })],
  ['phone', buildPhone('+39 (333) 123-4567')],
  ['sms', buildSms({ phone: '+1 555 0100', message: 'Hi: see you at 5' })],
];

describe('payload builders', () => {
  it('url + utm', () => {
    expect(buildUrl('example.com')).toBe('https://example.com');
    expect(applyUtm('https://a.com/p?x=1#top', { source: 'flyer', campaign: 'a b' })).toBe('https://a.com/p?x=1&utm_source=flyer&utm_campaign=a+b#top');
    expect(applyUtm('https://a.com', {})).toBe('https://a.com');
  });
  it('wifi escaping', () => {
    expect(buildWifi({ ssid: 'A;B', password: 'x:y', security: 'WPA' })).toBe('WIFI:T:WPA;S:A\\;B;P:x\\:y;;');
    expect(buildWifi({ ssid: 'Open', security: 'nopass', password: 'ignored' })).toBe('WIFI:T:nopass;S:Open;;');
    expect(buildWifi({ ssid: ' ', security: 'WPA' })).toBe('');
  });
  it('vcard', () => {
    const v = buildVCard({ firstName: 'Mario', lastName: 'Rossi', org: 'A, B' });
    expect(v).toContain('BEGIN:VCARD\r\nVERSION:3.0\r\nN:Rossi;Mario;;;\r\nFN:Mario Rossi\r\nORG:A\\, B');
    expect(v.endsWith('END:VCARD')).toBe(true);
  });
  it('email/phone/sms', () => {
    expect(buildEmail({ to: 'a@b.c', subject: 'x y' })).toBe('mailto:a@b.c?subject=x%20y');
    expect(buildPhone('+39 333-12 34')).toBe('tel:+393331234');
    expect(buildSms({ phone: '333 1', message: 'ok' })).toBe('SMSTO:3331:ok');
  });
});

describe('round-trip: generate → render → decode', () => {
  for (const ec of ['L', 'M', 'Q', 'H'] as EcLevel[])
    for (const [type, text] of cases)
      it(`${type} @${ec} (matrix and SVG)`, () => {
        const opts: RenderOptions = { ec, margin: 4, fg: '#000000', bg: '#ffffff', logo: null };
        const m = makeMatrix(text, opts);
        const a = rasterMatrix(m, 4);
        expect(jsQR(a.px, a.n, a.n)?.data).toBe(text);
        const s = rasterSvg(toSvg(m, opts));
        expect(jsQR(s.px, s.n, s.n)?.data).toBe(text);
      });

  it('logo hole (22%, EC H) still decodes', () => {
    const text = cases[0][1];
    const opts: RenderOptions = { ec: 'H', margin: 4, fg: '#000000', bg: '#ffffff', logo: { dataUrl: 'data:,', width: 100, height: 100, ratio: 0.22 } };
    const m = makeMatrix(text, opts);
    expect(m.hole).not.toBeNull();
    const s = rasterSvg(toSvg(m, opts));
    expect(jsQR(s.px, s.n, s.n)?.data).toBe(text);
  });

  it('too much data throws', () => {
    expect(() => makeMatrix('x'.repeat(5000), { ec: 'H', logo: null })).toThrow();
  });
});

describe('trap classifier', () => {
  it.each([
    ['https://qrco.de/bf4Y2u', 'dynamic'],
    ['https://l.ead.me/bbLviR', 'dynamic'],
    ['http://q-r.to/abc', 'dynamic'],
    ['https://me-qr.com/cqMeW6cf', 'dynamic'],
    ['https://qr2.me-qr.com/x', 'dynamic'],
    ['https://qrfy.io/UJaRm-kJdH', 'dynamic'],
    ['https://scnv.io/JbSc', 'dynamic'],
    ['qrs.ly/q9g32qw', 'dynamic'],
    ['https://www.qr-code-generator.com/x', 'dynamic'],
    ['https://qr1.be/GJFL', 'dynamic'],
    ['https://qrd.by/ydr39', 'dynamic'],
    ['https://qr1.at/abc', 'dynamic'],
    ['https://free.qrplanet.com/x', 'dynamic'],
    ['https://hov.to/abc123', 'dynamic'],
    ['https://scango.to/x1', 'dynamic'],
    ['https://canvaqr.com/RGOwjg1rN6', 'dynamic'],
    ['https://bit.ly/3MqL8sO', 'shortener'],
    ['https://tinyurl.com/abc', 'shortener'],
    ['https://goo.gl/maps/abc', 'discontinued'],
    ['https://myapp.page.link/xyz', 'discontinued'],
    ['https://www.comune.milano.it/servizi/menu', 'static'],
    ['https://example.com/', 'static'],
    ['https://xy.ab/Ab3dE9', 'maybe-short'],
    ['WIFI:T:WPA;S:x;P:y;;', 'not-url'],
    ['BEGIN:VCARD\r\nEND:VCARD', 'not-url'],
    ['hello world', 'not-url'],
  ])('%s → %s', (raw, verdict) => {
    expect(classify(raw).verdict).toBe(verdict);
  });
  it('does not match look-alike domains', () => {
    expect(classify('https://notqrco.de/x').verdict).not.toBe('dynamic');
    expect(classify('https://bit.ly.example.com/x').verdict).toBe('static');
  });
  it('domain list has no duplicates', () => {
    const d = DOMAINS.map((x) => x.domain);
    expect(new Set(d).size).toBe(d.length);
  });
});
