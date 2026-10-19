# Kitlibre — Free tools. No subscription. No signup required. Forever.

**Live: https://kitlibre.com** (English) · https://kitlibre.com/it/ (Italiano)

Kitlibre is a growing hub of small, free, open-source web tools that replace paid SaaS for everyday jobs.
No account, no trial that expires, no paywall in front of the basics, and your files never leave your device.

## Tools

- **Static QR generator** (`/qr/` · `/it/qr/`): URL (with optional UTM builder), text, Wi-Fi, contact (vCard 3.0),
  email, phone, SMS. Colours, PNG size, error-correction level, quiet zone, optional centre logo. Download **PNG** and **SVG**.
  The encoded data *is* the final content: no redirect, so the codes never expire.
- **QR trap checker** (`/qr/check/` · `/it/qr/verifica/`): drop or paste a photo or screenshot (or use the camera).
  The code is decoded in the browser and checked against a curated list of dynamic-QR redirect domains (qrco.de, l.ead.me,
  q-r.to, me-qr.com, qrfy.io, scnv.io, qrs.ly, qr1.be, …), link shorteners (bit.ly, tinyurl, …) and discontinued services
  (goo.gl, page.link). It explains the risk and offers to create a static replacement.
- Coming soon: social image resizer, link preview checker, email signature generator, image compressor/converter,
  post character counter.

Newsletter: **SaaS Trap of the Week** (`/newsletter/`; saastrap.com redirects there). It is optional and never required
to use the tools. Signup goes to MailerLite with double opt-in (see below).

## Privacy

- 100 % client-side: QR codes, logos, Wi-Fi passwords and checked images are processed **in your browser** and never uploaded.
- No backend, no cookies, no analytics, no third-party scripts: every library is bundled locally and a strict CSP
  (`public/_headers`) blocks external scripts, fonts and CDNs.
- The only third-party request is the optional newsletter signup: on submit, the browser posts **just the email address**
  to MailerLite's public embedded-form endpoint (`SITE.newsletterFormAction` in `src/config.ts`; no API key, no MailerLite
  script, `credentials: 'omit'`). Double opt-in is on, so nobody is added until they confirm by email. A hidden honeypot
  field drops naive bots. The CSP allows `connect-src` / `form-action` only to `https://assets.mailerlite.com`.
- The checker never opens the decoded link; it only compares the domain against the list in `src/domains.ts`.

## Quick start

```bash
npm install
npm run dev            # local dev server
npm test               # unit tests
npm run build          # type-check + production build to dist/
npm run test:e2e       # end-to-end tests in headless Chrome against dist/ (needs a prior build)
```

## Contributing

Issues and pull requests are welcome, especially new dynamic-QR / shortener domains for `src/domains.ts`
(please include a source) and translations. Please run `npm test`, `npm run build` and `npm run test:e2e` before opening a PR.

## Routes

EN / IT: hub `/` · `/it/`, generator `/qr/` · `/it/qr/`, checker `/qr/check/` · `/it/qr/verifica/`,
newsletter `/newsletter/` · `/it/newsletter/`, privacy `/privacy/` · `/it/privacy/`, 404.
Old preview paths (`/check/`, `/it/verifica/`) 301-redirect via the generated `_redirects`.

## Renaming the brand

Everything reads from **`src/config.ts`** (`BRAND_NAME`, `SITE.url`, `SITE.newsletter`, `SITE.repoUrl`). After renaming, run
`npm run assets` to regenerate logo, touch icon and OG images (favicon.svg is generated at build time), then `npm run build`.
Set `KIT_SITE_URL=https://your-domain` at build time (or edit `SITE.url`) for canonical URLs, OG tags and the sitemap.

## Stack

Vite + vanilla TypeScript, static output in `dist/`. HTML for every page × language is generated at build time
by `scripts/pages.ts` (good SEO: titles, meta, canonical, hreflang, Open Graph, JSON-LD `WebApplication`,
`FAQPage`, `BreadcrumbList`, `sitemap.xml`, `robots.txt`).

| Runtime dependency | Licence | Use |
| --- | --- | --- |
| [qrcode](https://github.com/soldair/node-qrcode) | MIT | QR matrix encoding |
| [jsQR](https://github.com/cozmo/jsQR) | Apache-2.0 | QR decoding (fallback when the native `BarcodeDetector` is missing) |

Everything is bundled locally — no CDN. Dev-only: vite, typescript, vitest (MIT), puppeteer-core (Apache-2.0), pngjs (MIT).

## Commands

```bash
npm install
npm run dev            # local dev server
npm run build          # type-check + production build to dist/
npm run build:preview  # same, with noindex (robots + meta) for preview deployments (production build is indexable)
npm test               # unit tests: payload builders, generate→render→decode round-trips (matrix + SVG), classifier
npm run test:e2e       # headless Chrome on dist/: every QR type → PNG & SVG decode back, logo, downloads,
                       # newsletter signup (MailerLite mocked: success/errors/honeypot), trap checker on sample photos/screenshots (EN+IT), SEO/a11y/mobile/CSP checks
npm run fixtures       # regenerate sample images in tests/fixtures (Python + Pillow + numpy)
```

`test:e2e` needs Chrome/Chromium (`CHROME_PATH`, default `/usr/bin/google-chrome`) and a prior build.

## Project layout

```
src/config.ts      brand + site settings (single place to rename)
src/i18n.ts        all copy, EN + IT; routes for the language switch
src/payload.ts     form data → exact QR text (Wi-Fi/vCard escaping, UTM, mailto, tel, SMSTO)
src/render.ts      matrix, SVG and canvas renderers, logo hole, contrast check
src/domains.ts     known dynamic-QR / shortener / discontinued redirect domains (with sources)
src/classify.ts    decoded text → verdict (dynamic, shortener, discontinued, static, maybe-short, not-url)
src/decode.ts      multi-scale jsQR decoding + BarcodeDetector
src/generator.ts   generator UI      src/checker.ts   checker UI (file, drag&drop, paste, camera)
src/newsletter.ts  newsletter signup → MailerLite embedded-form endpoint (loading, success, errors, honeypot)
scripts/pages.ts   build-time HTML, sitemap, robots, manifest
public/_headers    CSP & security headers (Cloudflare Pages format)
```

## TODO

- Keep `src/domains.ts` updated (PRs welcome — please include a source).
- Possible extras: more locales, batch generation, print-ready PDF, EPS export.

## Licence

MIT © 2026 Matteo Adreani — see [LICENSE](LICENSE). Third-party libraries keep their own licences (table above).

## Deployment (Cloudflare Pages, Direct Upload)

Production: Pages project **`kitlibre`** → https://kitlibre.com (custom domains `kitlibre.com` + `www.kitlibre.com`,
proxied CNAMEs to `kitlibre.pages.dev`; a Single Redirect rule in the kitlibre.com zone sends `www` → apex with 301).
`saastrap.com` / `www.saastrap.com`: proxied placeholder A records (192.0.2.1) + a redirect rule (302) to
https://kitlibre.com/newsletter/.

Deploying a new version (helpers in `scripts/cf-deploy/`; no credentials are stored in this repo):

1. `npm run build` then `node scripts/cf-deploy/1-prepare.cjs kitlibre` → hashes `dist/` (blake3 of base64+extension,
   like wrangler) into `.deploy/assets.json` and writes `.deploy/create-deployment.js` (manifest + `_headers` + `_redirects`).
   `.deploy/` is git-ignored.
2. `GET /accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/kitlibre/upload-token` → short-lived, project-scoped JWT saved to a
   temporary file **outside the repo**; `node scripts/cf-deploy/2-upload-assets.cjs <file>` → `check-missing`, `upload`,
   `upsert-hashes`; then delete the file.
3. Run `.deploy/create-deployment.js` with an authenticated Cloudflare API client (`POST …/pages/projects/kitlibre/deployments`).

Simpler alternative: `CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… npx wrangler pages deploy dist --project-name kitlibre --branch main`
(set the variables in your shell or CI secrets, never in a committed file).
`npm run test:live` smoke-tests https://kitlibre.com.
