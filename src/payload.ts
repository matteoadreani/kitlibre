/** Pure functions that turn form data into the exact text stored in a QR code. */

export type QrType = 'url' | 'text' | 'wifi' | 'vcard' | 'email' | 'phone' | 'sms';
export const QR_TYPES: QrType[] = ['url', 'text', 'wifi', 'vcard', 'email', 'phone', 'sms'];

export interface UtmParams {
  source?: string;
  medium?: string;
  campaign?: string;
  term?: string;
  content?: string;
}

export interface WifiData {
  ssid: string;
  password?: string;
  security: 'WPA' | 'WEP' | 'nopass';
  hidden?: boolean;
}

export interface VCardData {
  firstName?: string;
  lastName?: string;
  org?: string;
  title?: string;
  phone?: string;
  mobile?: string;
  email?: string;
  website?: string;
  street?: string;
  city?: string;
  zip?: string;
  region?: string;
  country?: string;
  note?: string;
}

export interface EmailData { to: string; subject?: string; body?: string }
export interface SmsData { phone: string; message?: string }

const trim = (s: string | undefined) => (s ?? '').trim();

/** Adds https:// when the user typed a bare domain like "example.com/menu". */
export function normalizeUrl(input: string): string {
  const s = trim(input);
  if (!s) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return s;
  return 'https://' + s.replace(/^\/+/, '');
}

/** Appends utm_* parameters (only non-empty ones) without touching existing query or hash. */
export function applyUtm(url: string, utm: UtmParams): string {
  const entries = (
    [
      ['utm_source', utm.source],
      ['utm_medium', utm.medium],
      ['utm_campaign', utm.campaign],
      ['utm_term', utm.term],
      ['utm_content', utm.content],
    ] as const
  ).filter(([, v]) => trim(v));
  if (!url || entries.length === 0) return url;
  try {
    const u = new URL(url);
    for (const [k, v] of entries) u.searchParams.set(k, trim(v));
    return u.toString();
  } catch {
    const [beforeHash, hash] = url.split('#', 2);
    const qs = entries.map(([k, v]) => `${k}=${encodeURIComponent(trim(v))}`).join('&');
    return beforeHash + (beforeHash.includes('?') ? '&' : '?') + qs + (hash !== undefined ? '#' + hash : '');
  }
}

/** Escapes special chars for the WIFI: format (\ ; , : "). */
export function escapeWifi(s: string): string {
  return s.replace(/([\\;,:"])/g, '\\$1');
}

export function buildWifi(d: WifiData): string {
  const ssid = escapeWifi(d.ssid ?? '');
  if (!trim(d.ssid)) return '';
  const parts = [`T:${d.security === 'nopass' ? 'nopass' : d.security}`, `S:${ssid}`];
  if (d.security !== 'nopass' && d.password) parts.push(`P:${escapeWifi(d.password)}`);
  if (d.hidden) parts.push('H:true');
  return `WIFI:${parts.join(';')};;`;
}

/** Escapes text values for vCard 3.0. */
export function escapeVCard(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1');
}

export function buildVCard(d: VCardData): string {
  const e = (v?: string) => escapeVCard(trim(v));
  const first = trim(d.firstName);
  const last = trim(d.lastName);
  const fn = [first, last].filter(Boolean).join(' ') || trim(d.org);
  if (!fn && !trim(d.phone) && !trim(d.mobile) && !trim(d.email)) return '';
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', `N:${e(last)};${e(first)};;;`, `FN:${escapeVCard(fn)}`];
  if (trim(d.org)) lines.push(`ORG:${e(d.org)}`);
  if (trim(d.title)) lines.push(`TITLE:${e(d.title)}`);
  if (trim(d.phone)) lines.push(`TEL;TYPE=WORK,VOICE:${trim(d.phone)}`);
  if (trim(d.mobile)) lines.push(`TEL;TYPE=CELL:${trim(d.mobile)}`);
  if (trim(d.email)) lines.push(`EMAIL;TYPE=INTERNET:${trim(d.email)}`);
  if (trim(d.website)) lines.push(`URL:${normalizeUrl(d.website ?? "")}`);
  if ([d.street, d.city, d.region, d.zip, d.country].some((v) => trim(v)))
    lines.push(`ADR;TYPE=WORK:;;${e(d.street)};${e(d.city)};${e(d.region)};${e(d.zip)};${e(d.country)}`);
  if (trim(d.note)) lines.push(`NOTE:${e(d.note)}`);
  lines.push('END:VCARD');
  return lines.join('\r\n');
}

export function buildEmail(d: EmailData): string {
  const to = trim(d.to);
  if (!to) return '';
  const q: string[] = [];
  if (trim(d.subject)) q.push('subject=' + encodeURIComponent(trim(d.subject)));
  if (trim(d.body)) q.push('body=' + encodeURIComponent(d.body!.trim()));
  return `mailto:${to}${q.length ? '?' + q.join('&') : ''}`;
}

/** Keeps a leading + and digits only (spaces, dashes, dots and brackets are removed). */
export function cleanPhone(s: string): string {
  const t = trim(s);
  return (t.startsWith('+') ? '+' : '') + t.replace(/[^0-9]/g, '');
}

export function buildPhone(phone: string): string {
  const p = cleanPhone(phone);
  return p.replace('+', '') ? `tel:${p}` : '';
}

export function buildSms(d: SmsData): string {
  const p = cleanPhone(d.phone);
  if (!p.replace('+', '')) return '';
  return trim(d.message) ? `SMSTO:${p}:${d.message!.trim()}` : `SMSTO:${p}:`;
}

export function buildUrl(url: string, utm?: UtmParams): string {
  const u = normalizeUrl(url);
  return utm ? applyUtm(u, utm) : u;
}
