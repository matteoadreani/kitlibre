import { defineConfig } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { generatePages, sitemapXml, robotsTxt, webManifest, redirectsFile, LOGO_SVG } from './scripts/pages';

// Generate the static HTML pages (one per page × language) before Vite resolves its inputs.
const root = import.meta.dirname;
const pages = generatePages();
for (const p of pages) {
  const f = resolve(root, p.file);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, p.html);
}
writeFileSync(resolve(root, 'public/sitemap.xml'), sitemapXml());
writeFileSync(resolve(root, 'public/robots.txt'), robotsTxt());
writeFileSync(resolve(root, 'public/site.webmanifest'), webManifest());
writeFileSync(resolve(root, 'public/_redirects'), redirectsFile());
writeFileSync(resolve(root, 'public/favicon.svg'), LOGO_SVG);

export default defineConfig({
  // The background-remover worker goes to /engine/ so it gets the engine headers (CSP with 'wasm-unsafe-eval', COEP).
  worker: {
    format: 'es',
    rollupOptions: { output: { entryFileNames: 'engine/[name]-[hash].js', chunkFileNames: 'engine/[name]-[hash].js', assetFileNames: 'engine/[name]-[hash][extname]' } },
  },
  build: {
    target: 'es2020',
    rollupOptions: {
      input: Object.fromEntries(pages.map((p) => [p.file.replace(/\/?index\.html$|\.html$/, '') || 'index', resolve(root, p.file)])),
    },
  },
});
