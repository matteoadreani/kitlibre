// Uploads .deploy/assets.json to the Pages asset store: node scripts/cf-deploy/2-upload-assets.cjs <file containing "jwt": "...">
// The JWT comes from GET /accounts/{id}/pages/projects/{project}/upload-token (short-lived, project-scoped).
const fs = require('fs'), path = require('path');
const raw = fs.readFileSync(process.argv[2], 'utf8');
const m = raw.match(/"jwt":\s*"([^"]+)"/); if (!m) { console.log('no jwt in file'); process.exit(1); }
const jwt = m[1];
const assets = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../.deploy/assets.json'), 'utf8'));
const api = (p, body) => fetch('https://api.cloudflare.com/client/v4' + p, { method: 'POST', headers: { Authorization: 'Bearer ' + jwt, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
(async () => {
  const hashes = assets.map((a) => a.key);
  const miss = await api('/pages/assets/check-missing', { hashes });
  if (!miss.json?.success) return console.log('check-missing failed', miss.status, JSON.stringify(miss.json?.errors));
  const missing = new Set(miss.json.result);
  const todo = assets.filter((a) => missing.has(a.key));
  // Batches by size like wrangler (≤ 40 MiB of base64 and ≤ 1000 files per request); a model part of
  // 20 MiB (≈ 27 MiB base64) goes alone.
  const MAX = 40 * 1024 * 1024, batches = [];
  let cur = [], size = 0;
  for (const a of todo) {
    if (cur.length && (size + a.value.length > MAX || cur.length >= 1000)) { batches.push(cur); cur = []; size = 0; }
    cur.push(a); size += a.value.length;
  }
  if (cur.length) batches.push(cur);
  for (const [i, batch] of batches.entries()) {
    let up;
    for (let attempt = 1; attempt <= 3; attempt++) {
      up = await api('/pages/assets/upload', batch);
      if (up.json?.success) break;
      console.log(`batch ${i + 1}/${batches.length} attempt ${attempt} failed`, up.status, JSON.stringify(up.json?.errors));
    }
    if (!up.json?.success) return;
    console.log(`batch ${i + 1}/${batches.length}: ${batch.length} files, ${(batch.reduce((s, a) => s + a.value.length, 0) / 1048576).toFixed(1)} MiB`);
  }
  const ups = await api('/pages/assets/upsert-hashes', { hashes });
  console.log('missing', missing.size, 'uploaded', todo.length, 'of', assets.length, 'upsert', ups.json?.success);
})();
