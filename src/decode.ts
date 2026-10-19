import jsQR from 'jsqr';

type Source = HTMLImageElement | HTMLVideoElement | HTMLCanvasElement | ImageBitmap;

function dims(src: Source) {
  if (src instanceof HTMLVideoElement) return [src.videoWidth, src.videoHeight];
  if (src instanceof HTMLImageElement) return [src.naturalWidth, src.naturalHeight];
  return [src.width, src.height];
}

const work = document.createElement('canvas');

function tryScale(src: Source, w: number, h: number, scale: number): string | null {
  const cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
  work.width = cw;
  work.height = ch;
  const ctx = work.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, cw, ch);
  ctx.imageSmoothingEnabled = scale < 1;
  ctx.drawImage(src as CanvasImageSource, 0, 0, cw, ch);
  const img = ctx.getImageData(0, 0, cw, ch);
  const r = jsQR(img.data, cw, ch, { inversionAttempts: 'attemptBoth' });
  return r ? r.data : null;
}

/** Decodes a QR from any drawable source, trying several scales (photos, screenshots, tiny crops). */
export function decodeSource(src: Source, quick = false): string | null {
  const [w, h] = dims(src);
  if (!w || !h) return null;
  const maxSide = Math.max(w, h);
  const scales = new Set<number>();
  const fit = (target: number) => Math.min(1, target / maxSide);
  if (quick) scales.add(fit(720));
  else {
    if (maxSide < 400) scales.add(2);
    scales.add(fit(1600));
    scales.add(fit(1000));
    scales.add(fit(640));
    scales.add(fit(400));
  }
  for (const s of scales) {
    const r = tryScale(src, w, h, s);
    if (r !== null) return r;
  }
  return null;
}

declare global {
  interface Window {
    BarcodeDetector?: new (o: { formats: string[] }) => { detect(s: unknown): Promise<{ rawValue: string }[]> };
  }
}

/** Uses the native BarcodeDetector when present (fast on Android/macOS), falling back to jsQR. */
export async function decodeAny(src: Source, quick = false): Promise<string | null> {
  if (window.BarcodeDetector) {
    try {
      const det = new window.BarcodeDetector({ formats: ['qr_code'] });
      const res = await det.detect(src);
      if (res.length && res[0].rawValue) return res[0].rawValue;
    } catch {
      /* fall through to jsQR */
    }
  }
  return decodeSource(src, quick);
}

export function loadImageFromFile(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image'));
    };
    img.src = url;
  });
}
