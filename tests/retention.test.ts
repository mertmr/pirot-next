import { test, expect } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';

import { applyMigrations } from './migrations';
import { pruneTenantRetention } from '../src/server/jobs';
import type { Env } from '../src/server/env';

/**
 * Retention pruning must delete only what has genuinely expired. The failure that matters most is
 * dropping a job that has not been delivered yet, so every pending row is asserted to survive
 * regardless of age, and the financial audit trail is asserted never to be touched.
 *
 * Its cost matters just as much. This runs from the same cron as the outbox drain, on the Free plan's
 * per-invocation query allowance, so a pass that scales with the number of cooperatives would exhaust
 * that allowance on a deployment with a few dozen of them however little it had to delete. The cost
 * of a pass is therefore asserted to be independent of the tenant count.
 */

const NOW = Date.parse('2026-10-31T12:00:00.000Z');
const OLD = '2026-01-01T00:00:00.000Z';
const RECENT = '2026-10-31T11:00:00.000Z';

/** Counts what a pass costs against D1, which is what the per-invocation allowance is charged on. */
function counted(directory: D1Database) {
  const tally = { statements: 0, reads: 0 };
  const countedStatement = <T extends object>(statement: T): T =>
    new Proxy(statement, {
      get(target, property) {
        const value = (target as Record<string, unknown>)[property as string];
        if (typeof value !== 'function') return value;
        return (...args: unknown[]) => {
          if (['all', 'first', 'run', 'raw'].includes(property as string)) tally.statements++;
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    }) as T;
  const env = {
    DIRECTORY: new Proxy(directory, {
      get(target, property) {
        if (property === 'batch')
          return (statements: unknown[]) => {
            tally.statements += statements.length;
            return (target.batch as (s: unknown[]) => unknown)(statements);
          };
        if (property === 'prepare') return (sql: string) => countedStatement((target.prepare as (s: string) => object)(sql));
        const value = (target as unknown as Record<string, unknown>)[property as string];
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }),
  } as unknown as Env;
  return { env, tally };
}

async function runtime() {
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
  const miniflare = new Miniflare(
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
  const db = await miniflare.getD1Database('DIRECTORY');
  await applyMigrations(db);
  return { miniflare, db };
}

test('retention pruning removes expired idempotency and delivered jobs only', async () => {
  const { miniflare, db } = await runtime();
  try {
    await db.prepare("INSERT INTO tenants(id,tenant_name) VALUES (1,'Retention one'),(2,'Retention two')").run();

    const payload = JSON.stringify({ type: 'stock-report' });
    for (const [tenant, key, created] of [
      // 25 October is past the one-day idempotency window; 31 October is inside it.
      [1, 'expired', '2026-10-25T00:00:00.000Z'],
      [1, 'current', RECENT],
      [2, 'expired', '2026-10-25T00:00:00.000Z'],
      [2, 'current', RECENT],
    ] as [number, string, string][])
      await db
        .prepare('INSERT INTO business_idempotency(tenant_id,key,fingerprint,response,created_at) VALUES (?,?,?,?,?)')
        .bind(tenant, key, 'fp', '{}', created)
        .run();

    for (const [tenant, id, created, delivered] of [
      // 1 October is past both windows; 31 October is inside both.
      [1, 'delivered-expired', OLD, '2026-10-01T00:05:00.000Z'],
      [1, 'pending-expired', OLD, null],
      [1, 'delivered-current', RECENT, '2026-10-31T11:05:00.000Z'],
      [2, 'pending-expired', OLD, null],
      [2, 'delivered-expired', OLD, '2026-10-01T00:05:00.000Z'],
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
    for (const tenant of [1, 2])
      await db
        .prepare(
          'INSERT INTO business_history(tenant_id,id,kind,entity_id,actor,operation,before_json,after_json,at) VALUES (?,?,?,?,?,?,?,?,?)',
        )
        .bind(tenant, 1, 'uruns', 1, 'fixture', 'CREATE', null, null, OLD)
        .run();

    expect(await keys()).toEqual(['1/current', '1/expired', '2/current', '2/expired']);

    await pruneTenantRetention({ DIRECTORY: db } as unknown as Env, NOW);

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
    await miniflare.dispose();
  }
}, 60000);

test('a retention pass costs the same whatever the number of cooperatives', async () => {
  const { miniflare, db } = await runtime();
  try {
    // Seed a wide range of cooperative counts and one row each, then measure a pass over each.
    const measure = async (tenants: number) => {
      await db.exec('DELETE FROM business_idempotency; DELETE FROM business_outbox; DELETE FROM tenants;');
      for (let id = 1; id <= tenants; id++)
        await db.prepare('INSERT INTO tenants(id,tenant_name) VALUES (?,?)').bind(id, `Cooperative ${id}`).run();
      for (let id = 1; id <= tenants; id++) {
        await db
          .prepare('INSERT INTO business_idempotency(tenant_id,key,fingerprint,response,created_at) VALUES (?,?,?,?,?)')
          .bind(id, 'key', 'fp', '{}', OLD)
          .run();
        await db
          .prepare('INSERT INTO business_outbox(tenant_id,id,payload,created_at,delivered_at) VALUES (?,?,?,?,?)')
          .bind(id, 'job', '{}', OLD, OLD)
          .run();
      }
      const { env, tally } = counted(db);
      await pruneTenantRetention(env, NOW);
      // Whatever it prunes, every seeded row is gone: one pass reached all of them.
      const remaining = await db
        .prepare('SELECT (SELECT count(*) FROM business_idempotency) + (SELECT count(*) FROM business_outbox) AS n')
        .first<number>('n');
      return { cost: tally.statements, remaining: Number(remaining) };
    };

    const few = await measure(2),
      many = await measure(60);
    expect(few.remaining).toBe(0);
    expect(many.remaining).toBe(0);
    // Sixty cooperatives must not cost sixty times what two do. The pass prunes across every
    // tenant in two statements, so the count is the same; the pre-fix loop charged one per tenant.
    expect(many.cost).toBe(few.cost);
    expect(many.cost).toBeLessThanOrEqual(4);
  } finally {
    await miniflare.dispose();
  }
}, 120000);

test('retention finds expired rows by the index the migration adds', async () => {
  const { miniflare, db } = await runtime();
  try {
    // The prune is the only consumer of these age columns and runs on every tick, so an index that
    // is declared but not reachable would silently reintroduce a full scan. Asserted on the plan
    // rather than on row counts, which the engine does not promise to keep stable.
    for (const [table, column, index] of [
      ['business_idempotency', 'created_at', 'business_idempotency_created_at'],
      ['business_outbox', 'delivered_at', 'business_outbox_delivered_at'],
    ] as [string, string, string][]) {
      const plan = await db
        .prepare(`EXPLAIN QUERY PLAN SELECT rowid FROM ${table} WHERE ${column}<? ORDER BY ${column} LIMIT ?`)
        .bind(NOW, 100)
        .all<{ detail: string }>();
      expect(plan.results.map(r => r.detail).join(' ')).toContain(index);
    }
  } finally {
    await miniflare.dispose();
  }
}, 60000);
