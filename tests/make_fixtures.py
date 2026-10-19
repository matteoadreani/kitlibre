"""Creates realistic sample images (photos / screenshots) of QR codes for the trap-checker tests.
Clean codes are rendered with the same `qrcode` library, then degraded with Pillow (rotation, perspective,
blur, noise, JPEG compression, busy backgrounds). Output: tests/fixtures/*.{png,jpg} + manifest.json"""
import json, random, subprocess
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'tests/fixtures'
random.seed(7)
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'

SAMPLES = [
    # name, content, expected verdict, style
    ('qrco-de-photo', 'https://qrco.de/bf4Y2u', 'dynamic', 'photo'),
    ('lead-me-screenshot', 'https://l.ead.me/bbLviR', 'dynamic', 'screenshot'),
    ('me-qr-photo', 'https://me-qr.com/cqMeW6cf', 'dynamic', 'photo'),
    ('qrfy-screenshot', 'https://qrfy.io/UJaRm-kJdH', 'dynamic', 'screenshot'),
    ('qr-codes-io-photo', 'http://qr-codes.io/1tTjBstLWTE', 'dynamic', 'photo'),
    ('bitly-photo', 'https://bit.ly/3MqL8sO', 'shortener', 'photo'),
    ('goo-gl-screenshot', 'https://goo.gl/maps/Xy12AbCd', 'discontinued', 'screenshot'),
    ('static-url-photo', 'https://www.trattoria-esempio.it/menu?lang=it', 'static', 'photo'),
    ('static-wifi-screenshot', 'WIFI:T:WPA;S:Trattoria Guest;P:benvenuti2026;;', 'not-url', 'screenshot'),
]

def clean_png(text, path):
    js = "require('qrcode').toFile(process.argv[2], process.argv[1], {errorCorrectionLevel:'M', margin:4, width:420}, e=>{if(e){console.error(e);process.exit(1)}})"
    subprocess.check_call(['node', '-e', js, text, str(path)], cwd=ROOT)

def busy_bg(w, h):
    bg = Image.new('RGB', (w, h), (random.randint(150, 200),) * 3)
    d = ImageDraw.Draw(bg)
    for _ in range(60):
        x, y = random.randint(0, w), random.randint(0, h)
        c = tuple(random.randint(90, 230) for _ in range(3))
        d.ellipse([x, y, x + random.randint(20, 160), y + random.randint(20, 160)], fill=c)
    return bg.filter(ImageFilter.GaussianBlur(6))

def photo(qr):
    qr = qr.convert('RGB')
    # warm, slightly dim "paper" + perspective
    qr = Image.eval(qr, lambda v: int(40 + v * 0.75))
    w, h = qr.size
    dx = int(w * 0.08)
    coeffs = find_coeffs([(0, 0), (w, 0), (w, h), (0, h)], [(dx, 0), (w - dx // 3, dx // 2), (w, h), (0, h - dx // 2)])
    qr = qr.transform((w, h), Image.PERSPECTIVE, coeffs, Image.BICUBIC, fillcolor=(170, 170, 170))
    qr = qr.rotate(random.uniform(6, 14), expand=True, fillcolor=(170, 170, 170), resample=Image.BICUBIC)
    bg = busy_bg(1400, 1050)
    bg.paste(qr, (random.randint(250, 600), random.randint(150, 450)))
    bg = bg.filter(ImageFilter.GaussianBlur(1.2))
    px = bg.load()
    for _ in range(40000):
        x, y = random.randrange(bg.width), random.randrange(bg.height)
        r, g, b = px[x, y]
        n = random.randint(-25, 25)
        px[x, y] = (max(0, min(255, r + n)), max(0, min(255, g + n)), max(0, min(255, b + n)))
    return bg

def screenshot(qr, text):
    sc = Image.new('RGB', (1170, 2532), (250, 250, 252))
    d = ImageDraw.Draw(sc)
    d.rectangle([0, 0, 1170, 140], fill=(20, 20, 30))
    d.text((60, 50), '9:41', font=ImageFont.truetype(FONT, 44), fill='white')
    d.text((60, 260), 'Scan to view our menu', font=ImageFont.truetype(FONT, 64), fill=(30, 30, 40))
    for i in range(6):
        d.rounded_rectangle([60, 1500 + i * 150, 1110, 1610 + i * 150], 20, fill=(235, 236, 240))
    sc.paste(qr.resize((640, 640), Image.NEAREST), (265, 520))
    return sc

def find_coeffs(pa, pb):
    import numpy as np
    m = []
    for p1, p2 in zip(pa, pb):
        m.append([p1[0], p1[1], 1, 0, 0, 0, -p2[0] * p1[0], -p2[0] * p1[1]])
        m.append([0, 0, 0, p1[0], p1[1], 1, -p2[1] * p1[0], -p2[1] * p1[1]])
    A = np.matrix(m, dtype=float)
    B = np.array(pb).reshape(8)
    res = np.dot(np.linalg.inv(A.T * A) * A.T, B)
    return np.array(res).reshape(8)

manifest = []
tmp = OUT / '_clean.png'
for name, text, verdict, style in SAMPLES:
    clean_png(text, tmp)
    qr = Image.open(tmp)
    if style == 'photo':
        img, fn = photo(qr), f'{name}.jpg'
        img.save(OUT / fn, quality=72)
    else:
        img, fn = screenshot(qr.convert('RGB'), text), f'{name}.png'
        img.save(OUT / fn)
    manifest.append({'file': fn, 'content': text, 'verdict': verdict})
tmp.unlink()
(OUT / 'manifest.json').write_text(json.dumps(manifest, indent=2))
print(f'{len(manifest)} fixtures written')
