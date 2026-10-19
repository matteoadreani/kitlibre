/**
 * Known redirect domains used by dynamic / trial QR services and generic link shorteners.
 *
 * A QR code that contains one of these addresses does NOT contain your destination: it
 * contains a short link owned by a third party, which forwards scanners to the real page
 * only while that service (and often your paid subscription) keeps the redirect active.
 *
 * Sources (checked Oct 2026): vendor help pages (support.qr-code-generator.com "Why are there
 * different short URL domains?", support.qrfy.com, support.scanova.io), vendor pricing/FAQ
 * pages, and the public survey "We decoded 77 QR codes from the generators' own websites"
 * (b59.link, Oct 2026). Pull requests with additions are welcome — please add a source.
 */
export type DomainKind = 'dynamic-qr' | 'shortener' | 'discontinued';

export interface DomainEntry {
  /** Registrable domain or host; subdomains match too. */
  domain: string;
  vendor: string;
  kind: DomainKind;
  /** Short, factual note about what happens when it lapses. */
  note?: { en: string; it: string };
}

const QRCG = 'QR Code Generator PRO (qr-code-generator.com, Bitly)';
const QRCG_NOTE = { en: 'Dynamic codes from the 14-day trial are deactivated when it ends; scans go to a vendor service page.', it: 'I codici dinamici della prova di 14 giorni vengono disattivati alla scadenza; le scansioni finiscono su una pagina del fornitore.' };

export const DOMAINS: DomainEntry[] = [
  // --- Dynamic QR code vendors (short-link domains) ---
  { domain: 'qrco.de', vendor: QRCG, kind: 'dynamic-qr', note: QRCG_NOTE },
  { domain: 'l.ead.me', vendor: QRCG, kind: 'dynamic-qr', note: QRCG_NOTE },
  { domain: 'q-r.to', vendor: QRCG, kind: 'dynamic-qr', note: QRCG_NOTE },
  { domain: 'qr-code-generator.com', vendor: QRCG, kind: 'dynamic-qr', note: QRCG_NOTE },
  { domain: 'qr.io', vendor: 'QR.io', kind: 'dynamic-qr', note: { en: 'Dynamic codes from the 7-day trial stop unless you subscribe.', it: 'I codici dinamici della prova di 7 giorni smettono di funzionare se non ti abboni.' } },
  { domain: 'me-qr.com', vendor: 'ME-QR', kind: 'dynamic-qr', note: { en: 'Dynamic codes are blocked after 365 days without scans, then deleted.', it: 'I codici dinamici vengono bloccati dopo 365 giorni senza scansioni, poi eliminati.' } },
  { domain: 'qrfy.io', vendor: 'Qrfy', kind: 'dynamic-qr', note: { en: 'Trial dynamic codes (7 days) are paused and linked to a service page.', it: 'I codici dinamici della prova (7 giorni) vengono sospesi e collegati a una pagina del fornitore.' } },
  { domain: 'qrfy.com', vendor: 'Qrfy', kind: 'dynamic-qr', note: { en: 'Trial dynamic codes (7 days) are paused and linked to a service page.', it: 'I codici dinamici della prova (7 giorni) vengono sospesi e collegati a una pagina del fornitore.' } },
  { domain: 'qrcc.me', vendor: 'QRCodeChimp', kind: 'dynamic-qr', note: { en: 'Free plan keeps only a limited number of dynamic codes active, with a monthly scan cap.', it: 'Il piano gratuito mantiene attivi solo pochi codici dinamici, con un limite mensile di scansioni.' } },
  { domain: 'linko.page', vendor: 'QRCodeChimp', kind: 'dynamic-qr' },
  { domain: 'qrcodechimp.com', vendor: 'QRCodeChimp', kind: 'dynamic-qr' },
  { domain: 'qrs.ly', vendor: 'QR Stuff', kind: 'dynamic-qr', note: { en: 'Anonymous dynamic codes expire after 7 days, free-account ones after 30 days.', it: 'I codici dinamici anonimi scadono dopo 7 giorni, quelli con account gratuito dopo 30.' } },
  { domain: 'qrstuff.com', vendor: 'QR Stuff', kind: 'dynamic-qr' },
  { domain: 'scnv.io', vendor: 'Scanova', kind: 'dynamic-qr', note: { en: 'Dynamic codes stop working when the free trial or subscription ends.', it: 'I codici dinamici smettono di funzionare quando finisce la prova o l’abbonamento.' } },
  { domain: 'scanova.io', vendor: 'Scanova', kind: 'dynamic-qr', note: { en: 'Dynamic codes stop working when the free trial or subscription ends.', it: 'I codici dinamici smettono di funzionare quando finisce la prova o l’abbonamento.' } },
  { domain: 'qrc-ai.com', vendor: 'QRCode AI', kind: 'dynamic-qr' },
  { domain: 'qrcode-ai.com', vendor: 'QRCode AI', kind: 'dynamic-qr' },
  { domain: 'qrkit.co', vendor: 'QRCodeKIT', kind: 'dynamic-qr' },
  { domain: 'uqr.to', vendor: 'QRCodeKIT', kind: 'dynamic-qr' },
  { domain: 'qr-codes.io', vendor: 'The QR Code Generator (the-qrcode-generator.com)', kind: 'dynamic-qr' },
  { domain: 'the-qrcode-generator.com', vendor: 'The QR Code Generator', kind: 'dynamic-qr' },
  { domain: 'flowcode.com', vendor: 'Flowcode', kind: 'dynamic-qr' },
  { domain: 'flowto.it', vendor: 'Flowcode', kind: 'dynamic-qr' },
  { domain: 'qrcode-tiger.com', vendor: 'QR TIGER', kind: 'dynamic-qr' },
  { domain: 'uniqode.com', vendor: 'Uniqode (Beaconstac)', kind: 'dynamic-qr', note: { en: 'Trial dynamic codes are deactivated unless you subscribe.', it: 'I codici dinamici della prova vengono disattivati se non ti abboni.' } },
  { domain: 'beaconstac.com', vendor: 'Uniqode (Beaconstac)', kind: 'dynamic-qr' },
  { domain: 'qrcodestack.com', vendor: 'QR Code Stack', kind: 'dynamic-qr', note: { en: 'Dynamic codes stop redirecting when the subscription ends.', it: 'I codici dinamici smettono di reindirizzare quando l’abbonamento termina.' } },
  { domain: 'qr1.com', vendor: 'QR1', kind: 'dynamic-qr', note: { en: 'Codes stay active for 2 months after the trial or subscription ends.', it: 'I codici restano attivi per 2 mesi dopo la fine della prova o dell’abbonamento.' } },
  // Verified Oct 2026 — sources in comments.
  // Canva's dynamic QR app redirects via canvaqr.com; codes can be given an expiry date (canva.com/qr-code-generator).
  { domain: 'canvaqr.com', vendor: 'Canva (dynamic QR codes)', kind: 'dynamic-qr', note: { en: 'Canva dynamic codes redirect via canvaqr.com and can be set to expire; expired codes without a fallback show an error page.', it: 'I codici dinamici di Canva passano da canvaqr.com e possono avere una data di scadenza; senza un link di riserva mostrano una pagina di errore.' } },
  // QR TIGER default short URL is qr1.be (qrtiger.helpscoutdocs.com, qrcode-tiger.com/faq).
  { domain: 'qr1.be', vendor: 'QR TIGER', kind: 'dynamic-qr', note: { en: 'QR TIGER dynamic codes depend on an active QR TIGER account.', it: 'I codici dinamici QR TIGER dipendono da un account QR TIGER attivo.' } },
  // QR Planet: qrd.by is its QR platform (qr1.at/download/qrd.by-factsheet.pdf); paid accounts show qr1.at (qrplanet.com/pricing);
  // trial accounts are deactivated after 15 days unless you subscribe (qrplanet.com/help/article/will-my-qr-codes-expire).
  { domain: 'qrd.by', vendor: 'QR Planet (qrd.by)', kind: 'dynamic-qr', note: { en: 'Dynamic codes of a paid QR Planet account stop working when the 15-day trial ends without a subscription.', it: 'I codici dinamici di un account QR Planet a pagamento smettono di funzionare se la prova di 15 giorni finisce senza abbonamento.' } },
  { domain: 'qr1.at', vendor: 'QR Planet', kind: 'dynamic-qr', note: { en: 'Dynamic codes of a paid QR Planet account stop working when the 15-day trial ends without a subscription.', it: 'I codici dinamici di un account QR Planet a pagamento smettono di funzionare se la prova di 15 giorni finisce senza abbonamento.' } },
  { domain: 'qrplanet.com', vendor: 'QR Planet', kind: 'dynamic-qr', note: { en: 'Free-account dynamic codes do not expire but are capped at 50 scans per day per code.', it: 'I codici dinamici degli account gratuiti non scadono, ma hanno un limite di 50 scansioni al giorno per codice.' } },
  // Hovercode default redirect domains: hov.to, qrgo.is, scango.to, hovqr.co (hovercode.com/pricing-yearly, hovercode.com/qr-code-domain).
  { domain: 'hov.to', vendor: 'Hovercode', kind: 'dynamic-qr', note: { en: 'Hovercode free dynamic codes are limited to 3; the code only works while Hovercode keeps the redirect.', it: 'I codici dinamici gratuiti di Hovercode sono al massimo 3; il codice funziona solo finché Hovercode mantiene il reindirizzamento.' } },
  { domain: 'qrgo.is', vendor: 'Hovercode', kind: 'dynamic-qr' },
  { domain: 'scango.to', vendor: 'Hovercode', kind: 'dynamic-qr' },
  { domain: 'hovqr.co', vendor: 'Hovercode', kind: 'dynamic-qr' },
  { domain: 'qrcodedynamic.com', vendor: 'QR Code Dynamic', kind: 'dynamic-qr' },

  // --- Generic link shorteners (the code depends on a third-party redirect) ---
  { domain: 'bit.ly', vendor: 'Bitly', kind: 'shortener', note: { en: 'Bitly QR codes are bit.ly links; free plans are limited and may add an interstitial page.', it: 'I QR code di Bitly sono link bit.ly; i piani gratuiti sono limitati e possono aggiungere una pagina intermedia.' } },
  { domain: 'bitly.com', vendor: 'Bitly', kind: 'shortener' },
  { domain: 'tinyurl.com', vendor: 'TinyURL', kind: 'shortener' },
  { domain: 't.ly', vendor: 'T.LY', kind: 'shortener' },
  { domain: 'rebrand.ly', vendor: 'Rebrandly', kind: 'shortener' },
  { domain: 'rb.gy', vendor: 'rb.gy', kind: 'shortener' },
  { domain: 'ow.ly', vendor: 'Hootsuite (ow.ly)', kind: 'shortener' },
  { domain: 'buff.ly', vendor: 'Buffer (buff.ly)', kind: 'shortener' },
  { domain: 'is.gd', vendor: 'is.gd', kind: 'shortener' },
  { domain: 'v.gd', vendor: 'v.gd', kind: 'shortener' },
  { domain: 'cutt.ly', vendor: 'Cuttly', kind: 'shortener' },
  { domain: 'shorturl.at', vendor: 'ShortURL', kind: 'shortener' },
  { domain: 's.id', vendor: 's.id', kind: 'shortener' },
  { domain: 'short.gy', vendor: 'Short.io', kind: 'shortener' },
  { domain: 'tiny.cc', vendor: 'tiny.cc', kind: 'shortener' },
  { domain: 'dub.sh', vendor: 'Dub', kind: 'shortener' },
  { domain: 'bl.ink', vendor: 'BL.INK', kind: 'shortener' },
  { domain: 'lnkd.in', vendor: 'LinkedIn', kind: 'shortener' },
  { domain: 't.co', vendor: 'X / Twitter', kind: 'shortener' },
  { domain: 'qr.net', vendor: 'QR.net', kind: 'shortener' },

  // --- Discontinued redirect services ---
  { domain: 'goo.gl', vendor: 'Google URL Shortener', kind: 'discontinued', note: { en: 'Google shut the service down; since August 2025 many goo.gl links no longer redirect.', it: 'Google ha chiuso il servizio; da agosto 2025 molti link goo.gl non reindirizzano più.' } },
  { domain: 'page.link', vendor: 'Firebase Dynamic Links', kind: 'discontinued', note: { en: 'Firebase Dynamic Links was shut down on 25 August 2025; these links no longer work.', it: 'Firebase Dynamic Links è stato chiuso il 25 agosto 2025; questi link non funzionano più.' } },
];

export function findDomain(host: string): DomainEntry | undefined {
  const h = host.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  return DOMAINS.find((e) => h === e.domain || h.endsWith('.' + e.domain));
}
