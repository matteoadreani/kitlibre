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
  for (let i = 0; i < todo.length; i += 10) {
    const up = await api('/pages/assets/upload', todo.slice(i, i + 10));
    if (!up.json?.success) return console.log('upload failed', up.status, JSON.stringify(up.json?.errors));
  }
  const ups = await api('/pages/assets/upsert-hashes', { hashes });
  console.log('missing', missing.size, 'uploaded', todo.length, 'of', assets.length, 'upsert', ups.json?.success);
})();
