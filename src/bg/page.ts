/* Background remover UI. Image decoding, resizing and compositing run on the main thread (canvas);
 * inference runs in a module worker (worker.ts). Nothing is uploaded. */
import { fmt, type Dict } from '../i18n';
import type { FromWorker, ToWorker } from './worker';
import {
  ENGINE_CFG, MAX_EDGE, MAX_FILE_BYTES, applyAlpha, daysUntil, fitSize, formatMB, isImageFile, matteToAlpha, outputName, overColor, parseHex, toTensor, type Rgb,
} from './pipeline';
import { initNewsletter } from '../newsletter';

type Status = 'idle' | 'loading' | 'working' | 'done' | 'error';
type Mode = 'transparent' | 'white' | 'black' | 'color';
interface Result { name: string; w: number; h: number; src: ImageData; cut: ImageData; ms: number }

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const SIZE = ENGINE_CFG.model.size;

export function initCountdown(t: Dict, now = new Date()) {
  for (const el of document.querySelectorAll<HTMLElement>('[data-deadline]')) {
    const d = new Date(el.dataset.deadline!);
    const n = daysUntil(d, now);
    el.textContent = n > 0 ? fmt(n === 1 ? t.bgDaysLeft1 : t.bgDaysLeft, { n }) : t.bgClosedNow;
    el.hidden = false;
  }
}

export function initBg(t: Dict) {
  initNewsletter(t);
  initCountdown(t);
  const drop = $<HTMLDivElement>('bg-drop');
  const file = $<HTMLInputElement>('bg-file');
  const status = $<HTMLParagraphElement>('bg-status');
  const progress = $<HTMLProgressElement>('bg-progress');
  const result = $<HTMLElement>('bg-result');
  const canvas = $<HTMLCanvasElement>('bg-canvas');
  const compare = $<HTMLButtonElement>('bg-compare');
  const color = $<HTMLInputElement>('bg-color');
  const dlPng = $<HTMLButtonElement>('bg-dl-png');
  const dlJpg = $<HTMLButtonElement>('bg-dl-jpg');
  const copyBtn = $<HTMLButtonElement>('bg-copy');
  const again = $<HTMLButtonElement>('bg-again');
  const meta = $<HTMLParagraphElement>('bg-meta');
  if (!drop || !file) return;

  const params = new URLSearchParams(location.search);
  const coarse = matchMedia('(pointer: coarse)').matches;
  const maxEdge = coarse ? 2560 : MAX_EDGE; // phones: keep peak memory lower
  let worker: Worker | null = null;
  let ready = false, busy = false, runId = 0;
  let engineInfo = { threads: 0, isolated: false, fromCache: false, loadMs: 0 };
  let current: Result | null = null;
  let mode: Mode = 'transparent';
  let showOriginal = false;
  const pending = new Map<number, { resolve: (m: Float32Array, ms: number) => void; reject: (e: Error) => void }>();
  const hook: Record<string, unknown> = { status: 'idle' as Status };
  (window as unknown as { __kitBg: unknown }).__kitBg = hook;

  const setStatus = (s: Status, text: string) => {
    hook.status = s;
    status.textContent = text;
    status.className = 'bg-status ' + s;
    drop.setAttribute('aria-busy', String(s === 'loading' || s === 'working'));
  };

  function ensureWorker(): Worker {
    if (worker) return worker;
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'kitlibre-bg' });
    worker.onmessage = (e: MessageEvent<FromWorker>) => {
      const m = e.data;
      if (m.type === 'progress') {
        progress.hidden = false;
        progress.max = m.total;
        progress.value = m.loaded;
        setStatus('loading', fmt(t.bgStLoading, { mb: formatMB(m.total), pct: Math.min(100, Math.round((m.loaded / m.total) * 100)) }));
      } else if (m.type === 'ready') {
        ready = true;
        engineInfo = { threads: m.threads, isolated: m.isolated, fromCache: m.fromCache, loadMs: m.loadMs };
        Object.assign(hook, engineInfo);
        progress.hidden = true;
        if (busy) setStatus('working', t.bgStWorking);
      } else if (m.type === 'result') {
        pending.get(m.id)?.resolve(m.matte, m.ms);
        pending.delete(m.id);
      } else if (m.type === 'error') {
        progress.hidden = true;
        const err = new Error(m.message);
        (err as Error & { stage?: string }).stage = m.stage;
        if (m.id !== undefined) { pending.get(m.id)?.reject(err); pending.delete(m.id); }
        else { for (const p of pending.values()) p.reject(err); pending.clear(); }
        hook.lastError = m.message;
      }
    };
    worker.onerror = (e) => {
      hook.lastError = e.message || 'worker error';
      for (const p of pending.values()) p.reject(Object.assign(new Error(String(hook.lastError)), { stage: 'load' }));
      pending.clear();
    };
    const threads = Number(params.get('threads')) || undefined; // debug: ?threads=1 forces single-thread
    worker.postMessage({ type: 'load', threads } satisfies ToWorker);
    return worker;
  }

  function infer(tensor: Float32Array): Promise<{ matte: Float32Array; ms: number }> {
    const w = ensureWorker();
    const id = ++runId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve: (matte, ms) => resolve({ matte, ms }), reject });
      w.postMessage({ type: 'run', id, tensor } satisfies ToWorker, [tensor.buffer]);
    });
  }

  async function decode(f: File): Promise<{ img: CanvasImageSource; w: number; h: number; close: () => void }> {
    try {
      const b = await createImageBitmap(f);
      return { img: b, w: b.width, h: b.height, close: () => b.close() };
    } catch {
      const url = URL.createObjectURL(f);
      const img = new Image();
      img.src = url;
      try { await img.decode(); } catch { URL.revokeObjectURL(url); throw new Error('decode'); }
      return { img, w: img.naturalWidth, h: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
    }
  }

  const ctx2d = (c: HTMLCanvasElement) => c.getContext('2d', { willReadFrequently: true })!;
  function canvasOf(w: number, h: number) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

  async function process(f: File) {
    if (busy) return;
    if (!isImageFile(f)) return setStatus('error', t.bgErrFile);
    if (f.size > MAX_FILE_BYTES) return setStatus('error', t.bgErrBig);
    busy = true;
    file.disabled = true;
    const t0 = performance.now();
    if (!ready) ensureWorker();
    setStatus(ready ? 'working' : 'loading', ready ? t.bgStWorking : t.bgStStarting);
    let decoded;
    try { decoded = await decode(f); } catch { busy = false; file.disabled = false; return setStatus('error', t.bgErrFile); }
    try {
      const { w, h, scaled } = fitSize(decoded.w, decoded.h, maxEdge);
      const src = canvasOf(w, h), sctx = ctx2d(src);
      sctx.imageSmoothingQuality = 'high';
      sctx.drawImage(decoded.img, 0, 0, w, h);
      const srcData = sctx.getImageData(0, 0, w, h);
      const inp = canvasOf(SIZE, SIZE), ictx = ctx2d(inp);
      ictx.imageSmoothingQuality = 'high';
      ictx.drawImage(decoded.img, 0, 0, SIZE, SIZE);
      decoded.close();
      const tensor = toTensor(ictx.getImageData(0, 0, SIZE, SIZE).data, SIZE);
      const { matte, ms } = await infer(tensor);
      // matte (SIZE x SIZE) → alpha mask → scaled to the output size with smooth interpolation
      const alpha = matteToAlpha(matte);
      const mask = canvasOf(SIZE, SIZE), mctx = ctx2d(mask);
      const md = mctx.createImageData(SIZE, SIZE);
      for (let i = 0; i < alpha.length; i++) md.data[i * 4 + 3] = alpha[i];
      mctx.putImageData(md, 0, 0);
      const big = canvasOf(w, h), bctx = ctx2d(big);
      bctx.imageSmoothingQuality = 'high';
      bctx.drawImage(mask, 0, 0, w, h);
      const bd = bctx.getImageData(0, 0, w, h).data;
      const fullAlpha = new Uint8ClampedArray(w * h);
      for (let i = 0; i < fullAlpha.length; i++) fullAlpha[i] = bd[i * 4 + 3];
      const cut = new ImageData(applyAlpha(srcData.data, fullAlpha), w, h);
      current = { name: f.name, w, h, src: srcData, cut, ms };
      showOriginal = false;
      compare.setAttribute('aria-pressed', 'false');
      render();
      result.hidden = false;
      const secs = ((performance.now() - t0) / 1000).toFixed(1);
      Object.assign(hook, { ms, totalMs: Math.round(performance.now() - t0), size: { w, h }, scaled });
      setStatus('done', fmt(t.bgStDone, { s: secs }) + (scaled ? ' ' + fmt(t.bgStScaled, { w, h }) : ''));
      meta.textContent = fmt(engineInfo.threads > 1 ? t.bgMetaN : t.bgMeta1, { n: engineInfo.threads, ms: (ms / 1000).toFixed(1) });
      result.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
    } catch (err) {
      const stage = (err as { stage?: string }).stage;
      setStatus('error', stage === 'load' ? t.bgErrLoad : t.bgErrRun);
      if (stage === 'load') { worker?.terminate(); worker = null; ready = false; }
    } finally {
      busy = false;
      file.disabled = false;
      file.value = '';
    }
  }

  const bgColor = (): Rgb | null => (mode === 'white' ? [255, 255, 255] : mode === 'black' ? [0, 0, 0] : mode === 'color' ? parseHex(color.value) ?? [255, 255, 255] : null);
  function composed(): ImageData | null {
    if (!current) return null;
    const c = bgColor();
    return c ? new ImageData(overColor(current.cut.data, c), current.w, current.h) : current.cut;
  }
  function render() {
    if (!current) return;
    canvas.width = current.w;
    canvas.height = current.h;
    canvas.classList.toggle('solid', mode !== 'transparent' || showOriginal);
    ctx2d(canvas).putImageData(showOriginal ? current.src : composed()!, 0, 0);
    dlJpg.disabled = mode === 'transparent';
    dlJpg.title = mode === 'transparent' ? t.bgJpgNeedsBg : '';
  }

  function exportBlob(type: 'image/png' | 'image/jpeg'): Promise<Blob> {
    const data = composed()!;
    const c = canvasOf(data.width, data.height);
    ctx2d(c).putImageData(data, 0, 0);
    return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encode'))), type, 0.92));
  }
  async function download(ext: 'png' | 'jpg') {
    if (!current) return;
    const blob = await exportBlob(ext === 'png' ? 'image/png' : 'image/jpeg');
    const name = outputName(current.name, ext);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    hook.lastDownload = { name, type: blob.type, size: blob.size };
  }

  // ---- events
  drop.addEventListener('click', (e) => { if ((e.target as HTMLElement).tagName !== 'LABEL') file.click(); });
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } });
  file.addEventListener('change', () => { const f = file.files?.[0]; if (f) process(f); });
  for (const ev of ['dragenter', 'dragover'] as const) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); });
  for (const ev of ['dragleave', 'drop'] as const) drop.addEventListener(ev, () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer?.files?.[0]; if (f) process(f); });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());
  document.addEventListener('paste', (e) => {
    const f = [...(e.clipboardData?.files ?? [])].find((x) => isImageFile(x));
    if (f) { e.preventDefault(); process(f); }
  });
  for (const r of document.querySelectorAll<HTMLInputElement>('input[name=bgmode]')) r.addEventListener('change', () => { mode = r.value as Mode; showOriginal = false; compare.setAttribute('aria-pressed', 'false'); render(); });
  color.addEventListener('input', () => { const r = document.querySelector<HTMLInputElement>('input[name=bgmode][value=color]')!; r.checked = true; mode = 'color'; render(); });
  compare.addEventListener('click', () => { showOriginal = !showOriginal; compare.setAttribute('aria-pressed', String(showOriginal)); render(); });
  dlPng.addEventListener('click', () => download('png'));
  dlJpg.addEventListener('click', () => download('jpg'));
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) copyBtn.hidden = true;
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': exportBlob('image/png') })]);
      copyBtn.textContent = t.bgCopied;
      setTimeout(() => (copyBtn.textContent = t.bgCopy), 2000);
    } catch { copyBtn.textContent = t.bgCopyFail; }
  });
  again.addEventListener('click', () => { result.hidden = true; current = null; setStatus('idle', ''); drop.focus(); });

  // ---- test hooks (read-only views of the current result)
  Object.assign(hook, {
    /** alpha of the cut-out sampled on an n x n grid (nearest), row-major */
    alphaGrid(n: number) {
      if (!current) return null;
      const out: number[] = [];
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const px = Math.min(current.w - 1, Math.floor(((x + 0.5) * current.w) / n)), py = Math.min(current.h - 1, Math.floor(((y + 0.5) * current.h) / n));
        out.push(current.cut.data[(py * current.w + px) * 4 + 3]);
      }
      return out;
    },
    async exportDataUrl(type: 'image/png' | 'image/jpeg') {
      const b = await exportBlob(type);
      return await new Promise<string>((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result)); fr.readAsDataURL(b); });
    },
  });
}
