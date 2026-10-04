import { D1Files } from '../src/server/files';
import { test, expect } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';

import { unzipSync, strFromU8 } from 'fflate';
import { applyMigrations } from './migrations';

test('email outage retains persisted jobs; successful retry acknowledges email and a large attached D1 report', async () => {
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
      name: 'email-fixture',
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
      serviceBindings: { EMAIL: { name: 'email-fixture', entrypoint: 'SyntheticEmailProvider' } },
      queueProducers: { JOBS: 'email-fixture-jobs' },
      queueConsumers: { 'email-fixture-jobs': { maxBatchSize: 1, maxBatchTimeout: 0, retryDelay: 1, maxRetries: 5 } },
      bindings: {
        AUTH_SECRET: 'synthetic-secret-with-at-least-thirty-two-characters',
        ENVIRONMENT: 'development',
        PUBLIC_URL: 'https://email-fixture.test',
        EMAIL_FROM: 'pirot@example.invalid',
      },
    }),
  );
  try {
    const db = await runtime.getD1Database('DIRECTORY');
    await applyMigrations(db);
    await db.exec(
      'CREATE TABLE test_email_attempts(payload TEXT); CREATE TABLE test_email_control(enabled INTEGER); INSERT INTO test_email_control VALUES(0);',
    );
    await db.prepare("INSERT INTO tenants(id,tenant_name) VALUES(1,'Synthetic report cooperative')").run();
    const id = crypto.randomUUID();
    await db
      .prepare('INSERT INTO directory_outbox(id,payload,created_at) VALUES(?,?,?)')
      .bind(
        id,
        JSON.stringify({
          type: 'email',
          to: 'synthetic-recipient@example.invalid',
          subject: 'Synthetic reset',
          text: 'Synthetic single-use reset link',
        }),
        new Date().toISOString(),
      )
      .run();
    const queue = await runtime.getQueueProducer('JOBS');
    const pointer = { type: 'directory-outbox', outboxId: id };
    await queue.send(pointer);
    await expect
      .poll(async () => (await db.prepare('SELECT COUNT(*) AS count FROM test_email_attempts').first<{ count: number }>())?.count)
      .toBeGreaterThan(0);
    expect(
      (await db.prepare('SELECT delivered_at FROM directory_outbox WHERE id=?').bind(id).first<{ delivered_at: string | null }>())
        ?.delivered_at,
    ).toBeNull();
    await db.prepare('UPDATE test_email_control SET enabled=1').run();
    await expect
      .poll(
        async () =>
          (await db.prepare('SELECT delivered_at FROM directory_outbox WHERE id=?').bind(id).first<{ delivered_at: string | null }>())
            ?.delivered_at,
      )
      .toBeTruthy();
    const before = (await db.prepare('SELECT COUNT(*) AS count FROM test_email_attempts').first<{ count: number }>())!.count;
    // A delivered pointer reads as absent, even if the queue redelivers it.
    expect(
      (
        await runtime.dispatchFetch('https://email-fixture.test/__test/deliver', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(pointer),
        })
      ).status,
    ).toBe(204);
    expect((await db.prepare('SELECT COUNT(*) AS count FROM test_email_attempts').first<{ count: number }>())?.count).toBe(before);
    const reportId = crypto.randomUUID();
    await db
      .prepare('INSERT INTO directory_outbox(id,payload,created_at) VALUES(?,?,?)')
      .bind(
        reportId,
        JSON.stringify({
          type: 'stock-report',
          id: reportId,
          tenantId: 1,
          month: '2026-10',
          to: 'synthetic-recipient@example.invalid',
          products: Array.from({ length: 5000 }, (_, i) => ({
            urunAdi: `Synthetic product ${i}`,
            stok: '10',
            musteriFiyati: '12.25',
            birim: 'ADET',
          })),
        }),
        new Date().toISOString(),
      )
      .run();
    await queue.send({ type: 'directory-outbox', outboxId: reportId });
    await expect
      .poll(
        async () =>
          (await db.prepare('SELECT delivered_at FROM directory_outbox WHERE id=?').bind(reportId).first<{ delivered_at: string | null }>())
            ?.delivered_at,
      )
      .toBeTruthy();
    const bucket = new D1Files(await runtime.getD1Database('DIRECTORY'));
    const file = await bucket.get(`tenant/1/reports/stock/${reportId}.xlsx`);
    expect(file).toBeTruthy();
    const bytes = new Uint8Array(await file!.arrayBuffer());
    const sheet = strFromU8(unzipSync(bytes)['xl/worksheets/sheet1.xml']);
    expect(sheet).toContain('Synthetic product 4999');
    const attempts = (await db.prepare('SELECT payload FROM test_email_attempts').all<{ payload: string }>()).results;
    const message = JSON.parse(attempts.at(-1)!.payload);
    expect(message.to).toBe('synthetic-recipient@example.invalid');
    expect(Buffer.from(message.attachments[0].content, 'base64')).toEqual(Buffer.from(bytes));
  } finally {
    await runtime.dispose();
  }
}, 15000);
