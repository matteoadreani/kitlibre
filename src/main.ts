import './style.css';
import { STRINGS, type Lang } from './i18n';

const lang: Lang = document.documentElement.lang === 'it' ? 'it' : 'en';
const t = STRINGS[lang];
const page = document.body.dataset.page;

// Keep the fragment (e.g. prefilled content) when switching language.
for (const a of document.querySelectorAll<HTMLAnchorElement>('[data-lang-link]')) {
  if (a.getAttribute('aria-current')) a.addEventListener('click', (e) => e.preventDefault());
  else if (location.hash) a.href += location.hash;
}

if (page === 'generator') import('./generator').then((m) => m.initGenerator(t));
else if (page === 'checker') import('./checker').then((m) => m.initChecker(t, lang));
else if (page === 'newsletter') import('./newsletter').then((m) => m.initNewsletter(t));
else if (page === 'bg') import('./bg/page').then((m) => m.initBg(t));
else if (page === 'bgAlt') import('./newsletter').then((m) => m.initNewsletter(t));
