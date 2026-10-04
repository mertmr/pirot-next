import { it, expect } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { d1Transaction } from '../src/server/d1-store';
import { D1Files } from '../src/server/files';
import { applyMigrations } from './migrations';
it('D1 retries competing revisions and rolls back every write on a late constraint failure', async () => {
  const runtime = new Miniflare(
    convertV4MiniflareOptions({ modules: true, script: 'export default {fetch(){return new Response("ok")}}', d1Databases: ['DIRECTORY'] }),
  );
  try {
    const db = await runtime.getD1Database('DIRECTORY');
    await applyMigrations(db);
    await db.prepare("INSERT INTO tenants(id,tenant_name) VALUES (1,'Synthetic D1 cooperative'),(2,'Other synthetic cooperative')").run();
    await db.prepare("INSERT INTO business_tenant_meta(tenant_id,key,value) VALUES (1,'counter','0')").run();
    let arrived = 0;
    let release!: () => void;
    const barrier = new Promise<void>(resolve => {
      release = resolve;
    });
    const increment = async () => {
      let waited = false;
      return d1Transaction(db, 1, async sql => {
        const value = Number(sql.exec<{ value: string }>("SELECT value FROM tenant_meta WHERE key='counter'").one().value);
        if (!waited) {
          waited = true;
          if (++arrived === 2) release();
          await barrier;
        }
        sql.exec("UPDATE tenant_meta SET value=? WHERE key='counter'", String(value + 1));
        return value + 1;
      });
    };
    expect((await Promise.all([increment(), increment()])).sort()).toEqual([1, 2]);
    expect(await db.prepare("SELECT value FROM business_tenant_meta WHERE tenant_id=1 AND key='counter'").first('value')).toBe('2');
    await expect(
      d1Transaction(db, 1, async sql => {
        sql.exec("UPDATE tenant_meta SET value=? WHERE key='counter'", '99');
        sql.exec(
          'INSERT INTO entities(kind,id,data) VALUES (?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data',
          'uruns',
          1,
          JSON.stringify({ id: 1, tenantId: 2, urunAdi: 'Forbidden owner' }),
        );
      }),
    ).rejects.toThrow(/CHECK constraint failed/);
    expect(await db.prepare("SELECT value FROM business_tenant_meta WHERE tenant_id=1 AND key='counter'").first('value')).toBe('2');
    expect(await db.prepare('SELECT count(*) FROM urun').first('count(*)')).toBe(0);
    const files = new D1Files(db),
      key = `tenant/1/reports/stock/${crypto.randomUUID()}.xlsx`;
    const bytes = Uint8Array.from({ length: 1200001 }, (_, i) => i % 251);
    await files.put(key, bytes, { customMetadata: { month: '2026-10' } });
    expect(Buffer.from(await (await files.get(key))!.arrayBuffer()).equals(Buffer.from(bytes))).toBe(true);
    expect(await db.prepare('SELECT count(*) AS n FROM report_file_chunks').first('n')).toBe(3);
    expect((await files.list({ prefix: 'tenant/2/reports/stock/' })).objects).toEqual([]);
    const statements = (await db.prepare('SELECT name FROM sqlite_master WHERE type=? AND name LIKE ?').bind('table', 'report_file%').all())
      .results;
    expect(statements).toHaveLength(2);
  } finally {
    await runtime.dispose();
  }
});
