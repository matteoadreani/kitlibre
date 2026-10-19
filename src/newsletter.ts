import type { Dict } from './i18n';

/**
 * Newsletter signup ("SaaS Trap of the Week").
 * Sends ONLY the email address from the browser to MailerLite's public embedded-form endpoint (the form's `action`,
 * see SITE.newsletterFormAction). No API key, no third-party script, no cookies (credentials: 'omit').
 * MailerLite handles double opt-in: the visitor gets a confirmation email.
 * A hidden honeypot field catches naive bots: if it is filled we pretend success and send nothing.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const TIMEOUT_MS = 15000;

type MlResponse = { success?: boolean; errors?: { fields?: Record<string, string[]> } & Record<string, unknown> };

export function initNewsletter(t: Dict) {
  const form = document.getElementById('nl-form') as HTMLFormElement | null;
  const msg = document.getElementById('nl-msg');
  if (!form || !msg || form.dataset.ready) return;
  form.dataset.ready = '1';
  const email = form.querySelector<HTMLInputElement>('input[type=email]')!;
  const honeypot = form.querySelector<HTMLInputElement>('#nl-website');
  const button = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
  const label = button.textContent ?? '';
  let busy = false;

  const show = (text: string, kind: 'ok' | 'err' | '') => {
    msg.textContent = text;
    msg.className = 'hint nl-msg' + (kind ? ' ' + kind : '');
  };
  const setBusy = (on: boolean) => {
    busy = on;
    button.disabled = on;
    button.setAttribute('aria-busy', String(on));
    button.textContent = on ? t.nlSending : label;
    email.readOnly = on;
  };
  email.addEventListener('input', () => { email.removeAttribute('aria-invalid'); if (msg.classList.contains('err')) show('', ''); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    const value = email.value.trim();
    if (!EMAIL_RE.test(value) || value.length > 254) {
      email.setAttribute('aria-invalid', 'true');
      show(t.nlInvalid, 'err');
      email.focus();
      return;
    }
    if (honeypot && honeypot.value) { form.reset(); show(t.nlOk, 'ok'); return; } // bot: silently drop

    const body = new URLSearchParams({ 'fields[email]': value, 'ml-submit': '1', anticsrf: 'true' });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    setBusy(true);
    show('', '');
    try {
      // urlencoded POST = "simple" CORS request (no preflight); MailerLite answers with Access-Control-Allow-Origin: *.
      const res = await fetch(form.action, { method: 'POST', body, mode: 'cors', credentials: 'omit', signal: ctrl.signal });
      const data: MlResponse = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        form.reset();
        show(t.nlOk, 'ok');
      } else if (data.errors?.fields?.email) {
        email.setAttribute('aria-invalid', 'true');
        show(t.nlInvalid, 'err');
      } else {
        show(t.nlErr, 'err');
      }
    } catch {
      show(t.nlErr, 'err');
    } finally {
      clearTimeout(timer);
      setBusy(false);
    }
  });
}

export function revealNewsletter() {
  const nl = document.getElementById('newsletter');
  if (nl && nl.hidden) nl.hidden = false;
}
