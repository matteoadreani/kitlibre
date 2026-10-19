import type { Dict } from './i18n';

/**
 * TODO(newsletter): placeholder only. Connect to a privacy-friendly double-opt-in provider
 * once the brand is decided. Until then this collects, sends and stores NOTHING:
 * no fetch, no localStorage, no cookies.
 */
export function initNewsletter(t: Dict) {
  const form = document.getElementById('nl-form') as HTMLFormElement | null;
  const msg = document.getElementById('nl-msg');
  if (!form || !msg) return;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    (form.querySelector('input[type=email]') as HTMLInputElement).value = '';
    msg.textContent = t.nlTodo;
  });
}

export function revealNewsletter() {
  const nl = document.getElementById('newsletter');
  if (nl && nl.hidden) nl.hidden = false;
}
