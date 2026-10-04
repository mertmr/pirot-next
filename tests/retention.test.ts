import { test, expect } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';

import { applyMigrations } from './migrations';

/**
 * Retention pruning must delete only what has genuinely expired. The failure that
 * matters most is dropping a job that has not been delivered yet, so every pending
 * row is asserted to survive regardless of age.
 *
 * Every cooperative is pruned on its own pass, so this asserts the time window and
 * that no tenant is skipped, rather than a cross-tenant effect the function cannot have.
 */
test('retention pruning removes expired idempotency and delivered jobs only, per tenant', async () => {
  const script = await build({
    entryPoints: ['tests/worker.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    external: ['cloudflare:workers', 'node:*'],
    conditions: ['workerd', 'worker', 'browser'],
  });
  const runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: script.outputFiles[0].text,
      compatibilityDate: '2026-10-01',
      compatibilityFlags: ['nodejs_compat'],
      durableObjects: {
        TENANTS: { className: 'CooperativeTenant', useSQLite: true },
        PASSWORDS: { className: 'PasswordHasher', useSQLite: true },
        DELIVERY: { className: 'JobDelivery', useSQLite: true },
      },
      d1Databases: ['DIRECTORY'],
      bindings: {
        AUTH_SECRET: 'synthetic-secret-at-least-thirty-two-characters',
        ENVIRONMENT: 'development',
        PUBLIC_URL: 'https://fixture.test',
      },
    }),
  );
  try {
    const db = await runtime.getD1Database('DIRECTORY');
    await applyMigrations(db);
    await db.prepare("INSERT INTO tenants(id,tenant_name) VALUES (1,'Retention one'),(2,'Retention two')").run();

    const NOW = '2026-10-31T12:00:00.000Z';
    const payload = JSON.stringify({ type: 'stock-report' });
    for (const [tenant, key, created] of [
      // 25 October is past the one-day idempotency window; 31 October is inside it.
      [1, 'expired', '2026-10-25T00:00:00.000Z'],
      [1, 'current', '2026-10-31T11:00:00.000Z'],
      [2, 'expired', '2026-10-25T00:00:00.000Z'],
      [2, 'current', '2026-10-31T11:00:00.000Z'],
    ] as [number, string, string][])
      await db
        .prepare('INSERT INTO business_idempotency(tenant_id,key,fingerprint,response,created_at) VALUES (?,?,?,?,?)')
        .bind(tenant, key, 'fp', '{}', created)
        .run();

    for (const [tenant, id, created, delivered] of [
      // 1 October is past both windows; 31 October is inside both.
      [1, 'delivered-expired', '2026-10-01T00:00:00.000Z', '2026-10-01T00:05:00.000Z'],
      [1, 'pending-expired', '2026-10-01T00:00:00.000Z', null],
      [1, 'delivered-current', '2026-10-31T11:00:00.000Z', '2026-10-31T11:05:00.000Z'],
      [2, 'pending-expired', '2026-10-01T00:00:00.000Z', null],
      [2, 'delivered-expired', '2026-10-01T00:00:00.000Z', '2026-10-01T00:05:00.000Z'],
    ] as [number, string, string, string | null][])
      await db
        .prepare('INSERT INTO business_outbox(tenant_id,id,payload,created_at,delivered_at) VALUES (?,?,?,?,?)')
        .bind(tenant, id, payload, created, delivered)
        .run();

    const keys = async () =>
      (await db.prepare('SELECT tenant_id,key FROM business_idempotency').all<{ tenant_id: number; key: string }>()).results
        .map(r => `${r.tenant_id}/${r.key}`)
        .sort();
    const jobs = async () =>
      (await db.prepare('SELECT tenant_id,id FROM business_outbox').all<{ tenant_id: number; id: string }>()).results
        .map(r => `${r.tenant_id}/${r.id}`)
        .sort();

    // The financial audit trail is seeded before pruning, and is far older than any window.
    await db
      .prepare(
        'INSERT INTO business_history(tenant_id,id,kind,entity_id,actor,operation,before_json,after_json,at) VALUES (?,?,?,?,?,?,?,?,?)',
      )
      .bind(1, 1, 'uruns', 1, 'fixture', 'CREATE', null, null, '2026-01-01T00:00:00.000Z')
      .run();
    await db
      .prepare(
        'INSERT INTO business_history(tenant_id,id,kind,entity_id,actor,operation,before_json,after_json,at) VALUES (?,?,?,?,?,?,?,?,?)',
      )
      .bind(2, 1, 'uruns', 1, 'fixture', 'CREATE', null, null, '2026-01-01T00:00:00.000Z')
      .run();

    expect(await keys()).toEqual(['1/current', '1/expired', '2/current', '2/expired']);

    const pruned = await runtime.dispatchFetch('https://fixture.test/__test/prune', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ now: NOW }),
    });
    expect(pruned.status).toBe(204);

    // Only the keys outside the retry window go, in every tenant.
    expect(await keys()).toEqual(['1/current', '2/current']);
    // A delivered job expires, an undelivered job never does, however old it is.
    expect(await jobs()).toEqual(['1/delivered-current', '1/pending-expired', '2/pending-expired']);

    // The financial audit trail is never pruned, however old the row is.
    const history = async () =>
      (await db.prepare('SELECT tenant_id,id FROM business_history').all<{ tenant_id: number; id: number }>()).results
        .map(r => `${r.tenant_id}/${r.id}`)
        .sort();
    expect(await history()).toEqual(['1/1', '2/1']);
  } finally {
    await runtime.dispose();
  }
}, 60000);
