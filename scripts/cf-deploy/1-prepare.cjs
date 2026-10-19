// Prepares a Cloudflare Pages Direct Upload from dist/:
//   node scripts/cf-deploy/1-prepare.cjs <project-name> <branch> [--production]
// <branch> is required. A branch other than the project's production branch gives a preview deployment
// (https://<branch>.<project>.pages.dev). Deploying "main" (production) also needs --production, so a preview
// can never reach kitlibre.com by accident.
// Writes .deploy/assets.json (for 2-upload-assets.cjs) and .deploy/create-deployment.js (code for the Cloudflare API connector).
const fs = require('fs'), path = require('path');
const { blake3 } = require('@noble/hashes/blake3.js');
const ROOT = path.resolve(__dirname, '../..'), DIST = path.join(ROOT, 'dist'), OUT = path.join(ROOT, '.deploy');
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const PROJECT = args[0] || 'kitlibre';
const BRANCH = args[1];
const PROD = process.argv.includes('--production');
if (!BRANCH || !/^[A-Za-z0-9._\/-]+$/.test(BRANCH)) { console.error('usage: 1-prepare.cjs <project> <branch> [--production]'); process.exit(1); }
if ((BRANCH === 'main' || BRANCH === 'production') !== PROD) {
  console.error(PROD ? `--production given but branch "${BRANCH}" is not main` : `branch "${BRANCH}" is production: add --production to deploy kitlibre.com on purpose`);
  process.exit(1);
}
const M = { html: 'text/html', js: 'application/javascript', css: 'text/css', svg: 'image/svg+xml', png: 'image/png', xml: 'application/xml', txt: 'text/plain', webmanifest: 'application/manifest+json', json: 'application/json', mjs: 'application/javascript', wasm: 'application/wasm', bin: 'application/octet-stream', jpg: 'image/jpeg', ico: 'image/x-icon' };
const files = [];
(function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p) : files.push(p); } })(DIST);
const assets = [], manifest = {}, special = {};
for (const f of files) {
  const rel = '/' + path.relative(DIST, f).split(path.sep).join('/');
  if (rel === '/_headers' || rel === '/_redirects') { special[rel.slice(1)] = fs.readFileSync(f, 'utf8'); continue; }
  const b64 = fs.readFileSync(f).toString('base64');
  const ext = path.extname(f).slice(1);
  const hash = Buffer.from(blake3(Buffer.from(b64 + ext))).toString('hex').slice(0, 32); // same scheme as wrangler
  manifest[rel] = hash;
  assets.push({ key: hash, value: b64, metadata: { contentType: M[ext] || 'application/octet-stream' }, base64: true });
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'assets.json'), JSON.stringify(assets));
const code = `async () => {
  const manifest = ${JSON.stringify(manifest)};
  const special = ${JSON.stringify(special)};
  const b = 'KitBoundary' + Date.now();
  const part = (name, value, type, filename) => ['--' + b, 'Content-Disposition: form-data; name="' + name + '"' + (filename ? '; filename="' + filename + '"' : ''), ...(type ? ['Content-Type: ' + type] : []), '', value].join('\\r\\n');
  const parts = [part('manifest', JSON.stringify(manifest)), part('branch', ${JSON.stringify(BRANCH)}), part('commit_message', ${JSON.stringify('Kitlibre deploy (' + BRANCH + ')')}), part('commit_dirty', 'true')];
  for (const [name, value] of Object.entries(special)) parts.push(part(name, value, 'text/plain', name));
  const body = [...parts, '--' + b + '--', ''].join('\\r\\n');
  const dep = await cloudflare.request({ method: 'POST', path: '/accounts/' + accountId + '/pages/projects/${PROJECT}/deployments', body, contentType: 'multipart/form-data; boundary=' + b, rawBody: true });
  return { branch: ${JSON.stringify(BRANCH)}, success: dep.success, errors: dep.errors, id: dep.result?.id, url: dep.result?.url, stage: dep.result?.latest_stage, env: dep.result?.environment };
}`;
fs.writeFileSync(path.join(OUT, 'create-deployment.js'), code);
console.log(`${assets.length} assets, special files: ${Object.keys(special).join(', ')}, project ${PROJECT}, branch ${BRANCH}${PROD ? ' (PRODUCTION)' : ' (preview)'}`);
