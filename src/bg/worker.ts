/// <reference lib="webworker" />
/* Background-remover worker: loads ONNX Runtime Web (self-hosted, WASM) and the chunked model, runs inference.
 * Model parts are cached with the Cache API, so the 42 MB download happens once per device. Nothing leaves the device. */
import type * as Ort from 'onnxruntime-web';
import { ENGINE_CFG, concatParts, partSize, partUrls, pickThreads, toHex } from './pipeline';

export type ToWorker = { type: 'load'; threads?: number } | { type: 'run'; id: number; tensor: Float32Array };
export type FromWorker =
  | { type: 'progress'; loaded: number; total: number; cached: boolean }
  | { type: 'ready'; threads: number; isolated: boolean; loadMs: number; fromCache: boolean }
  | { type: 'result'; id: number; matte: Float32Array; ms: number }
  | { type: 'error'; id?: number; stage: 'load' | 'run'; message: string };

const scope = self as unknown as DedicatedWorkerGlobalScope;
const post = (m: FromWorker, transfer: Transferable[] = []) => scope.postMessage(m, transfer);
const CACHE = 'kitlibre-engine-v1';
const M = ENGINE_CFG.model;
let session: Promise<Ort.InferenceSession> | null = null;
let ort: typeof Ort;

async function fetchPart(url: string, expected: number, cache: Cache | null, onBytes: (n: number) => void): Promise<{ bytes: Uint8Array; cached: boolean }> {
  const hit = cache ? await cache.match(url) : undefined;
  if (hit) {
    const b = new Uint8Array(await hit.arrayBuffer());
    if (b.length === expected) { onBytes(b.length); return { bytes: b, cached: true }; }
    await cache!.delete(url);
  }
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`);
  const reader = res.body.getReader();
  const buf = new Uint8Array(expected);
  let off = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (off + value.length > expected) throw new Error('model part larger than expected');
    buf.set(value, off);
    off += value.length;
    onBytes(value.length);
  }
  if (off !== expected) throw new Error('model part truncated');
  if (cache) await cache.put(url, new Response(buf, { headers: { 'Content-Type': 'application/octet-stream' } })).catch(() => {});
  return { bytes: buf, cached: false };
}

async function load(threadsOverride?: number): Promise<Ort.InferenceSession> {
  const t0 = performance.now();
  ort = (await import(/* @vite-ignore */ ENGINE_CFG.ort.dir + ENGINE_CFG.ort.entry)) as typeof Ort;
  const isolated = !!scope.crossOriginIsolated;
  const threads = threadsOverride && threadsOverride > 0 ? (isolated ? threadsOverride : 1) : pickThreads(isolated, navigator.hardwareConcurrency);
  ort.env.wasm.wasmPaths = ENGINE_CFG.ort.dir;
  ort.env.wasm.numThreads = threads;
  ort.env.wasm.proxy = false;
  ort.env.logLevel = 'error';

  const urls = partUrls(M);
  let cache: Cache | null = null;
  try { cache = await caches.open(CACHE); } catch { cache = null; } // e.g. private mode without storage
  let loaded = 0, allCached = true;
  const parts = await Promise.all(
    urls.map((u, i) =>
      fetchPart(u, partSize(M, i), cache, (n) => { loaded += n; post({ type: 'progress', loaded, total: M.bytes, cached: false }); }).then((r) => {
        if (!r.cached) allCached = false;
        return r.bytes;
      }),
    ),
  );
  const model = concatParts(parts, M.bytes);
  parts.length = 0;
  const digest = toHex(await crypto.subtle.digest('SHA-256', model));
  if (digest !== M.sha256) {
    if (cache) for (const u of urls) await cache.delete(u);
    throw new Error('model integrity check failed (sha256 mismatch)');
  }
  const s = await ort.InferenceSession.create(model, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  post({ type: 'ready', threads, isolated, loadMs: Math.round(performance.now() - t0), fromCache: allCached });
  return s;
}

scope.onmessage = async (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  if (msg.type === 'load') {
    if (!session) {
      session = load(msg.threads);
      session.catch((err) => { session = null; post({ type: 'error', stage: 'load', message: String(err?.message || err) }); });
    }
    return;
  }
  if (msg.type === 'run') {
    try {
      if (!session) session = load();
      const s = await session;
      const t0 = performance.now();
      const input = new ort.Tensor('float32', msg.tensor, [1, 3, M.size, M.size]);
      const out = await s.run({ [M.input]: input });
      const data = out[M.output].data as Float32Array;
      const matte = new Float32Array(data); // own buffer, transferable
      input.dispose?.();
      out[M.output].dispose?.();
      post({ type: 'result', id: msg.id, matte, ms: Math.round(performance.now() - t0) }, [matte.buffer]);
    } catch (err) {
      post({ type: 'error', id: msg.id, stage: 'run', message: String((err as Error)?.message || err) });
    }
  }
};
