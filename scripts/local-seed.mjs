import { readFileSync } from 'node:fs';
// Keep in sync with tests/e2e/support.ts readDevVars: tolerates CRLF,
// comments, blank lines and quoted values instead of naive split('=').
const vars = Object.fromEntries(
  (() => {
    let text;
    try {
      text = readFileSync('.dev.vars', 'utf8');
    } catch {
      throw new Error('Missing .dev.vars; run bun run local:setup first');
    }
    return text
      .split('\n')
      .map(line => line.replace(/\r$/, '').trim())
      .filter(line => line && !line.startsWith('#'))
      .flatMap(line => {
        const i = line.indexOf('=');
        if (i <= 0) return [];
        const key = line.slice(0, i).trim();
        let value = line.slice(i + 1).trim();
        if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))))
          value = value.slice(1, -1);
        return key ? [[key, value]] : [];
      });
  })(),
);
const base = process.env.PIROT_LOCAL_URL ?? 'http://localhost:9070';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Local seed accepts only localhost.');
const login = 'developer',
  password = process.env.PIROT_DEV_PASSWORD ?? 'Synthetic-local-password-42';
let response = await fetch(`${base}/api/internal/bootstrap`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-bootstrap-secret': vars.BOOTSTRAP_SECRET },
  body: JSON.stringify({ login, email: 'developer@example.invalid', password, tenantId: 1, tenantName: 'Local synthetic cooperative' }),
});
if (!response.ok && response.status !== 409) throw new Error(`Bootstrap failed: ${response.status} ${await response.text()}`);
response = await fetch(`${base}/api/authenticate`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: login, password }),
});
if (!response.ok) throw new Error(`Synthetic login failed: ${response.status}`);
const { id_token: token } = await response.json();
const call = async (path, body) => {
  const r = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'idempotency-key': `local-fixture:${path}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r.json();
};
await call('/api/kasa-hareketleris', { kasaMiktar: '100.00', hareket: 'Synthetic local opening balance' });
await call('/api/uruns', {
  urunAdi: 'Synthetic local product',
  birim: 'ADET',
  stok: '100',
  stokSiniri: '5',
  musteriFiyati: '10.00',
  active: true,
  satista: true,
});
await call('/api/kisilers', { kisiAdi: 'Synthetic member', active: true });
console.log(
  `Local synthetic fixtures ready. Login: ${login}. Password uses PIROT_DEV_PASSWORD or the documented synthetic development default.`,
);
