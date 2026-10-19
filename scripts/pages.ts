/* Build-time HTML generation for every page × language (static, SEO-friendly markup). */
import { SITE, BRAND_NAME } from '../src/config';
import { STRINGS, ROUTES, LEGACY_REDIRECTS, type Dict, type Lang, type PageId } from '../src/i18n';
import { DOMAINS } from '../src/domains';

const LANGS: Lang[] = ['en', 'it'];
const h = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const brandify = (s: string) => s.split('{brand}').join(BRAND_NAME).split('{newsletter}').join(SITE.newsletter);
const abs = (p: string) => SITE.url + p;

const LOGO_MARK = `<svg class="mark" viewBox="0 0 24 24" aria-hidden="true" width="28" height="28"><rect width="24" height="24" rx="6" fill="currentColor"/><path fill="#fff" d="M6.5 4.5h3.2v15H6.5zM9.7 13.2l5.6-6.7h3.9l-6.1 7.1 6.4 5.9h-4.1z"/></svg>`;
export const LOGO_SVG = LOGO_MARK.replace('class="mark" ', 'xmlns="http://www.w3.org/2000/svg" ').replace(' aria-hidden="true"', '').replace('currentColor', '#0f766e');

/** "Kitlibre" → "Kit" + accent "libre" (falls back to plain name for other brands). */
function wordmark() {
  const m = /^(Kit)(.+)$/.exec(BRAND_NAME);
  return m ? `${h(m[1])}<span class="accent">${h(m[2])}</span>` : h(BRAND_NAME);
}

function header(t: Dict, lang: Lang, page: PageId | null) {
  const link = (id: PageId, label: string) =>
    `<a href="${ROUTES[id][lang]}"${page === id ? ' aria-current="page"' : ''}>${h(label)}</a>`;
  const other: Lang = lang === 'en' ? 'it' : 'en';
  const target = page ? ROUTES[page][other] : ROUTES.hub[other];
  return `<a class="skip" href="#main">${h(t.skip)}</a>
<header class="site-header"><div class="wrap bar">
  <a class="brand" href="${ROUTES.hub[lang]}" aria-label="${h(BRAND_NAME)} – ${h(t.navTools)}">${LOGO_MARK}<span class="wordmark">${wordmark()}</span></a>
  <nav aria-label="Main">${link('hub', t.navTools)}${link('generator', t.navGenerator)}${link('checker', t.navChecker)}</nav>
  <div class="lang" role="group" aria-label="${h(t.langSwitch)}">
    <a href="${lang === 'en' ? '#' : target}" hreflang="en" lang="en"${lang === 'en' ? ' aria-current="true"' : ''} data-lang-link="en">EN</a>
    <a href="${lang === 'it' ? '#' : target}" hreflang="it" lang="it"${lang === 'it' ? ' aria-current="true"' : ''} data-lang-link="it">IT</a>
  </div>
</div></header>`;
}

function footer(t: Dict, lang: Lang) {
  const repo = SITE.repoUrl ? `<a href="${SITE.repoUrl}" rel="noopener">${h(t.footerOss)} · GitHub</a>` : `<span>${h(t.footerOss)} · ${h(t.repoSoon)}</span>`;
  return `<footer class="site-footer"><div class="wrap">
  <p class="foot-brand">${LOGO_MARK}<strong>${h(BRAND_NAME)}</strong> — ${h(t.tagline)}</p>
  <p>${h(t.footerNoTrack)}</p>
  <p class="foot-links"><a href="${ROUTES.hub[lang]}">${h(t.navTools)}</a> · <a href="${ROUTES.generator[lang]}">${h(t.navGenerator)}</a> · <a href="${ROUTES.checker[lang]}">${h(t.navChecker)}</a> · <a href="${ROUTES.newsletter[lang]}">${h(t.navNewsletter)}</a> · <a href="${ROUTES.privacy[lang]}">${h(t.navPrivacy)}</a> · ${repo}</p>
</div></footer>`;
}

function faqBlock(title: string, items: [string, string][]) {
  return `<section class="faq" aria-labelledby="faq-h"><h2 id="faq-h">${h(title)}</h2>
${items.map(([q, a]) => `<details><summary>${h(q)}</summary><p>${h(a)}</p></details>`).join('\n')}
</section>`;
}

function jsonLd(obj: unknown) {
  return `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;
}

interface PageSpec {
  id: PageId | '404';
  lang: Lang;
  title: string;
  desc: string;
  body: string;
  ld: unknown[];
  /** OG image basename, e.g. "og-qr" → /og-qr-en.png */
  og?: string;
}

function layout(p: PageSpec) {
  const t = STRINGS[p.lang];
  const route = p.id === '404' ? null : ROUTES[p.id];
  const canonical = route ? abs(route[p.lang]) : '';
  const alternates = route
    ? LANGS.map((l) => `<link rel="alternate" hreflang="${l}" href="${abs(route[l])}">`).join('\n') +
      `\n<link rel="alternate" hreflang="x-default" href="${abs(route.en)}">`
    : '';
  const robots = SITE.noindex || p.id === '404' ? '<meta name="robots" content="noindex">' : '<meta name="robots" content="index,follow">';
  return brandify(`<!doctype html>
<html lang="${p.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${h(p.title)}</title>
<meta name="description" content="${h(p.desc)}">
${robots}
${canonical ? `<link rel="canonical" href="${canonical}">` : ''}
${alternates}
<meta name="theme-color" content="#0f766e">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${h(BRAND_NAME)}">
<meta property="og:title" content="${h(p.title)}">
<meta property="og:description" content="${h(p.desc)}">
${canonical ? `<meta property="og:url" content="${canonical}">` : ''}
<meta property="og:image" content="${abs(`/${p.og ?? 'og-hub'}-${p.lang}.png`)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:locale" content="${t.locale}">
<meta property="og:locale:alternate" content="${p.lang === 'en' ? 'it_IT' : 'en_US'}">
<meta name="twitter:card" content="summary_large_image">
${p.ld.map(jsonLd).join('\n')}
<script type="module" src="/src/main.ts"></script>
</head>
<body data-page="${p.id}">
${header(t, p.lang, p.id === '404' ? null : p.id)}
<main id="main" tabindex="-1">
${p.body}
</main>
${footer(t, p.lang)}
</body>
</html>
`);
}

function nlForm(t: Dict) {
  return `<!-- TODO(newsletter): connect "${h(SITE.newsletter)}" to a privacy-friendly double-opt-in provider. Until then this form sends and stores NOTHING. -->
<form class="nl-form" id="nl-form" novalidate><label class="sr-only" for="nl-email">${h(t.nlEmail)}</label>
<input id="nl-email" type="email" placeholder="${h(t.nlEmail)}" autocomplete="email"><button class="btn primary" type="submit">${h(t.nlBtn)}</button></form>
<p class="hint" id="nl-msg" role="status"></p>`;
}

function hubBody(t: Dict, lang: Lang) {
  const card = (title: string, text: string, links: [string, string][], soon = false) =>
    `<li class="tool-card${soon ? ' soon' : ''}"><span class="pill${soon ? '' : ' live'}">${h(soon ? t.soon : t.live)}</span>
<h3>${soon ? h(title) : `<a href="${links[0][0]}">${h(title)}</a>`}</h3><p>${h(text)}</p>
${links.length ? `<p class="card-links">${links.map(([href, label], i) => `<a class="btn${i === 0 ? ' primary' : ''} small" href="${href}">${h(label)}</a>`).join(' ')}</p>` : ''}</li>`;
  return `<section class="hero wrap hub-hero"><h1>${h(t.hubH1)}</h1><p class="lead">${h(t.hubLead)}</p>
<ul class="badges"><li>${h(t.badgeNoSignup)}</li><li>${h(t.badgeOnDevice)}</li><li>${h(t.badgeOpenSource)}</li></ul></section>
<div class="wrap content">
<section aria-labelledby="tools-h"><h2 id="tools-h" class="section-h">${h(t.toolsH)}</h2>
<ul class="tool-grid">
${card(t.qrCardT, t.qrCardP, [[ROUTES.generator[lang], t.openTool + ' →']])}
${card(t.chkCardT, t.chkCardP, [[ROUTES.checker[lang], t.openTool + ' →']])}
${t.soonTools.map(([a, b]) => card(a, b, [], true)).join('\n')}
</ul></section>
<section aria-labelledby="pr-h"><h2 id="pr-h" class="section-h">${h(t.principlesH)}</h2>
<ul class="principles">${t.principles.map(([a, b], i) => `<li><strong>${h(a)}</strong><span>${h(b)}${i === t.principles.length - 1 && SITE.repoUrl ? ` <a href="${SITE.repoUrl}" rel="noopener">${h(t.repoLink)} →</a>` : ''}</span></li>`).join('')}</ul></section>
<section class="card nl-teaser" aria-labelledby="nlt-h"><h2 id="nlt-h">${h(t.nlTeaserH)}</h2><p>${h(t.nlTeaserP)}</p>
<p><a class="btn primary" href="${ROUTES.newsletter[lang]}">${h(t.nlTeaserCta)} →</a></p></section>
</div>`;
}

function newsletterBody(t: Dict) {
  return `<section class="wrap prose narrow"><h1>${h(t.nlPageH1)}</h1><p class="lead">${h(t.nlPageLead)}</p>
<div class="card newsletter nl-page">${nlForm(t)}</div>
<h2>${h(t.nlExpectH)}</h2><ul>${t.nlExpect.map((x) => `<li>${h(x)}</li>`).join('')}</ul></section>`;
}

function field(id: string, label: string, input: string, hint?: string) {
  return `<div class="field"><label for="${id}">${h(label)}</label>${input}${hint ? `<p class="hint" id="${id}-hint">${h(hint)}</p>` : ''}</div>`;
}
const inp = (id: string, type = 'text', attrs = '') => `<input id="${id}" name="${id}" type="${type}" ${attrs}>`;

function generatorBody(t: Dict, lang: Lang) {
  const types = ['url', 'text', 'wifi', 'vcard', 'email', 'phone', 'sms'] as const;
  const tabs = types
    .map(
      (ty, i) =>
        `<label class="seg"><input type="radio" name="qrtype" value="${ty}"${i === 0 ? ' checked' : ''}><span>${h(t[`type_${ty}`])}</span></label>`,
    )
    .join('');
  const utm = `<details class="utm" id="utm"><summary>${h(t.utmToggle)}</summary>
<p class="hint">${h(t.utmHint)}</p>
<div class="grid2">
${field('utm-source', t.utmSource, inp('utm-source', 'text', `placeholder="${h(t.utmSourcePh)}" autocomplete="off"`))}
${field('utm-medium', t.utmMedium, inp('utm-medium', 'text', `placeholder="${h(t.utmMediumPh)}" autocomplete="off"`))}
${field('utm-campaign', t.utmCampaign, inp('utm-campaign', 'text', `placeholder="${h(t.utmCampaignPh)}" autocomplete="off"`))}
${field('utm-term', t.utmTerm, inp('utm-term', 'text', 'autocomplete="off"'))}
${field('utm-content', t.utmContent, inp('utm-content', 'text', 'autocomplete="off"'))}
</div></details>`;
  const panels = `
<div class="panel" data-for="url">
${field('f-url', t.fUrl, inp('f-url', 'url', `placeholder="${h(t.fUrlPh)}" inputmode="url" autocomplete="url" aria-describedby="f-url-hint" spellcheck="false"`), t.fUrlHint)}
${utm}
</div>
<div class="panel" data-for="text" hidden>
${field('f-text', t.fText, `<textarea id="f-text" name="f-text" rows="5" placeholder="${h(t.fTextPh)}"></textarea>`)}
</div>
<div class="panel" data-for="wifi" hidden>
${field('f-ssid', t.fWifiSsid, inp('f-ssid', 'text', 'autocomplete="off" spellcheck="false"'))}
<div class="grid2">
${field('f-wsec', t.fWifiSec, `<select id="f-wsec" name="f-wsec"><option value="WPA">${h(t.wifiWPA)}</option><option value="WEP">${h(t.wifiWEP)}</option><option value="nopass">${h(t.wifiNone)}</option></select>`)}
${field('f-wpass', t.fWifiPass, inp('f-wpass', 'text', 'autocomplete="off" spellcheck="false"'))}
</div>
<label class="check"><input type="checkbox" id="f-whidden"> ${h(t.fWifiHidden)}</label>
</div>
<div class="panel" data-for="vcard" hidden>
<div class="grid2">
${field('v-first', t.fFirst, inp('v-first', 'text', 'autocomplete="given-name"'))}
${field('v-last', t.fLast, inp('v-last', 'text', 'autocomplete="family-name"'))}
${field('v-org', t.fOrg, inp('v-org', 'text', 'autocomplete="organization"'))}
${field('v-title', t.fTitle, inp('v-title', 'text', 'autocomplete="organization-title"'))}
${field('v-phone', t.fPhone, inp('v-phone', 'tel', 'autocomplete="tel"'))}
${field('v-mobile', t.fMobile, inp('v-mobile', 'tel', 'autocomplete="tel"'))}
${field('v-email', t.fEmail, inp('v-email', 'email', 'autocomplete="email"'))}
${field('v-website', t.fWebsite, inp('v-website', 'url', 'autocomplete="url"'))}
${field('v-street', t.fStreet, inp('v-street', 'text', 'autocomplete="street-address"'))}
${field('v-city', t.fCity, inp('v-city', 'text', 'autocomplete="address-level2"'))}
${field('v-zip', t.fZip, inp('v-zip', 'text', 'autocomplete="postal-code"'))}
${field('v-region', t.fRegion, inp('v-region', 'text', 'autocomplete="address-level1"'))}
${field('v-country', t.fCountry, inp('v-country', 'text', 'autocomplete="country-name"'))}
</div>
${field('v-note', t.fNote, `<textarea id="v-note" name="v-note" rows="2"></textarea>`)}
</div>
<div class="panel" data-for="email" hidden>
${field('e-to', t.fEmailTo, inp('e-to', 'email', 'autocomplete="email"'))}
${field('e-subject', t.fEmailSubject, inp('e-subject'))}
${field('e-body', t.fEmailBody, `<textarea id="e-body" name="e-body" rows="4"></textarea>`)}
</div>
<div class="panel" data-for="phone" hidden>
${field('p-phone', t.fPhoneNumber, inp('p-phone', 'tel', `placeholder="${h(t.fPhonePh)}" autocomplete="tel"`))}
</div>
<div class="panel" data-for="sms" hidden>
${field('s-phone', t.fPhoneNumber, inp('s-phone', 'tel', `placeholder="${h(t.fPhonePh)}" autocomplete="tel"`))}
${field('s-msg', t.fSmsMessage, `<textarea id="s-msg" name="s-msg" rows="3"></textarea>`)}
</div>`;
  const design = `<details class="card design" open><summary><h2>${h(t.designH)}</h2></summary>
<div class="grid2">
${field('d-fg', t.fFg, inp('d-fg', 'color', 'value="#111827"'))}
${field('d-bg', t.fBg, inp('d-bg', 'color', 'value="#ffffff"'))}
${field('d-ec', t.fEc, `<select id="d-ec"><option value="L">${h(t.ecL)}</option><option value="M" selected>${h(t.ecM)}</option><option value="Q">${h(t.ecQ)}</option><option value="H">${h(t.ecH)}</option></select>`)}
${field('d-size', t.fSize, `<div class="range"><input id="d-size" type="range" min="256" max="4096" step="64" value="1024"><output for="d-size" id="d-size-out">1024 px</output></div>`)}
${field('d-margin', t.fMargin, `<div class="range"><input id="d-margin" type="range" min="0" max="10" step="1" value="4"><output for="d-margin" id="d-margin-out">4 ${h(t.modules)}</output></div>`)}
</div>
<div class="field"><label for="d-logo">${h(t.fLogo)}</label>
<input id="d-logo" type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" aria-describedby="d-logo-hint">
<p class="hint" id="d-logo-hint">${h(t.logoHint)}</p>
<div class="logo-row" id="logo-row" hidden>
${field('d-logo-size', t.fLogoSize, `<div class="range"><input id="d-logo-size" type="range" min="10" max="30" step="1" value="22"><output for="d-logo-size" id="d-logo-size-out">22%</output></div>`)}
<button type="button" class="btn ghost" id="d-logo-remove">${h(t.logoRemove)}</button>
</div></div>
</details>`;
  const preview = `<aside class="preview card" aria-labelledby="prev-h">
<h2 id="prev-h">${h(t.previewH)}</h2>
<div class="qr-box" id="qr-box" role="img" aria-label="${h(t.previewH)}"><p class="empty">${h(t.previewEmpty)}</p></div>
<p class="stats" id="qr-stats" aria-live="polite"></p>
<div class="warnings" id="qr-warn" aria-live="polite"></div>
<div class="dl"><button type="button" class="btn primary" id="dl-png" disabled>${h(t.dlPng)}</button><button type="button" class="btn" id="dl-svg" disabled>${h(t.dlSvg)}</button></div>
<div class="content-out"><div class="content-head"><span>${h(t.contentLabel)}</span><button type="button" class="btn ghost small" id="copy-content" disabled>${h(t.copyContent)}</button></div><pre id="qr-content" tabindex="0"></pre></div>
<p class="hint">${h(t.testScan)}</p>
<section class="newsletter" id="newsletter" hidden aria-labelledby="nl-h">
<h3 id="nl-h">${h(t.nlH)}</h3><p>${h(t.nlText)}</p>
${nlForm(t)}
</section>
</aside>`;

  const cmp = `<section class="prose"><h2>${h(t.cmpH)}</h2><div class="table-wrap"><table>
<thead><tr><th scope="col"><span class="sr-only">Feature</span></th><th scope="col">${h(t.cmpStatic)}</th><th scope="col">${h(t.cmpDynamic)}</th></tr></thead>
<tbody>${t.cmpRows.map((r) => `<tr><th scope="row">${h(r[0])}</th><td class="good">${h(r[1])}</td><td class="bad">${h(r[2])}</td></tr>`).join('')}</tbody>
</table></div></section>`;

  return `<section class="hero wrap"><h1>${h(t.genH1)}</h1><p class="lead">${h(t.genLead)}</p>
<ul class="badges"><li>${h(t.badgeNeverExpires)}</li><li>${h(t.badgeNoSignup)}</li><li>${h(t.badgeOnDevice)}</li><li>${h(t.badgeOpenSource)}</li></ul></section>
<div class="wrap tool">
<form class="gen-form" id="gen-form" autocomplete="on" novalidate>
<section class="card"><fieldset class="types"><legend>${h(t.typeLegend)}</legend><div class="segs">${tabs}</div></fieldset>
${panels}
</section>
${design}
</form>
${preview}
</div>
<div class="wrap content">
<section class="prose"><h2>${h(t.whyH)}</h2><p>${h(t.whyP1)}</p><p>${h(t.whyP2)}</p>
<p><a class="btn" href="${ROUTES.checker[lang]}">${h(t.navChecker)} →</a></p></section>
${cmp}
${faqBlock(t.faqH, t.genFaq)}
</div>`;
}

function checkerBody(t: Dict, lang: Lang) {
  const group = (kind: string, title: string) =>
    `<h3>${h(title)}</h3><ul class="domain-list">${DOMAINS.filter((d) => d.kind === kind)
      .map((d) => `<li><code>${h(d.domain)}</code> <span>${h(d.vendor)}</span></li>`)
      .join('')}</ul>`;
  return `<section class="hero wrap"><h1>${h(t.chkH1)}</h1><p class="lead">${h(t.chkLead)}</p></section>
<div class="wrap checker">
<section class="card">
<div class="drop" id="drop" tabindex="0" aria-describedby="drop-hint">
<svg viewBox="0 0 24 24" width="40" height="40" aria-hidden="true"><path fill="currentColor" d="M3 3h7v7H3zm2 2v3h3V5zm9-2h7v7h-7zm2 2v3h3V5zM3 14h7v7H3zm2 2v3h3v-3zm11-2h2v3h3v2h-3v2h-2v-2h-2v-2h2z"/></svg>
<p><strong>${h(t.dropTitle)}</strong> <label class="linklike" for="chk-file">${h(t.chooseFile)}</label></p>
<input id="chk-file" type="file" accept="image/*" class="sr-only">
<p class="hint" id="drop-hint">${h(t.dropHint)}</p>
</div>
<div class="row"><button type="button" class="btn" id="cam-btn">${h(t.camera)}</button></div>
<div class="cam" id="cam" hidden><video id="cam-video" playsinline muted></video></div>
<form class="paste" id="paste-form"><label for="paste-input">${h(t.orLink)}</label><div class="row"><input id="paste-input" type="text" inputmode="url" spellcheck="false" placeholder="https://qrco.de/…"><button class="btn" type="submit">${h(t.checkBtn)}</button></div></form>
<p class="hint privacy">${h(t.privacyNote)}</p>
</section>
<section class="card result" id="result" hidden aria-live="polite" tabindex="-1"></section>
</div>
<div class="wrap content">
<section class="prose"><h2>${h(t.chkWhyH)}</h2><p>${h(t.chkWhyP1)}</p><p>${h(t.chkWhyP2)}</p>
<p><a class="btn primary" href="${ROUTES.generator[lang]}">${h(t.ctaNew)} →</a></p></section>
<section class="prose"><h2>${h(t.listH)}</h2><p>${h(t.listIntro)}</p>
${group('dynamic-qr', t.listDynamic)}${group('shortener', t.listShortener)}${group('discontinued', t.listDiscontinued)}
</section>
${faqBlock(t.faqH, t.chkFaq)}
</div>`;
}

function privacyBody(t: Dict) {
  return `<section class="wrap prose narrow"><h1>${h(t.privH1)}</h1>${t.privBody.map((p) => `<p>${h(p)}</p>`).join('')}${SITE.repoUrl ? `<p>${h(t.privRepo)} <a href="${SITE.repoUrl}" rel="noopener">${h(SITE.repoUrl.replace('https://', ''))}</a></p>` : ''}</section>`;
}

function notFoundBody(t: Dict, lang: Lang) {
  return `<section class="wrap prose narrow"><h1>${h(t.notFoundH1)}</h1><p>${h(t.notFoundP)}</p>
<p><a class="btn primary" href="${ROUTES.generator[lang]}">${h(t.navGenerator)}</a> <a class="btn" href="${ROUTES.checker[lang]}">${h(t.navChecker)}</a> <a class="btn" href="${ROUTES.hub[lang]}">${h(t.navTools)}</a></p></section>`;
}

const faqLd = (items: [string, string][]) => ({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: items.map(([q, a]) => ({ '@type': 'Question', name: brandify(q), acceptedAnswer: { '@type': 'Answer', text: brandify(a) } })),
});
const appLd = (name: string, desc: string, url: string, lang: Lang) => ({
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  name: brandify(name),
  description: brandify(desc),
  url,
  inLanguage: lang,
  applicationCategory: 'UtilitiesApplication',
  operatingSystem: 'Any (web browser)',
  isAccessibleForFree: true,
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
  publisher: { '@type': 'Organization', name: BRAND_NAME, url: SITE.url },
});
const crumbs = (lang: Lang, name: string, url: string) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: BRAND_NAME, item: abs(ROUTES.hub[lang]) },
    { '@type': 'ListItem', position: 2, name: brandify(lang === 'it' ? 'Generatore di QR code' : 'QR code generator'), item: abs(ROUTES.generator[lang]) },
    ...(url === abs(ROUTES.generator[lang]) ? [] : [{ '@type': 'ListItem', position: 3, name: brandify(name), item: url }]),
  ],
});

export interface GeneratedPage { file: string; html: string }

export function generatePages(): GeneratedPage[] {
  const out: GeneratedPage[] = [];
  const file = (route: string) => (route === '/' ? 'index.html' : route.replace(/^\//, '') + 'index.html');
  for (const lang of LANGS) {
    const t = STRINGS[lang];
    out.push({
      file: file(ROUTES.hub[lang]),
      html: layout({
        id: 'hub', lang, title: t.hubTitle, desc: t.hubDesc, body: hubBody(t, lang), og: 'og-hub',
        ld: [
          { '@context': 'https://schema.org', '@type': 'WebSite', name: BRAND_NAME, url: abs(ROUTES.hub[lang]), inLanguage: lang, description: brandify(t.hubDesc) },
          { '@context': 'https://schema.org', '@type': 'Organization', name: BRAND_NAME, url: SITE.url, logo: abs('/logo.png'), slogan: t.tagline },
          { '@context': 'https://schema.org', '@type': 'ItemList', itemListElement: [
            { '@type': 'ListItem', position: 1, name: t.qrCardT, url: abs(ROUTES.generator[lang]) },
            { '@type': 'ListItem', position: 2, name: t.chkCardT, url: abs(ROUTES.checker[lang]) },
          ] },
        ],
      }),
    });
    out.push({
      file: file(ROUTES.generator[lang]),
      html: layout({
        id: 'generator', lang, title: t.genTitle, desc: t.genDesc, body: generatorBody(t, lang), og: 'og-qr',
        ld: [appLd(t.genH1, t.genDesc, abs(ROUTES.generator[lang]), lang), faqLd(t.genFaq), crumbs(lang, t.genH1, abs(ROUTES.generator[lang]))],
      }),
    });
    out.push({
      file: file(ROUTES.newsletter[lang]),
      html: layout({
        id: 'newsletter', lang, title: t.nlPageTitle, desc: t.nlPageDesc, body: newsletterBody(t), og: 'og-newsletter',
        ld: [{ '@context': 'https://schema.org', '@type': 'WebPage', name: brandify(t.nlPageTitle), description: brandify(t.nlPageDesc), url: abs(ROUTES.newsletter[lang]), inLanguage: lang, publisher: { '@type': 'Organization', name: BRAND_NAME } }],
      }),
    });
    out.push({
      file: file(ROUTES.checker[lang]),
      html: layout({
        id: 'checker', lang, title: t.chkTitle, desc: t.chkDesc, body: checkerBody(t, lang), og: 'og-qr',
        ld: [appLd(t.chkH1, t.chkDesc, abs(ROUTES.checker[lang]), lang), faqLd(t.chkFaq), crumbs(lang, t.chkH1, abs(ROUTES.checker[lang]))],
      }),
    });
    out.push({
      file: file(ROUTES.privacy[lang]),
      html: layout({ id: 'privacy', lang, title: t.privTitle, desc: t.privDesc, body: privacyBody(t), ld: [] }),
    });
  }
  out.push({ file: '404.html', html: layout({ id: '404', lang: 'en', title: STRINGS.en.notFoundTitle, desc: STRINGS.en.genDesc, body: notFoundBody(STRINGS.en, 'en'), ld: [] }) });
  return out;
}

export function sitemapXml(): string {
  const today = new Date().toISOString().slice(0, 10);
  const urls = (Object.keys(ROUTES) as PageId[]).flatMap((id) =>
    LANGS.map(
      (l) => `  <url><loc>${abs(ROUTES[id][l])}</loc><lastmod>${today}</lastmod>
${LANGS.map((a) => `    <xhtml:link rel="alternate" hreflang="${a}" href="${abs(ROUTES[id][a])}"/>`).join('\n')}
    <xhtml:link rel="alternate" hreflang="x-default" href="${abs(ROUTES[id].en)}"/>
  </url>`,
    ),
  );
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join('\n')}
</urlset>
`;
}

export function robotsTxt(): string {
  return SITE.noindex
    ? `# Preview build: not for indexing\nUser-agent: *\nDisallow: /\n`
    : `User-agent: *\nAllow: /\n\nSitemap: ${abs('/sitemap.xml')}\n`;
}

export function webManifest(): string {
  return JSON.stringify({
    name: BRAND_NAME, short_name: BRAND_NAME, start_url: '/', display: 'standalone',
    background_color: '#ffffff', theme_color: '#0f766e',
    icons: [
      { src: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
      { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' },
    ],
  });
}

/** Cloudflare Pages _redirects: legacy preview paths → new structure. */
export function redirectsFile(): string {
  return LEGACY_REDIRECTS.flatMap(([from, to]) => [`${from} ${to} 301`, `${from.replace(/\/$/, '')} ${to} 301`]).join('\n') + '\n';
}
