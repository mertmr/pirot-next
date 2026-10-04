import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFile } from 'node:fs/promises';
import { applyMigrations } from './migrations';

/**
 * The discount ceiling is tenant data, and moving it out of application code changed what an
 * existing deployment is allowed to do. A cooperative that could take a discount before must still
 * be able to after, or the change silently withdraws a capability at the counter. Migrations are the
 * only place that can carry that forward, so the seed is verified here against real D1 rather than
 * assumed to be equivalent to the rule it replaces.
 */

const SEED = 'migrations/0005_seed_discount_ceiling.sql';
let runtime: Miniflare, database: D1Database;

/** Applies the seed on its own, so each case controls the rows it starts from. */
async function seed(): Promise<void> {
  await database.exec((await readFile(SEED, 'utf8')).replace(/^--.*$/gm, '').replace(/\n+/g, ' '));
}
const settings = async (tenantId: number) => {
  const row = await database
    .prepare("SELECT value FROM business_tenant_meta WHERE tenant_id=? AND key='settings'")
    .bind(tenantId)
    .first<string>('value');
  return row ? (JSON.parse(row) as Record<string, unknown>) : null;
};
const addTenant = (id: number) => database.prepare('INSERT INTO tenants(id,tenant_name) VALUES (?,?)').bind(id, `Cooperative ${id}`).run();
/** Writes the cooperative's settings, replacing whatever is stored, as an administrator edit would. */
const putSettings = (tenantId: number, value: unknown) =>
  database
    .prepare(
      "INSERT INTO business_tenant_meta(tenant_id,key,value) VALUES (?, 'settings', ?) ON CONFLICT(tenant_id,key) DO UPDATE SET value=excluded.value",
    )
    .bind(tenantId, JSON.stringify(value))
    .run();

beforeAll(async () => {
  runtime = new Miniflare(
    convertV4MiniflareOptions({
      script: 'export default { fetch() { return new Response("1"); } }',
      modules: true,
      compatibilityDate: '2026-10-01',
      d1Databases: ['D'],
    } as never),
  );
  database = await runtime.getD1Database('D');
  await applyMigrations(database);
});

beforeEach(async () => {
  // The schema is created once; each case starts from empty business tables.
  await database.exec('DELETE FROM business_tenant_meta; DELETE FROM tenants;');
});

afterAll(async () => {
  await runtime.dispose();
});

describe('discount ceiling seed', () => {
  it('gives the cooperative that had the allowance the same ceiling it had', async () => {
    await addTenant(2);
    await putSettings(2, { stockReportEmail: 'reports@example.invalid', stockReportEnabled: false });
    await seed();
    // Full 100% is what the replaced rule permitted, and the other settings survive.
    expect(await settings(2)).toEqual({
      stockReportEmail: 'reports@example.invalid',
      stockReportEnabled: false,
      maxDiscountPercent: '100',
    });
  });

  it('creates the row when that cooperative never had one', async () => {
    await addTenant(2);
    expect(await settings(2)).toBeNull();
    await seed();
    expect(await settings(2)).toEqual({ maxDiscountPercent: '100' });
  });

  it('leaves every other cooperative at the zero fallback', async () => {
    await addTenant(1);
    await addTenant(3);
    await putSettings(3, { stockReportEnabled: true });
    await seed();
    // No row is written, which the store reads as zero — exactly the old rule for these tenants.
    expect(await settings(1)).toBeNull();
    expect(await settings(3)).toEqual({ stockReportEnabled: true });
  });

  it('applies cleanly when that tenant does not exist', async () => {
    await addTenant(1);
    await expect(seed()).resolves.not.toThrow();
    expect(await settings(1)).toBeNull();
  });

  it('does not overwrite a ceiling an administrator has since set', async () => {
    await addTenant(2);
    await seed();
    await putSettings(2, { maxDiscountPercent: '5' });
    // Migrations are tracked and normally run once, but a replayed or hand-applied seed must not
    // hand a cooperative back an allowance an administrator deliberately removed.
    await seed();
    expect(await settings(2)).toEqual({ maxDiscountPercent: '5' });
  });

  it('repairs a stored row whose value is null', async () => {
    await addTenant(2);
    await database.prepare("INSERT INTO business_tenant_meta(tenant_id,key,value) VALUES (2,'settings',NULL)").run();
    await seed();
    expect(await settings(2)).toEqual({ maxDiscountPercent: '100' });
  });
});
