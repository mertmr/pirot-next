import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import { object, list, integer, type JsonObject } from '../src/server/value';
import { applyMigrations } from './migrations';

/**
 * Cloudflare D1 on the Free plan allows 50 queries per Worker invocation. The tenant services plan a
 * command synchronously and re-plan it whenever a read is missing, so the query count is what decides
 * whether a real sale succeeds in production rather than in these tests.
 *
 * These tests assert the count itself, and assert that it does not grow with the size of the sale.
 * The second assertion is the one that matters: a per-row read pattern passes a fixed budget for a
 * small fixture and still fails for a cooperative taking twenty items across the counter.
 */
const BUDGET = 50;
/** What one extra product line is allowed to add to the query count. */
const PER_LINE_SLACK = 2;

const products: number[] = [];
let runtime: Miniflare,
  token = '',
  saleId = 0;
const password = 'Synthetic-fixture-password-42';

async function call(path: string, method = 'GET', body?: unknown) {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'accept-language': 'en' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (!['GET', 'HEAD'].includes(method)) headers['idempotency-key'] = crypto.randomUUID();
  return runtime.dispatchFetch(`https://pirot.test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function ok(path: string, method = 'GET', body?: unknown): Promise<JsonObject> {
  const r = await call(path, method, body);
  const data = await r.json();
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${JSON.stringify(data)}`);
  return object(data);
}
const stats = async () => object(await (await call('/__test/read-stats')).json());
const reset = async () => {
  expect((await call('/__test/read-stats', 'POST')).status).toBe(204);
};
const lines = (ids: number[], quantity: number) => ids.map(urunId => ({ urunId, miktar: quantity }));

beforeAll(async () => {
  const bundled = await build({
    entryPoints: ['tests/worker.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    external: ['cloudflare:workers', 'node:*'],
    conditions: ['workerd', 'worker', 'browser'],
  });
  runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: bundled.outputFiles[0].text,
      compatibilityDate: '2026-10-01',
      compatibilityFlags: ['nodejs_compat'],
      durableObjects: {
        TENANTS: { className: 'CooperativeTenant', useSQLite: true },
        PASSWORDS: { className: 'PasswordHasher', useSQLite: true },
        DELIVERY: { className: 'JobDelivery', useSQLite: true },
      },
      d1Databases: ['DIRECTORY'],
      bindings: {
        AUTH_SECRET: 'synthetic-test-secret-with-at-least-32-characters',
        BOOTSTRAP_SECRET: 'synthetic-bootstrap-secret',
        ENVIRONMENT: 'development',
        PUBLIC_URL: 'https://pirot.test',
        EMAIL_FROM: 'pirot@example.invalid',
      },
    }),
  );
  await applyMigrations(await runtime.getD1Database('DIRECTORY'));
  const bootstrap = await runtime.dispatchFetch('https://pirot.test/api/internal/bootstrap', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-bootstrap-secret': 'synthetic-bootstrap-secret' },
    body: JSON.stringify({
      login: 'fixture-admin',
      email: 'admin@example.invalid',
      password,
      tenantId: 1,
      tenantName: 'Synthetic admin cooperative',
    }),
  });
  expect(bootstrap.status).toBe(201);
  token = String((await ok('/api/authenticate', 'POST', { username: 'fixture-admin', password })).id_token);
  await ok('/api/kasa-hareketleris', 'POST', { kasaMiktar: '100000.00', hareket: 'Synthetic opening balance' });
});
afterAll(async () => {
  await runtime?.dispose();
});

describe('D1 query budget', () => {
  it('keeps a multi-line sale well inside the budget and flat as the sale grows', async () => {
    for (let i = 0; i < 20; i++)
      products.push(
        integer(
          (
            await ok('/api/uruns', 'POST', {
              urunAdi: `Budget product ${i}`,
              birim: 'ADET',
              stok: '1000',
              stokSiniri: '0',
              musteriFiyati: '10.00',
              active: true,
              satista: true,
            })
          ).id,
          true,
        ),
      );

    // A warm-up sale pays for the per-tenant rows that the first request has to create, so the
    // numbers below describe the sale path itself rather than one-off setup.
    await ok('/api/satis', 'POST', { stokHareketleriLists: lines(products.slice(0, 1), 1) });

    await reset();
    const small = await ok('/api/satis', 'POST', { stokHareketleriLists: lines(products.slice(0, 2), 2) });
    const smallStats = await stats();

    await reset();
    const large = await ok('/api/satis', 'POST', { stokHareketleriLists: lines(products, 2) });
    const largeStats = await stats();

    // The money is still derived from the lines, so a cheaper read path must not change the result.
    expect(small.toplamTutar).toBe('40.00');
    expect(large.toplamTutar).toBe('400.00');
    saleId = integer(large.id, true);

    expect(integer(largeStats.reads, true)).toBeLessThan(BUDGET);
    // Eighteen more lines may not cost eighteen more queries.
    expect(integer(largeStats.reads, true) - integer(smallStats.reads, true)).toBeLessThanOrEqual(PER_LINE_SLACK);
  });

  it('keeps an edited multi-line sale inside the budget', async () => {
    await reset();
    const updated = await ok('/api/satis', 'PUT', { id: saleId, stokHareketleriLists: lines(products, 3) });
    const after = await stats();
    expect(updated.toplamTutar).toBe('600.00');
    expect(integer(after.reads, true)).toBeLessThan(BUDGET);
  });

  it('serves reads without writing, so a read never bumps the tenant revision', async () => {
    const fetched = await ok(`/api/satis/${saleId}`, 'GET');
    expect(list(fetched.stokHareketleriLists)).toHaveLength(products.length);
    await reset();
    await ok(`/api/satis/${saleId}`, 'GET');
    const after = await stats();
    expect(integer(after.writes)).toBe(0);
    expect(integer(after.reads, true)).toBeLessThan(BUDGET);
  });
});
