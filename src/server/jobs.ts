import { files } from './files';
import { requireOutboundEmail, outboundEmailEnabled } from './email-policy';
import type { Env, CurrentUser } from './env';
import { object, list, text, integer, type JsonObject, BusinessError, istanbulDay } from './value';
import { workbook } from './xlsx';
import { Buffer } from 'node:buffer';
export async function deliver(payload: JsonObject, env: Env) {
  if (payload.type === 'email') {
    requireOutboundEmail(env);
    if (!env.EMAIL || !env.EMAIL_FROM) throw new BusinessError('configuration', 503);
    await env.EMAIL.send({
      to: text(payload.to),
      from: text(payload.from, env.EMAIL_FROM),
      subject: text(payload.subject),
      html: payload.html ? text(payload.html) : undefined,
      text: payload.text ? text(payload.text) : undefined,
    });
    return;
  }
  if (payload.type === 'stock-report') {
    const tenant = integer(payload.tenantId, true),
      month = text(payload.month);
    if (!/^\d{4}-\d{2}$/.test(month)) throw new BusinessError('invaliddate');
    const key = `tenant/${tenant}/reports/stock/${text(payload.id)}.xlsx`,
      products = list(payload.products).map(object);
    const bytes = workbook(
      ['Ürün Adı', 'Stok', 'Fiyat', 'Birim'],
      products.map(p => [text(p.urunAdi), text(p.stok, '0'), text(p.musteriFiyati, '0'), text(p.birim)]),
    );
    await files(env).put(key, bytes, {
      httpMetadata: { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      customMetadata: { tenantId: String(tenant), month, kind: 'stock-report' },
    });
    if (payload.to && outboundEmailEnabled(env)) {
      requireOutboundEmail(env);
      const download = `${env.PUBLIC_URL}/reports/stock`;
      if (!env.EMAIL || !env.EMAIL_FROM) throw new BusinessError('configuration', 503);
      await env.EMAIL.send({
        to: text(payload.to),
        from: env.EMAIL_FROM,
        subject: 'Ay Sonu Stok Raporu / Month-end stock report',
        text: `${month}: ${download}`,
        attachments:
          bytes.byteLength <= 3_500_000
            ? [
                {
                  filename: `stok-raporu-${month}.xlsx`,
                  content: Buffer.from(bytes).toString('base64'),
                  type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                  disposition: 'attachment',
                },
              ]
            : undefined,
      });
    }
    return;
  }
  throw new BusinessError('invalidrequest');
}
export async function drainTenantOutbox(env: Env, tenantId: number) {
  const actor: CurrentUser = { id: 0, login: 'system', tenantId, authorities: ['ROLE_SYSTEM'] },
    stub = env.TENANTS.get(env.TENANTS.idFromName(`tenant:${tenantId}`));
  const response = await stub.fetch('https://tenant/api/_internal/outbox', { headers: { 'x-pirot-principal': JSON.stringify(actor) } });
  if (!response.ok) throw new BusinessError('configuration', 503);
  for (const value of list(await response.json())) {
    const row = object(value);
    try {
      if (env.JOBS) {
        await env.JOBS.send({ type: 'tenant-outbox', outboxId: row.id, tenantId });
      } else {
        const payloadResponse = await stub.fetch(`https://tenant/api/_internal/outbox/${encodeURIComponent(text(row.id))}`, {
          headers: { 'x-pirot-principal': JSON.stringify(actor) },
        });
        if (payloadResponse.status === 204) continue;
        if (!payloadResponse.ok) throw new BusinessError('configuration', 503);
        await deliver(object(await payloadResponse.json()), env);
      }
      const action = env.JOBS ? 'queued' : 'ack';
      const ack = await stub.fetch(`https://tenant/api/_internal/outbox/${action}`, {
        method: 'POST',
        headers: {
          'x-pirot-principal': JSON.stringify(actor),
          'idempotency-key': `${action}:${text(row.id)}:${env.JOBS ? new Date().toISOString() : 'delivered'}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ ids: [row.id] }),
      });
      if (!ack.ok) throw new BusinessError('configuration', 503);
    } catch (error) {
      console.error('Tenant outbox delivery failed', {
        tenantId,
        id: row.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}
export async function processQueuedJob(pointer: JsonObject, env: Env) {
  if (pointer.type === 'tenant-outbox') {
    const tid = integer(pointer.tenantId, true),
      id = text(pointer.outboxId),
      actor: CurrentUser = { id: 0, login: 'system', tenantId: tid, authorities: ['ROLE_SYSTEM'] },
      stub = env.TENANTS.get(env.TENANTS.idFromName(`tenant:${tid}`));
    const response = await stub.fetch(`https://tenant/api/_internal/outbox/${encodeURIComponent(id)}`, {
      headers: { 'x-pirot-principal': JSON.stringify(actor) },
    });
    if (response.status === 204) return;
    if (!response.ok) throw new BusinessError('configuration', 503);
    const payload = object(await response.json());
    if (payload.type === 'email' && !outboundEmailEnabled(env)) return;
    await deliver(payload, env);
    const ack = await stub.fetch('https://tenant/api/_internal/outbox/ack', {
      method: 'POST',
      headers: { 'x-pirot-principal': JSON.stringify(actor), 'idempotency-key': `ack:${id}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ids: [id] }),
    });
    if (!ack.ok) throw new BusinessError('configuration', 503);
  } else if (pointer.type === 'directory-outbox') {
    const id = text(pointer.outboxId),
      row = await env.DIRECTORY.prepare('SELECT payload FROM directory_outbox WHERE id=? AND delivered_at IS NULL')
        .bind(id)
        .first<{ payload: string }>();
    if (!row) return;
    const payload = object(JSON.parse(row.payload));
    if (payload.type === 'email' && !outboundEmailEnabled(env)) return;
    await deliver(payload, env);
    await env.DIRECTORY.prepare('UPDATE directory_outbox SET delivered_at=? WHERE id=?').bind(new Date().toISOString(), id).run();
  } else throw new BusinessError('invalidrequest');
}
export async function drainOutboxes(env: Env) {
  const directory = await env.DIRECTORY.prepare(
    `SELECT id,payload FROM directory_outbox WHERE delivered_at IS NULL AND (${outboundEmailEnabled(env) ? '1' : "json_extract(payload,'$.type')<>'email'"}) AND (queued_at IS NULL OR queued_at<?) ORDER BY created_at LIMIT 100`,
  )
    .bind(new Date(Date.now() - 600000).toISOString())
    .all<{ id: string; payload: string }>();
  for (const row of directory.results) {
    try {
      if (env.JOBS) {
        await env.JOBS.send({ type: 'directory-outbox', outboxId: row.id });
        await env.DIRECTORY.prepare('UPDATE directory_outbox SET queued_at=? WHERE id=?').bind(new Date().toISOString(), row.id).run();
      } else {
        await deliver(object(JSON.parse(row.payload)), env);
        await env.DIRECTORY.prepare('UPDATE directory_outbox SET delivered_at=? WHERE id=?').bind(new Date().toISOString(), row.id).run();
      }
    } catch (error) {
      console.error('Directory outbox delivery failed', { id: row.id, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }
  const tenants = await env.DIRECTORY.prepare('SELECT id FROM tenants ORDER BY id').all<{ id: number }>();
  for (const tenant of tenants.results) {
    try {
      await drainTenantOutbox(env, tenant.id);
    } catch (error) {
      console.error('Tenant job scan failed', { tenantId: tenant.id, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }
}
/**
 * Retention for the tables that would otherwise grow without bound.
 *
 * An idempotency key only has to outlive a client's retry window, so a day is
 * generous. A delivered outbox row is kept for a week so an operator can still
 * confirm what was sent. The history table is the financial audit trail and is
 * deliberately never pruned.
 */
const IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60 * 1000;
const OUTBOX_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Deletes expired tenant rows directly in D1.
 *
 * This deliberately bypasses the tenant SQL adapter: that adapter turns a single
 * bulk DELETE into one statement per matching row, which would spend the
 * per-invocation query budget on the maintenance task itself. Each cooperative
 * here costs two statements regardless of how much it prunes, and every statement
 * binds the tenant explicitly.
 */
export async function pruneTenantRetention(env: Env, at = Date.now()): Promise<void> {
  const idempotencyBefore = new Date(at - IDEMPOTENCY_RETENTION_MS).toISOString(),
    outboxBefore = new Date(at - OUTBOX_RETENTION_MS).toISOString();
  const tenants = await env.DIRECTORY.prepare('SELECT id FROM tenants ORDER BY id').all<{ id: number }>();
  for (const tenant of tenants.results) {
    try {
      await env.DIRECTORY.batch([
        env.DIRECTORY.prepare('DELETE FROM business_idempotency WHERE tenant_id=? AND created_at<?').bind(tenant.id, idempotencyBefore),
        env.DIRECTORY.prepare('DELETE FROM business_outbox WHERE tenant_id=? AND delivered_at IS NOT NULL AND delivered_at<?').bind(
          tenant.id,
          outboxBefore,
        ),
      ]);
    } catch (error) {
      console.error('Retention pruning failed', {
        tenantId: tenant.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}

export async function scheduleStockReports(env: Env, at = new Date()) {
  const day = istanbulDay(at.toISOString()),
    tomorrow = istanbulDay(new Date(at.getTime() + 86400000).toISOString());
  if (day.slice(0, 7) === tomorrow.slice(0, 7)) return;
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Istanbul', hour: '2-digit', hourCycle: 'h23' }).format(at));
  if (hour < 23) return;
  const tenants = await env.DIRECTORY.prepare('SELECT id FROM tenants ORDER BY id').all<{ id: number }>();
  for (const tenant of tenants.results) {
    const actor: CurrentUser = { id: 0, login: 'system', tenantId: tenant.id, authorities: ['ROLE_SYSTEM'] };
    const response = await env.TENANTS.get(env.TENANTS.idFromName(`tenant:${tenant.id}`)).fetch(
      'https://tenant/api/_internal/monthly-stock-report',
      {
        method: 'POST',
        headers: {
          'x-pirot-principal': JSON.stringify(actor),
          'idempotency-key': `month-end:${day.slice(0, 7)}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ month: day.slice(0, 7) }),
      },
    );
    if (!response.ok) console.error('Stock report scheduling failed', { tenantId: tenant.id, status: response.status });
  }
}
