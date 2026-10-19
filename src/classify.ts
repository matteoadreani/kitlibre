import { findDomain, type DomainEntry } from './domains';

export type ContentKind = 'url' | 'wifi' | 'vcard' | 'email' | 'phone' | 'sms' | 'geo' | 'text';
export type Verdict = 'dynamic' | 'shortener' | 'discontinued' | 'static' | 'maybe-short' | 'not-url';

export interface Classification {
  raw: string;
  kind: ContentKind;
  verdict: Verdict;
  url?: URL;
  host?: string;
  match?: DomainEntry;
  insecure?: boolean;
}

export function contentKind(raw: string): ContentKind {
  const s = raw.trim();
  if (/^WIFI:/i.test(s)) return 'wifi';
  if (/^BEGIN:VCARD/i.test(s) || /^MECARD:/i.test(s)) return 'vcard';
  if (/^mailto:/i.test(s) || /^MATMSG:/i.test(s)) return 'email';
  if (/^tel:/i.test(s)) return 'phone';
  if (/^(smsto|sms|mms|mmsto):/i.test(s)) return 'sms';
  if (/^geo:/i.test(s)) return 'geo';
  if (/^https?:\/\//i.test(s) || /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(s)) return 'url';
  return 'text';
}

export function classify(raw: string): Classification {
  const kind = contentKind(raw);
  if (kind !== 'url') return { raw, kind, verdict: 'not-url' };
  const s = raw.trim();
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(s) ? s : 'http://' + s);
  } catch {
    return { raw, kind: 'text', verdict: 'not-url' };
  }
  const host = url.hostname.toLowerCase();
  const insecure = url.protocol === 'http:';
  const match = findDomain(host);
  if (match) {
    const verdict: Verdict = match.kind === 'dynamic-qr' ? 'dynamic' : match.kind === 'shortener' ? 'shortener' : 'discontinued';
    return { raw, kind, verdict, url, host, match, insecure };
  }
  // Heuristic: very short host + single short opaque path segment looks like an unknown short link.
  const segs = url.pathname.split('/').filter(Boolean);
  const bare = host.replace(/^www\./, '');
  const looksShort =
    bare.length <= 8 && segs.length === 1 && /^[A-Za-z0-9_-]{4,12}$/.test(segs[0]) && /[A-Z0-9]/.test(segs[0]) && !url.search;
  return { raw, kind, verdict: looksShort ? 'maybe-short' : 'static', url, host, insecure };
}
