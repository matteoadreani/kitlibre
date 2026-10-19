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

// Optional SaaS Trap box shown after a successful cut-out. Never blocks anything; closing it (or subscribing,
// here or in the newsletter section) is remembered on this device only.
export const ST_KEY = 'kitlibre:saastrap-box';
const stRead = () => { try { return localStorage.getItem(ST_KEY); } catch { return null; } };
const stWrite = (v: 'dismissed' | 'subscribed') => { try { localStorage.setItem(ST_KEY, v); } catch { /* private mode: just hide */ } };

export function initBg(t: Dict) {
  initCountdown(t);
  const stBox = $<HTMLElement>('st-box');
  const stText = $<HTMLElement>('st-text');
  if (stText?.dataset.stDeadline && daysUntil(new Date(stText.dataset.stDeadline), new Date()) <= 0) stText.textContent = stText.dataset.after ?? stText.textContent;
  initNewsletter(t, 'nl', () => { stWrite('subscribed'); if (stBox && !stBox.querySelector('.nl-msg.ok')) stBox.hidden = true; });
  initNewsletter(t, 'st', () => stWrite('subscribed'));
  initNewsletter(t, 'fa'); // feature alerts (separate list)
  // While the box is visible the page's own newsletter section is hidden (no duplicate). It comes back when the box
  // is closed or another photo is loaded; the box is offered once per page view. If the box was closed before or the
  // visitor already subscribed, the box never shows and the section stays as it is.
  const nlSection = $<HTMLElement>('newsletter');
  let stOffered = false;
  const showStBox = () => {
    if (!stBox || stOffered || stRead()) return;
    stOffered = true;
    stBox.hidden = false;
    if (nlSection) nlSection.hidden = true;
  };
  const retireStBox = () => {
    if (!stBox || stBox.hidden) return;
    stBox.hidden = true;
    if (nlSection) nlSection.hidden = false;
  };
  $<HTMLButtonElement>('st-close')?.addEventListener('click', () => {
    stWrite('dismissed');
    retireStBox();
    const primary = [...document.querySelectorAll<HTMLButtonElement>('#bg-result .dl .btn.primary')].find((b) => !b.hidden);
    primary?.focus();
  });
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
  const shareBtn = $<HTMLButtonElement>('bg-share');
  const dlFile = $<HTMLButtonElement>('bg-dl-file');
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
    retireStBox();
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
      showStBox();
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
    prepareShare();
  }

  // ---- "Save to Photos" on iOS/iPadOS: Safari puts <a download> files in Files/Downloads, while the
  // share sheet offers "Save Image" straight into Photos. There the share button is primary and the
  // classic download becomes a secondary "Download file"; desktop and Android keep Download PNG/JPG.
  // navigator.share() must run synchronously in the click to keep the user activation, so the File
  // (PNG when transparent, JPG on a solid background) is encoded in advance after every render; if the
  // click comes first, it is encoded synchronously (toDataURL) inside the click instead.
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const canShareFiles = (() => {
    try {
      return isIOS && typeof navigator.share === 'function' && typeof navigator.canShare === 'function'
        && navigator.canShare({ files: [new File([new Uint8Array([137, 80, 78, 71])], 'x.png', { type: 'image/png' })] });
    } catch { return false; }
  })();
  if (canShareFiles && shareBtn && dlFile) {
    shareBtn.hidden = false;
    dlFile.hidden = false;
    dlPng.hidden = true;
    dlJpg.hidden = true;
  }
  hook.shareMode = canShareFiles;
  let renderVer = 0;
  let shareFile: { ver: number; file: File } | null = null;
  let blobCache: { ver: number; blob: Promise<Blob> } | null = null;
  function pngBlob(): Promise<Blob> {
    if (!blobCache || blobCache.ver !== renderVer) blobCache = { ver: renderVer, blob: exportBlob('image/png') };
    return blobCache.blob;
  }
  const shareExt = () => (mode === 'transparent' ? 'png' : 'jpg') as 'png' | 'jpg';
  const mimeOf = (ext: 'png' | 'jpg') => (ext === 'png' ? 'image/png' : 'image/jpeg') as 'image/png' | 'image/jpeg';
  function prepareShare() {
    const ver = ++renderVer;
    shareFile = null;
    if (!canShareFiles || !current) return;
    const ext = shareExt(), name = outputName(current.name, ext);
    exportBlob(mimeOf(ext)).then((b) => { if (ver === renderVer) shareFile = { ver, file: new File([b], name, { type: mimeOf(ext) }) }; }, () => {});
  }
  function shareFileNow(): File {
    if (shareFile && shareFile.ver === renderVer) return shareFile.file;
    const ext = shareExt(), type = mimeOf(ext);
    const data = composed()!;
    const c = canvasOf(data.width, data.height);
    ctx2d(c).putImageData(data, 0, 0);
    const bin = atob(c.toDataURL(type, 0.92).split(',')[1]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], outputName(current!.name, ext), { type });
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
  dlFile?.addEventListener('click', () => download(shareExt()));
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) copyBtn.hidden = true;
  // Safari only allows clipboard.write() synchronously inside the click, with the data as a promise.
  copyBtn.addEventListener('click', () => {
    if (!current) return;
    const ok = () => { copyBtn.textContent = t.bgCopied; setTimeout(() => (copyBtn.textContent = t.bgCopy), 2000); };
    const fail = () => { copyBtn.textContent = t.bgCopyFail; };
    let write: Promise<void>;
    try { write = navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob() })]); } catch (e) { write = Promise.reject(e); }
    // older Chromium without promise values in ClipboardItem: retry with the resolved blob
    write.then(ok, () => pngBlob().then((b) => navigator.clipboard.write([new ClipboardItem({ 'image/png': b })])).then(ok, fail));
  });
  shareBtn?.addEventListener('click', () => {
    if (!current || !canShareFiles) return;
    let file: File;
    try { file = shareFileNow(); } catch { status.textContent = t.bgSaveFail; return; }
    hook.lastShare = { name: file.name, type: file.type, size: file.size, prepared: shareFile?.file === file };
    navigator.share({ files: [file] }).catch((e: unknown) => {
      if ((e as Error)?.name !== 'AbortError') { hook.lastShareError = String((e as Error)?.name || e); status.textContent = t.bgSaveFail; }
    });
  });
  again.addEventListener('click', () => { retireStBox(); result.hidden = true; current = null; setStatus('idle', ''); drop.focus(); });

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
