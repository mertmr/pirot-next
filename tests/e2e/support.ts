import { readFileSync } from 'node:fs';

/**
 * Single source for the synthetic local-only developer credential.
 * Mirrors scripts/local-seed.mjs and tests/browser/helpers.ts; the disposable
 * e2e database is wiped by scripts/browser-server.mjs on every run, so this
 * default never touches real data.
 */
export const DEVELOPER_USERNAME = 'developer';
export const DEVELOPER_PASSWORD = process.env.PIROT_DEV_PASSWORD ?? 'Synthetic-local-password-42';
export const SYNTHETIC_PRODUCT = 'Synthetic e2e product';

/** Robust .dev.vars reader shared by the e2e suite (see scripts/local-seed.mjs for the seed side). */
export function readDevVars(path = '.dev.vars'): Record<string, string> {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`Missing ${path}; run bun run local:setup first`);
  }
  const vars: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '').trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))))
      value = value.slice(1, -1);
    if (key) vars[key] = value;
  }
  return vars;
}

export function getBootstrapSecret(): string {
  const secret = readDevVars().BOOTSTRAP_SECRET;
  if (!secret) throw new Error('BOOTSTRAP_SECRET is missing from .dev.vars; run bun run local:setup');
  return secret;
}

/**
 * Joins a runner base URL (URL.href always ends in '/' for origin-only URLs)
 * with an API path. A naive template would produce '//api/...', which the dev
 * server answers with the SPA fallback instead of the API.
 */
export function apiUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

/**
 * Seeds the disposable e2e tenant (wiped on every run) with the same minimal
 * fixtures as scripts/local-seed.mjs so the smoke test can assert real data.
 */
export async function ensureE2EFixtures(baseUrl: string, token: string): Promise<void> {
  const call = async (path: string, body: unknown) => {
    const response = await fetch(apiUrl(baseUrl, path), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'idempotency-key': `e2e-fixture:${path}:${crypto.randomUUID()}`,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
  };
  await call('/api/kasa-hareketleris', { kasaMiktar: '100.00', hareket: 'Synthetic e2e opening balance' });
  await call('/api/uruns', {
    urunAdi: SYNTHETIC_PRODUCT,
    birim: 'ADET',
    stok: '100',
    stokSiniri: '5',
    musteriFiyati: '10.00',
    active: true,
    satista: true,
  });
  await call('/api/kisilers', { kisiAdi: 'Synthetic e2e member', active: true });
}
