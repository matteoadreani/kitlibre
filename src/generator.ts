import { BRAND_NAME } from './config';
import type { Dict } from './i18n';
import { fmt } from './i18n';
import {
  buildEmail, buildPhone, buildSms, buildUrl, buildVCard, buildWifi, QR_TYPES, type QrType, type WifiData,
} from './payload';
import { contrastRatio, drawToCanvas, luminanceOf, makeMatrix, toSvg, type EcLevel, type Matrix, type RenderOptions } from './render';
import { initNewsletter, revealNewsletter } from './newsletter';

const $ = <T extends HTMLElement = HTMLInputElement>(id: string) => document.getElementById(id) as T;
const val = (id: string) => ($(id) as HTMLInputElement | null)?.value ?? '';

interface LogoState { dataUrl: string; width: number; height: number; img: HTMLImageElement }

export function initGenerator(t: Dict) {
  const form = $<HTMLFormElement>('gen-form');
  const box = $<HTMLDivElement>('qr-box');
  const stats = $<HTMLParagraphElement>('qr-stats');
  const warn = $<HTMLDivElement>('qr-warn');
  const contentOut = $<HTMLPreElement>('qr-content');
  const btnPng = $<HTMLButtonElement>('dl-png');
  const btnSvg = $<HTMLButtonElement>('dl-svg');
  const btnCopy = $<HTMLButtonElement>('copy-content');
  let logo: LogoState | null = null;
  let current: { text: string; matrix: Matrix; opts: RenderOptions; type: QrType } | null = null;

  const currentType = (): QrType => (form.querySelector<HTMLInputElement>('input[name=qrtype]:checked')?.value as QrType) || 'url';

  function payload(type: QrType): string {
    switch (type) {
      case 'url': {
        const u = val('f-url');
        return u.trim()
          ? buildUrl(u, { source: val('utm-source'), medium: val('utm-medium'), campaign: val('utm-campaign'), term: val('utm-term'), content: val('utm-content') })
          : '';
      }
      case 'text':
        return val('f-text');
      case 'wifi':
        return buildWifi({ ssid: val('f-ssid'), password: val('f-wpass'), security: val('f-wsec') as WifiData['security'], hidden: $('f-whidden').checked });
      case 'vcard':
        return buildVCard({
          firstName: val('v-first'), lastName: val('v-last'), org: val('v-org'), title: val('v-title'), phone: val('v-phone'),
          mobile: val('v-mobile'), email: val('v-email'), website: val('v-website'), street: val('v-street'), city: val('v-city'),
          zip: val('v-zip'), region: val('v-region'), country: val('v-country'), note: val('v-note'),
        });
      case 'email':
        return buildEmail({ to: val('e-to'), subject: val('e-subject'), body: val('e-body') });
      case 'phone':
        return buildPhone(val('p-phone'));
      case 'sms':
        return buildSms({ phone: val('s-phone'), message: val('s-msg') });
    }
  }

  function options(): RenderOptions {
    return {
      ec: val('d-ec') as EcLevel,
      margin: Number(val('d-margin')),
      fg: val('d-fg'),
      bg: val('d-bg'),
      logo: logo ? { dataUrl: logo.dataUrl, width: logo.width, height: logo.height, ratio: Number(val('d-logo-size')) / 100 } : null,
    };
  }

  function setWarnings(list: string[]) {
    warn.replaceChildren(...list.map((w) => Object.assign(document.createElement('p'), { className: 'warn', textContent: w })));
  }

  function setEnabled(on: boolean) {
    btnPng.disabled = btnSvg.disabled = btnCopy.disabled = !on;
  }

  function render() {
    const type = currentType();
    for (const p of form.querySelectorAll<HTMLElement>('.panel')) p.hidden = p.dataset.for !== type;
    $('d-size-out').textContent = `${val('d-size')} px`;
    $('d-margin-out').textContent = `${val('d-margin')} ${t.modules}`;
    $('d-logo-size-out').textContent = `${val('d-logo-size')}%`;
    const text = payload(type);
    const opts = options();
    const warnings: string[] = [];
    if (contrastRatio(opts.fg, opts.bg) < 3) warnings.push(t.warnContrast);
    else if (luminanceOf(opts.fg) > luminanceOf(opts.bg)) warnings.push(t.warnInverted);
    if (opts.margin < 2) warnings.push(t.warnMargin);
    if (logo) warnings.push(t.warnLogoEc);
    contentOut.textContent = text;
    if (!text) {
      current = null;
      box.innerHTML = `<p class="empty"></p>`;
      box.firstElementChild!.textContent = t.previewEmpty;
      stats.textContent = '';
      setWarnings([]);
      setEnabled(false);
      return;
    }
    let matrix: Matrix;
    try {
      matrix = makeMatrix(text, opts);
    } catch {
      current = null;
      box.innerHTML = '';
      stats.textContent = '';
      setWarnings([t.tooLong]);
      setEnabled(false);
      return;
    }
    current = { text, matrix, opts, type };
    box.innerHTML = toSvg(matrix, opts);
    stats.textContent = fmt(t.stats, { v: matrix.version, n: matrix.size, c: [...text].length });
    setWarnings(warnings);
    setEnabled(true);
  }

  let raf = 0;
  const schedule = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(render);
  };
  form.addEventListener('input', schedule);
  form.addEventListener('change', schedule);
  form.addEventListener('submit', (e) => e.preventDefault());

  // ---- Logo
  const logoInput = $('d-logo');
  const ecSelect = $<HTMLSelectElement>('d-ec');
  let ecBeforeLogo: string | null = null;
  logoInput.addEventListener('change', () => {
    const file = logoInput.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const img = new Image();
      img.onload = () => {
        const w = img.naturalWidth || 300, hgt = img.naturalHeight || 300;
        logo = { dataUrl, width: w, height: hgt, img };
        if (ecBeforeLogo === null) ecBeforeLogo = ecSelect.value;
        ecSelect.value = 'H';
        $('logo-row').hidden = false;
        render();
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
  $('d-logo-remove').addEventListener('click', () => {
    logo = null;
    logoInput.value = '';
    $('logo-row').hidden = true;
    if (ecBeforeLogo) ecSelect.value = ecBeforeLogo;
    ecBeforeLogo = null;
    render();
  });

  // ---- Downloads
  const baseName = () => `${BRAND_NAME.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-qr-${current?.type ?? 'code'}`;
  function save(blob: Blob, name: string) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    revealNewsletter();
  }
  btnSvg.addEventListener('click', () => {
    if (!current) return;
    const svg = `<?xml version="1.0" encoding="UTF-8"?>\n` + toSvg(current.matrix, current.opts, Number(val('d-size')));
    save(new Blob([svg], { type: 'image/svg+xml' }), baseName() + '.svg');
  });
  btnPng.addEventListener('click', () => {
    if (!current) return;
    const c = document.createElement('canvas');
    drawToCanvas(c, current.matrix, current.opts, Number(val('d-size')), logo?.img);
    c.toBlob((b) => b && save(b, baseName() + '.png'), 'image/png');
  });
  btnCopy.addEventListener('click', async () => {
    if (!current) return;
    try {
      await navigator.clipboard.writeText(current.text);
      const old = btnCopy.textContent;
      btnCopy.textContent = t.copied;
      setTimeout(() => (btnCopy.textContent = old), 1500);
    } catch {
      /* clipboard unavailable */
    }
  });

  // ---- Prefill from the URL fragment (never sent to the server): #url=… or #raw=…
  function prefill() {
    const params = new URLSearchParams(location.hash.slice(1));
    const pick = (type: QrType) => {
      const r = form.querySelector<HTMLInputElement>(`input[name=qrtype][value=${type}]`);
      if (r) r.checked = true;
    };
    const url = params.get('url');
    const raw = params.get('raw');
    const type = params.get('type') as QrType | null;
    if (url) {
      pick('url');
      $('f-url').value = url;
    } else if (raw) {
      pick('text');
      ($('f-text') as unknown as HTMLTextAreaElement).value = raw;
    } else if (type && QR_TYPES.includes(type)) pick(type);
  }
  prefill();
  window.addEventListener('hashchange', () => {
    prefill();
    render();
  });

  initNewsletter(t);
  render();

  // Test hook (used by the automated browser tests; harmless for users).
  (window as unknown as { __kitQr: unknown }).__kitQr = {
    current: () => current && { text: current.text, version: current.matrix.version },
    pngDataUrl: () => {
      if (!current) return null;
      const c = document.createElement('canvas');
      drawToCanvas(c, current.matrix, current.opts, Number(val('d-size')), logo?.img);
      return c.toDataURL('image/png');
    },
    svg: () => current && toSvg(current.matrix, current.opts, Number(val('d-size'))),
  };
}
