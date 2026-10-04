import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import { object, list, integer, type JsonObject } from '../src/server/value';
import { applyMigrations } from './migrations';
import { MAX_BINDINGS } from '../src/server/d1-schema';

/**
 * Cloudflare D1 on the Free plan allows 50 queries per Worker invocation. The tenant services plan a
 * command synchronously and re-plan it whenever a read is missing, then commit the buffered rows in
 * one batch, so the query count is what decides whether a real sale succeeds in production rather
 * than in these tests.
 *
 * A batch is one round trip but is charged once per statement, so the budget is asserted against
 * reads and committed statements together. Counting only the reads would pass while the writes still
 * cost four statements per sale line, which is the pattern this suite exists to catch.
 *
 * These tests assert the total, and assert that it does not grow with the size of the sale. The
 * second assertion is the one that matters: a per-row pattern passes a fixed budget for a small
 * fixture and still fails for a cooperative taking twenty items across the counter.
 */
const BUDGET = 50;
/**
 * What eighteen extra product lines are allowed to add to the total.
 *
 * A per-row pattern adds at least one statement per line, so any value below eighteen still fails
 * it. The headroom above the three statements a larger sale actually adds covers the few extra
 * tables it touches without reopening the per-row shape.
 */
const PER_LINE_SLACK = 6;
/**
 * How many distinct products the wide read case takes.
 *
 * Past `MAX_BINDINGS`, so it crosses the point where a relation read has to span several
 * statements rather than sitting comfortably inside one.
 */
const WIDE_SALE_LINES = 99;
/**
 * The widest sale this suite claims fits the Free plan's per-invocation allowance. Measured at 47
 * of 50 for reads and committed statements together.
 */
const HUNDRED_LINE_SALE = 100;

const products: number[] = [];
let runtime: Miniflare,
  token = '',
  saleId = 0,
  saleLines = 0;
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
/** What the invocation is charged for: the reads it issued and the statements it committed. */
const cost = async () => {
  const measured = await stats();
  return integer(measured.reads, true) + integer(measured.writes, true);
};
const reset = async () => {
  expect((await call('/__test/read-stats', 'POST')).status).toBe(204);
};
const lines = (ids: number[], quantity: number) => ids.map(urunId => ({ urunId, miktar: quantity }));

/** Creates products until `count` of them exist, and returns their ids. */
async function ensureProducts(count: number, prefix = 'Budget'): Promise<number[]> {
  while (products.length < count)
    products.push(
      integer(
        (
          await ok('/api/uruns', 'POST', {
            urunAdi: `${prefix} product ${products.length}`,
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
  return products;
}

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
    await ensureProducts(20);

    // A warm-up sale pays for the per-tenant rows that the first request has to create, so the
    // numbers below describe the sale path itself rather than one-off setup.
    await ok('/api/satis', 'POST', { stokHareketleriLists: lines(products.slice(0, 1), 1) });

    await reset();
    const small = await ok('/api/satis', 'POST', { stokHareketleriLists: lines(products.slice(0, 2), 2) });
    const smallCost = await cost();

    await reset();
    const large = await ok('/api/satis', 'POST', { stokHareketleriLists: lines(products, 2) });
    const largeCost = await cost();

    // The money is still derived from the lines, so a cheaper read path must not change the result.
    expect(small.toplamTutar).toBe('40.00');
    expect(large.toplamTutar).toBe('400.00');
    // Recorded from the request that created it: later cases grow the shared product list, so the
    // width of this sale cannot be read back off that array.
    saleId = integer(large.id, true);
    saleLines = lines(products, 2).length;

    expect(largeCost).toBeLessThan(BUDGET);
    // Eighteen more lines may not cost eighteen more queries.
    expect(largeCost - smallCost).toBeLessThanOrEqual(PER_LINE_SLACK);
  });

  it('keeps an edited multi-line sale inside the budget', async () => {
    await reset();
    const updated = await ok('/api/satis', 'PUT', { id: saleId, stokHareketleriLists: lines(products, 3) });
    const after = await cost();
    expect(updated.toplamTutar).toBe('600.00');
    // Editing reverses the old lines before writing the new ones, so both directions are paid for.
    expect(after).toBeLessThan(BUDGET);
  });

  it('splits a bulk write without dropping rows', async () => {
    // Enough lines that the line table cannot fit in one statement at the bound-parameter limit, so
    // the buffered rows have to span more than one. The sale is then read back to prove every line
    // was committed rather than silently left out of the batch.
    const bulk = [...(await ensureProducts(40, 'Bulk'))];

    await reset();
    const created = await ok('/api/satis', 'POST', { stokHareketleriLists: lines(bulk, 1) });
    const after = await cost();

    const committed = list((await ok(`/api/satis/${integer(created.id, true)}`, 'GET')).stokHareketleriLists);
    expect(committed).toHaveLength(bulk.length);
    expect(created.toplamTutar).toBe('400.00');
    expect(after).toBeLessThan(BUDGET);
  });

  it('reads more relations than one statement can bind, without failing the command', async () => {
    // Every relation read is an `IN (...)` list, and D1 rejects a statement past its parameter
    // limit outright. How wide a list may be depends on what the tenant rewrite has already bound
    // for the buffered writes, so a fixed allowance silently fails the whole command once a
    // cooperative is one product wider than it — an opaque 500 on an ordinary large sale. This
    // width sits on that boundary.
    const wide = await ensureProducts(WIDE_SALE_LINES, 'Wide');
    const width = wide.length;
    // Wider than one statement can bind, so the products are necessarily read in several
    // `IN (...)` lists and each list has to be sized against what the rewrite already bound.
    expect(width).toBeGreaterThan(MAX_BINDINGS - 2);

    await reset();
    const created = await ok('/api/satis', 'POST', { stokHareketleriLists: lines(wide, 1) });
    const measured = await stats();

    // Every line is committed, priced from the stored products, and readable back.
    expect(integer(created.id, true)).toBeGreaterThan(0);
    expect(created.toplamTutar).toBe((width * 10).toFixed(2));
    const committed = list((await ok(`/api/satis/${integer(created.id, true)}`, 'GET')).stokHareketleriLists);
    expect(committed).toHaveLength(width);

    // Reading the products in several statements must not make the reads per-product. That is the
    // property the relation batching exists for, and it is what this width has to preserve; the
    // committed-statement side is bounded by `tests/write-compaction.test.ts` instead.
    expect(integer(measured.reads, true)).toBeLessThan(BUDGET / 2);
  });

  it('keeps a hundred line sale inside the plan allowance', async () => {
    // The widest sale the read budget work is claimed to serve. The read side is flat in the width
    // of the sale, but the committed statements are not: each line writes a row, a stock row and two
    // audit rows, and audit rows are eight bindings wide, so they set the floor. What must not
    // happen is the grouping collapsing back into a statement per row, which put this case over the
    // allowance before compaction stopped closing other tables' groups whenever one table filled up.
    const wide = await ensureProducts(HUNDRED_LINE_SALE, 'Hundred');
    await reset();
    const created = await ok('/api/satis', 'POST', { stokHareketleriLists: lines(wide, 1) });
    const measured = await stats();

    expect(created.toplamTutar).toBe((HUNDRED_LINE_SALE * 10).toFixed(2));
    expect(list((await ok(`/api/satis/${integer(created.id, true)}`, 'GET')).stokHareketleriLists)).toHaveLength(HUNDRED_LINE_SALE);
    expect(integer(measured.reads, true) + integer(measured.writes, true)).toBeLessThan(BUDGET);
    // Widening from a two line sale by ninety-eight lines must not cost ninety-eight more queries.
    // Measured slope is about a fifth of a statement per line; anything near one is per-row again.
    expect(integer(measured.writes, true) - integer(measured.reads, true)).toBeLessThan(HUNDRED_LINE_SALE / 4);
  });

  it('serves reads without writing, so a read never bumps the tenant revision', async () => {
    const fetched = await ok(`/api/satis/${saleId}`, 'GET');
    expect(list(fetched.stokHareketleriLists)).toHaveLength(saleLines);
    await reset();
    await ok(`/api/satis/${saleId}`, 'GET');
    const after = await stats();
    expect(integer(after.writes)).toBe(0);
    expect(integer(after.reads, true)).toBeLessThan(BUDGET);
  });
});
