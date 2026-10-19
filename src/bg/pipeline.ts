/* Pure helpers for the background remover (no DOM): sizing, tensors, mattes, compositing, chunk assembly. */
import ENGINE from './engine.json';

export type Rgb = [number, number, number];
export const ENGINE_CFG = ENGINE;
export const MAX_EDGE = 4096;
export const MAX_FILE_BYTES = 40 * 1024 * 1024;

/** Scales (w, h) down so the long edge is at most `max`; never upscales. */
export function fitSize(w: number, h: number, max = MAX_EDGE): { w: number; h: number; scaled: boolean } {
  if (!(w > 0 && h > 0)) throw new Error('invalid image size');
  const long = Math.max(w, h);
  if (long <= max) return { w, h, scaled: false };
  const k = max / long;
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)), scaled: true };
}

/** RGBA pixels (size x size) → planar CHW float32 in [0, 1] (ormbg: rescale 1/255, no mean/std). */
export function toTensor(rgba: Uint8ClampedArray | Uint8Array, size: number): Float32Array {
  const n = size * size;
  if (rgba.length !== n * 4) throw new Error('pixel buffer does not match size');
  const out = new Float32Array(3 * n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    out[i] = rgba[j] / 255;
    out[n + i] = rgba[j + 1] / 255;
    out[2 * n + i] = rgba[j + 2] / 255;
  }
  return out;
}

/** Model output in [0, 1] (sigmoid already applied in the graph) → 8-bit alpha. Values outside are clamped; NaN → 0. */
export function matteToAlpha(matte: ArrayLike<number>): Uint8ClampedArray<ArrayBuffer> {
  const a = new Uint8ClampedArray(matte.length);
  for (let i = 0; i < matte.length; i++) {
    const v = matte[i];
    a[i] = v > 0 ? (v < 1 ? Math.round(v * 255) : 255) : 0;
  }
  return a;
}

/** Writes `alpha` (one byte per pixel) into the alpha channel of a copy of `rgba`. */
export function applyAlpha(rgba: Uint8ClampedArray, alpha: Uint8ClampedArray): Uint8ClampedArray<ArrayBuffer> {
  if (rgba.length !== alpha.length * 4) throw new Error('alpha size mismatch');
  const out = new Uint8ClampedArray(rgba.length);
  out.set(rgba);
  for (let i = 0; i < alpha.length; i++) out[i * 4 + 3] = Math.round((rgba[i * 4 + 3] * alpha[i]) / 255);
  return out;
}

/** Composites RGBA (straight alpha) over a solid colour → opaque RGBA. */
export function overColor(rgba: Uint8ClampedArray, bg: Rgb): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3] / 255;
    out[i] = Math.round(rgba[i] * a + bg[0] * (1 - a));
    out[i + 1] = Math.round(rgba[i + 1] * a + bg[1] * (1 - a));
    out[i + 2] = Math.round(rgba[i + 2] * a + bg[2] * (1 - a));
    out[i + 3] = 255;
  }
  return out;
}

export function parseHex(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex.trim());
  if (!m) return null;
  const s = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

/** URLs of the model parts, in order. */
export function partUrls(model: { dir: string; bytes: number; partBytes: number }): string[] {
  const n = Math.ceil(model.bytes / model.partBytes);
  return Array.from({ length: n }, (_, i) => `${model.dir}part-${i}.bin`);
}

/** Expected byte length of part i. */
export function partSize(model: { bytes: number; partBytes: number }, i: number): number {
  return Math.min(model.partBytes, model.bytes - i * model.partBytes);
}

export function concatParts(parts: Uint8Array[], total: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    if (off + p.length > total) throw new Error('model parts larger than expected');
    out.set(p, off);
    off += p.length;
  }
  if (off !== total) throw new Error('model parts smaller than expected');
  return out;
}

export const toHex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** "holiday photo.JPG" → "holiday photo-nobg.png" */
export function outputName(original: string, ext: 'png' | 'jpg'): string {
  const base = (original || 'image').replace(/\.[^./\\]+$/, '').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120) || 'image';
  return `${base}-nobg.${ext}`;
}

export function isImageFile(f: { type: string; name: string }): boolean {
  return /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif)$/i.test(f.name);
}

export function formatMB(bytes: number): string {
  return `${Math.round(bytes / 1e6)} MB`;
}

/** Days left until `deadline` (rounded up), 0 once it has passed. */
export function daysUntil(deadline: Date, now: Date): number {
  return Math.max(0, Math.ceil((deadline.getTime() - now.getTime()) / 86400000));
}

/** Threads for ONNX Runtime: multi-threading needs cross-origin isolation (SharedArrayBuffer). */
export function pickThreads(isolated: boolean, cores: number | undefined): number {
  if (!isolated) return 1;
  return Math.max(1, Math.min(4, cores || 4));
}
