import type { Dict, Lang } from './i18n';
import { fmt, ROUTES } from './i18n';
import { classify, type Classification } from './classify';
import { decodeAny, loadImageFromFile } from './decode';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
}

export function initChecker(t: Dict, lang: Lang) {
  const drop = document.getElementById('drop')!;
  const file = document.getElementById('chk-file') as HTMLInputElement;
  const result = document.getElementById('result') as HTMLElement;
  const camBtn = document.getElementById('cam-btn') as HTMLButtonElement;
  const cam = document.getElementById('cam')!;
  const video = document.getElementById('cam-video') as HTMLVideoElement;
  const pasteForm = document.getElementById('paste-form') as HTMLFormElement;
  const pasteInput = document.getElementById('paste-input') as HTMLInputElement;
  const gen = ROUTES.generator[lang];

  function showMessage(text: string, cls = 'info') {
    result.hidden = false;
    result.className = `card result ${cls}`;
    result.replaceChildren(el('p', { textContent: text }));
  }

  function showResult(c: Classification) {
    const vendor = c.match?.vendor ?? '';
    const map = {
      dynamic: ['danger', t.v_dynamic_t, t.v_dynamic_p],
      shortener: ['warning', t.v_shortener_t, t.v_shortener_p],
      discontinued: ['danger', t.v_discontinued_t, t.v_discontinued_p],
      static: ['ok', t.v_static_t, t.v_static_p],
      'maybe-short': ['warning', t.v_maybe_t, t.v_maybe_p],
      'not-url': ['ok', t.v_noturl_t, t.v_noturl_p],
    } as const;
    const [level, title, para] = map[c.verdict];
    const vars = { vendor, host: c.host ?? '' };
    result.hidden = false;
    result.className = `card result ${level}`;
    result.dataset.verdict = c.verdict;
    const icon = level === 'ok' ? '✓' : level === 'warning' ? '!' : '✕';
    const dl = el('dl', { className: 'facts' });
    const fact = (k: string, v: string, code = false) => dl.append(el('dt', { textContent: k }), el('dd', {}, code ? el('code', { textContent: v }) : v));
    fact(t.resKind, t[`kind_${c.kind}`]);
    if (c.host) fact(t.resHost, c.host, true);
    if (c.match) fact(t.resVendor, c.match.vendor);
    if (c.match?.note) fact(t.vendorNote, c.match.note[lang]);
    const content = el('div', { className: 'content-out' }, el('div', { className: 'content-head' }, el('span', { textContent: t.resContent })), el('pre', { textContent: c.raw }));
    const iconEl = el('span', { className: 'icon', textContent: icon });
    iconEl.setAttribute('aria-hidden', 'true');
    const parts: Node[] = [
      el('h2', { className: 'verdict' }, iconEl, el('span', { textContent: title })),
      el('p', { textContent: fmt(para, vars) }),
      dl,
    ];
    if (c.insecure) parts.push(el('p', { className: 'warn', textContent: t.insecure }));
    parts.push(content);
    const cta = el('div', { className: 'cta' });
    if (c.verdict === 'dynamic' || c.verdict === 'shortener' || c.verdict === 'discontinued' || c.verdict === 'maybe-short') {
      cta.append(el('p', { textContent: t.ctaFixHow }), el('a', { className: 'btn primary', href: gen, textContent: t.ctaFix + ' →' }));
    } else if (c.kind === 'url' && c.url) {
      cta.append(el('a', { className: 'btn primary', href: `${gen}#url=${encodeURIComponent(c.raw.trim())}`, textContent: t.ctaCopy }));
      cta.append(' ', el('a', { className: 'btn', href: gen, textContent: t.ctaNew }));
    } else {
      cta.append(el('a', { className: 'btn primary', href: `${gen}#raw=${encodeURIComponent(c.raw)}`, textContent: t.ctaCopy }));
      cta.append(' ', el('a', { className: 'btn', href: gen, textContent: t.ctaNew }));
    }
    parts.push(cta);
    result.replaceChildren(...parts);
    result.focus({ preventScroll: true });
    result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function handleFile(f: Blob | null | undefined) {
    if (!f) return;
    showMessage(t.decoding);
    let img: HTMLImageElement;
    try {
      img = await loadImageFromFile(f);
    } catch {
      return showMessage(t.badImage, 'warning');
    }
    // Let the "Reading…" message paint before the (synchronous) decode work.
    await new Promise((r) => setTimeout(r, 16));
    const text = await decodeAny(img);
    URL.revokeObjectURL(img.src);
    if (text === null) return showMessage(t.noQr, 'warning');
    showResult(classify(text));
  }

  file.addEventListener('change', () => handleFile(file.files?.[0]));
  drop.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).tagName !== 'LABEL') file.click();
  });
  drop.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      file.click();
    }
  });
  ['dragenter', 'dragover'].forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.add('over');
    }),
  );
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('over')));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    handleFile((e as DragEvent).dataTransfer?.files?.[0]);
  });
  document.addEventListener('paste', (e) => {
    const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
    if (item) {
      e.preventDefault();
      handleFile(item.getAsFile());
    }
  });
  pasteForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = pasteInput.value.trim();
    if (v) showResult(classify(v));
  });

  // ---- Camera
  let stream: MediaStream | null = null;
  let scanning = false;
  function stopCam() {
    scanning = false;
    stream?.getTracks().forEach((tr) => tr.stop());
    stream = null;
    cam.hidden = true;
    camBtn.textContent = t.camera;
  }
  async function loop() {
    if (!scanning) return;
    if (video.readyState >= 2) {
      const text = await decodeAny(video, true);
      if (text !== null) {
        stopCam();
        showResult(classify(text));
        return;
      }
    }
    setTimeout(loop, 150);
  }
  camBtn.addEventListener('click', async () => {
    if (stream) return stopCam();
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      video.srcObject = stream;
      cam.hidden = false;
      await video.play();
      camBtn.textContent = t.cameraStop;
      scanning = true;
      loop();
    } catch {
      stopCam();
      showMessage(t.cameraErr, 'warning');
    }
  });
}
