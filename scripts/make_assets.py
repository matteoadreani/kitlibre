"""Generates raster brand assets (logo, apple-touch-icon, OG images) from src/config.ts.
Run after renaming: `npm run assets`. Requires Python 3 + Pillow (dev-only)."""
import json, re, subprocess
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
cfg = (ROOT / 'src/config.ts').read_text()
brand = re.search(r"BRAND_NAME = '([^']+)'", cfg).group(1)
newsletter = re.search(r"newsletter: '([^']+)'", cfg).group(1)
domain = re.search(r"\|\| 'https://([^']+)'", cfg).group(1)
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
FONT_R = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
TEAL, INK, MUTED, BG, YELLOW = (15, 118, 110), (17, 24, 39), (75, 85, 99), (247, 248, 250), (250, 204, 21)

def mark(size):
    """Same geometry as LOGO_MARK in scripts/pages.ts (24-unit viewBox), supersampled."""
    S = 4 * size
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    u = S / 24
    P = lambda pts: [(x * u, y * u) for x, y in pts]
    d.rounded_rectangle([0, 0, S - 1, S - 1], int(6 * u), fill=TEAL)
    d.rectangle([6.5 * u, 4.5 * u, 9.7 * u, 19.5 * u], fill='white')
    d.polygon(P([(9.7, 13.2), (15.3, 6.5), (19.2, 6.5), (13.1, 13.6), (19.5, 19.5), (15.4, 19.5)]), fill='white')
    return img.resize((size, size), Image.LANCZOS)

def wordmark(d, x, y, size):
    f = ImageFont.truetype(FONT, size)
    m = re.match(r'^(Kit)(.+)$', brand)
    a, b = (m.group(1), m.group(2)) if m else (brand, '')
    d.text((x, y), a, font=f, fill=INK)
    d.text((x + d.textlength(a, font=f), y), b, font=f, fill=TEAL)

def qr_matrix(text):
    js = "const q=require('qrcode');const m=q.create(process.argv[1],{errorCorrectionLevel:'M'}).modules;console.log(JSON.stringify({s:m.size,d:Array.from(m.data)}))"
    return json.loads(subprocess.check_output(['node', '-e', js, text], cwd=ROOT))

def draw_qr(img, m, x, y, size):
    d = ImageDraw.Draw(img)
    n = m['s'] + 8; s = size / n
    d.rectangle([x, y, x + size, y + size], fill='white')
    for r in range(m['s']):
        for c in range(m['s']):
            if m['d'][r * m['s'] + c]:
                d.rectangle([x + round((c + 4) * s), y + round((r + 4) * s), x + round((c + 5) * s) - 1, y + round((r + 5) * s) - 1], fill=INK)

def og(name, lines, sub, art=None):
    img = Image.new('RGB', (1200, 630), BG)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, 1200, 12], fill=TEAL)
    img.paste(mark(72), (70, 64), mark(72))
    wordmark(d, 162, 72, 48)
    fs = 52 if len(lines) <= 2 else 46
    maxw = 760 if art else 1060
    while max(d.textlength(l, font=ImageFont.truetype(FONT, fs)) for l in lines) > maxw: fs -= 2
    y = 200 if len(lines) <= 3 else 180
    for i, l in enumerate(lines):
        d.text((70, y), l, font=ImageFont.truetype(FONT, fs), fill=TEAL if i == len(lines) - 1 else INK)
        y += fs + 14
    ss = 26
    while d.textlength(sub, font=ImageFont.truetype(FONT_R, ss)) > maxw: ss -= 1
    d.text((70, y + 30), sub, font=ImageFont.truetype(FONT_R, ss), fill=MUTED)
    d.text((70, 560), domain, font=ImageFont.truetype(FONT, 26), fill=MUTED)
    if art == 'qr':
        d.rounded_rectangle([850, 165, 1130, 445], 24, fill='white', outline=(229, 231, 235), width=3)
        draw_qr(img, qr_matrix(f'https://{domain}/qr/'), 860, 175, 260)
    elif art == 'tools':
        for i, (dx, dy) in enumerate([(0, 0), (150, 0), (0, 150), (150, 0 + 150)]):
            x0, y0 = 860 + dx, 170 + dy
            d.rounded_rectangle([x0, y0, x0 + 125, y0 + 125], 22, fill=TEAL if i == 0 else 'white', outline=(229, 231, 235), width=3)
        img.paste(mark(85), (880, 190), mark(85))
        draw_qr(img, qr_matrix('kl'), 1018, 178, 108)
        g = ImageFont.truetype(FONT, 48)
        d.text((922, 382), 'Aa', font=g, fill=TEAL, anchor='mm')
        d.text((1072, 382), '@', font=g, fill=TEAL, anchor='mm')
    img.save(ROOT / f'public/{name}.png', optimize=True)

copy = {
    'en': {
        'hub': (['Free tools.', 'No subscription.', 'No signup required.', 'Forever.'], 'Open source · Files stay on your device'),
        'qr': (['Free static QR codes', 'that never expire.'], 'No signup required · No subscription · In your browser'),
        'nl': ([newsletter, 'Weekly. Free.'], 'One subscription trap explained, and the free way out.'),
    },
    'it': {
        'hub': (['Strumenti gratuiti.', 'Niente abbonamenti.', 'Nessuna registrazione richiesta.', 'Per sempre.'], 'Open source · I file restano sul tuo dispositivo'),
        'qr': (['QR code statici gratis', 'che non scadono mai.'], 'Registrazione non richiesta · Nessun abbonamento · Nel browser'),
        'nl': ([newsletter, 'Ogni settimana. Gratis.'], 'Una trappola degli abbonamenti spiegata, e come evitarla gratis.'),
    },
}
for lang, c in copy.items():
    og(f'og-hub-{lang}', *c['hub'], art='tools')
    og(f'og-qr-{lang}', *c['qr'], art='qr')
    og(f'og-newsletter-{lang}', *c['nl'], art='tools')

touch = Image.new('RGB', (180, 180), TEAL)
touch.paste(mark(180).convert('RGB'), (0, 0))
touch.save(ROOT / 'public/apple-touch-icon.png', optimize=True)
mark(512).save(ROOT / 'public/logo.png', optimize=True)
mark(32).save(ROOT / 'public/favicon-32.png', optimize=True)
print('assets ok for', brand, '/', newsletter, '/', domain)
