import { D1Files } from '../src/server/files';
import { test, expect } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';

import { object, list } from '../src/server/value';
import { applyMigrations } from './migrations';
test('real Cloudflare queue transports only outbox references and acknowledges after D1 delivery', async () => {
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
      queueProducers: { JOBS: 'fixture-jobs' },
      queueConsumers: { 'fixture-jobs': { maxBatchSize: 1, maxBatchTimeout: 0, retryDelay: 1, maxRetries: 2 } },
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
    await db.prepare('INSERT INTO tenants(id,tenant_name) VALUES (1,?)').bind('Synthetic queue tenant').run();
    const pausedTenant = crypto.randomUUID(),
      pausedDirectory = crypto.randomUUID(),
      email = JSON.stringify({ type: 'email', to: 'synthetic@example.invalid', subject: 'Retained invitation' });
    await db
      .prepare('INSERT INTO business_outbox(tenant_id,id,payload,created_at) VALUES (1,?,?,?)')
      .bind(pausedTenant, email, new Date().toISOString())
      .run();
    await db
      .prepare('INSERT INTO directory_outbox(id,payload,created_at) VALUES (?,?,?)')
      .bind(pausedDirectory, email, new Date().toISOString())
      .run();
    const namespace = await runtime.getDurableObjectNamespace('TENANTS'),
      stub = namespace.get(namespace.idFromName('tenant:1'));
    const actor = { id: 1, login: 'fixture', tenantId: 1, authorities: ['ROLE_ADMIN', 'ROLE_SYSTEM'] };
    const call = async (path: string, method = 'GET', body?: unknown) =>
      stub.fetch(`https://tenant/api/${path}`, {
        method,
        headers: { 'x-pirot-principal': JSON.stringify(actor), 'idempotency-key': crypto.randomUUID(), 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const product = await call('uruns', 'POST', {
      urunAdi: 'Synthetic queue stock',
      birim: 'ADET',
      stok: '10',
      musteriFiyati: '1.00',
      active: true,
    });
    expect(product.status).toBe(201);
    const created = await call('reports/stock-export', 'POST', {});
    expect(created.status).toBe(202);
    const row = object(list(await (await call('_internal/outbox')).json())[0]);
    expect((await runtime.dispatchFetch('https://fixture.test/__test/drain', { method: 'POST' })).status).toBe(204);
    const bucket = new D1Files(await runtime.getD1Database('DIRECTORY'));
    await expect.poll(async () => (await bucket.list({ prefix: 'tenant/1/reports/stock/' })).objects.length).toBe(1);
    await expect.poll(async () => object(await (await call('cooperative-operations')).json()).pendingJobs).toBe(0);
    const queue = await runtime.getQueueProducer('JOBS');
    await queue.send({ type: 'tenant-outbox', tenantId: 1, outboxId: row.id });
    for (const pointer of [
      { type: 'tenant-outbox', tenantId: 1, outboxId: pausedTenant },
      { type: 'directory-outbox', outboxId: pausedDirectory },
    ])
      expect(
        (
          await runtime.dispatchFetch('https://fixture.test/__test/deliver', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(pointer),
          })
        ).status,
      ).toBe(204);
    await queue.send({ type: 'tenant-outbox', tenantId: 1, outboxId: pausedTenant });
    await queue.send({ type: 'directory-outbox', outboxId: pausedDirectory });
    expect(
      await db.prepare('SELECT queued_at,delivered_at FROM business_outbox WHERE tenant_id=1 AND id=?').bind(pausedTenant).first(),
    ).toEqual({ queued_at: null, delivered_at: null });
    expect(await db.prepare('SELECT queued_at,delivered_at FROM directory_outbox WHERE id=?').bind(pausedDirectory).first()).toEqual({
      queued_at: null,
      delivered_at: null,
    });
    const delivered = await call(`_internal/outbox/${row.id}`);
    expect(delivered.status).toBe(204);
    expect((await bucket.list({ prefix: 'tenant/1/reports/stock/' })).objects).toHaveLength(1);
  } finally {
    await runtime.dispose();
  }
});
