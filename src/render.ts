import QRCode from 'qrcode';

export type EcLevel = 'L' | 'M' | 'Q' | 'H';

export interface RenderOptions {
  ec: EcLevel;
  /** Quiet zone in modules (4 is the standard). */
  margin: number;
  fg: string;
  bg: string;
  /** Optional logo as data: URL, with its fraction of the symbol width (0.1–0.3). */
  logo?: { dataUrl: string; ratio: number; width: number; height: number } | null;
}

export interface Matrix {
  size: number;
  version: number;
  /** Row-major, 1 = dark module. */
  data: Uint8Array;
  /** Region (in modules) left blank for the logo, or null. */
  hole: { x: number; y: number; w: number; h: number } | null;
}

export function makeMatrix(text: string, opts: Pick<RenderOptions, 'ec' | 'logo'>): Matrix {
  const qr = QRCode.create(text, { errorCorrectionLevel: opts.ec });
  const size = qr.modules.size;
  const data = new Uint8Array(qr.modules.data as unknown as ArrayLike<number>);
  let hole: Matrix['hole'] = null;
  if (opts.logo) {
    // Keep the cleared box the same parity as the symbol so it is perfectly centred.
    let w = Math.round(size * opts.logo.ratio);
    if ((size - w) % 2) w += 1;
    const aspect = opts.logo.height / Math.max(1, opts.logo.width);
    let h = Math.round(w * Math.min(1, aspect));
    if ((size - h) % 2) h += 1;
    hole = { x: (size - w) / 2, y: (size - h) / 2, w, h };
  }
  return { size, version: qr.version, data, hole };
}

function inHole(m: Matrix, x: number, y: number) {
  const h = m.hole;
  return !!h && x >= h.x && x < h.x + h.w && y >= h.y && y < h.y + h.h;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** Vector output: one <path> for all modules, optional embedded logo. */
export function toSvg(m: Matrix, o: RenderOptions, pixelSize?: number): string {
  const total = m.size + o.margin * 2;
  let d = '';
  for (let y = 0; y < m.size; y++) {
    let x = 0;
    while (x < m.size) {
      if (m.data[y * m.size + x] && !inHole(m, x, y)) {
        let run = 1;
        while (x + run < m.size && m.data[y * m.size + x + run] && !inHole(m, x + run, y)) run++;
        d += `M${x + o.margin} ${y + o.margin}h${run}v1h-${run}z`;
        x += run;
      } else x++;
    }
  }
  const sizeAttr = pixelSize ? ` width="${pixelSize}" height="${pixelSize}"` : '';
  let logo = '';
  if (o.logo && m.hole) {
    const pad = 0.5;
    const hx = m.hole.x + o.margin, hy = m.hole.y + o.margin;
    logo =
      `<rect x="${hx}" y="${hy}" width="${m.hole.w}" height="${m.hole.h}" rx="1" fill="${esc(o.bg)}"/>` +
      `<image x="${hx + pad}" y="${hy + pad}" width="${m.hole.w - pad * 2}" height="${m.hole.h - pad * 2}" ` +
      `preserveAspectRatio="xMidYMid meet" href="${esc(o.logo.dataUrl)}"/>`;
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}"${sizeAttr} shape-rendering="crispEdges">` +
    `<rect width="${total}" height="${total}" fill="${esc(o.bg)}"/>` +
    `<path fill="${esc(o.fg)}" d="${d}"/>` +
    logo +
    `</svg>`
  );
}

/** Raster output on a canvas of exactly `px` × `px`. Module edges are snapped to whole pixels. */
export function drawToCanvas(
  canvas: HTMLCanvasElement,
  m: Matrix,
  o: RenderOptions,
  px: number,
  logoImg?: HTMLImageElement | null,
) {
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d')!;
  const total = m.size + o.margin * 2;
  const s = px / total;
  const edge = (i: number) => Math.round(i * s);
  ctx.fillStyle = o.bg;
  ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = o.fg;
  for (let y = 0; y < m.size; y++)
    for (let x = 0; x < m.size; x++)
      if (m.data[y * m.size + x] && !inHole(m, x, y)) {
        const x0 = edge(x + o.margin), y0 = edge(y + o.margin);
        ctx.fillRect(x0, y0, edge(x + o.margin + 1) - x0, edge(y + o.margin + 1) - y0);
      }
  if (o.logo && m.hole && logoImg) {
    const hx = edge(m.hole.x + o.margin), hy = edge(m.hole.y + o.margin);
    const hw = edge(m.hole.x + o.margin + m.hole.w) - hx, hh = edge(m.hole.y + o.margin + m.hole.h) - hy;
    ctx.fillStyle = o.bg;
    ctx.fillRect(hx, hy, hw, hh);
    const pad = s * 0.5;
    const bw = hw - pad * 2, bh = hh - pad * 2;
    const r = Math.min(bw / logoImg.naturalWidth, bh / logoImg.naturalHeight);
    const w = logoImg.naturalWidth * r, h = logoImg.naturalHeight * r;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(logoImg, hx + pad + (bw - w) / 2, hy + pad + (bh - h) / 2, w, h);
  }
}

/** WCAG relative-luminance contrast ratio between two #rrggbb colours. */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
    const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

export function luminanceOf(hex: string): number {
  const n = parseInt(hex.replace('#', ''), 16);
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
}
