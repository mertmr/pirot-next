import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import { readFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { object, list, integer, refId, type JsonObject, type Entity } from '../src/server/value';
import { manifest } from '../scripts/prepare-migration';
import { ENTITY_SPECS, type EntityKind } from '../src/server/entity-specs';
import { unzipSync, strFromU8 } from 'fflate';
import { applyMigrations } from './migrations';
let runtime: Miniflare,
  adminToken: string,
  sequence = 0;
const password = 'Synthetic-fixture-password-42';
async function call(path: string, method = 'GET', body?: unknown, token = adminToken, key?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'accept-language': 'en' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (!['GET', 'HEAD'].includes(method)) headers['idempotency-key'] = key ?? crypto.randomUUID();
  return runtime.dispatchFetch(`https://pirot.test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function ok(path: string, method = 'GET', body?: unknown, token = adminToken, key?: string): Promise<JsonObject> {
  const r = await call(path, method, body, token, key);
  const data = await r.json();
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${JSON.stringify(data)}`);
  return object(data);
}
async function rows(path: string, token = adminToken): Promise<JsonObject[]> {
  const r = await call(path, 'GET', undefined, token);
  expect(r.status).toBe(200);
  return list(await r.json()).map(object);
}
async function fixture() {
  const n = ++sequence;
  const tenant = await ok('/api/tenants', 'POST', { tenantName: `Fixture ${n}` });
  const tid = integer(tenant.id, true),
    login = `fixture${n}`;
  await ok('/api/admin/users', 'POST', {
    login,
    email: `${login}@example.invalid`,
    password,
    tenantId: tid,
    activated: true,
    authorities: ['ROLE_USER'],
  });
  const auth = await ok('/api/authenticate', 'POST', { username: login, password }, '');
  const token = String(auth.id_token);
  await ok('/api/kasa-hareketleris', 'POST', { kasaMiktar: '100.00', hareket: 'Synthetic opening balance' }, token);
  const product = await ok(
    '/api/uruns',
    'POST',
    { urunAdi: 'Synthetic product', birim: 'ADET', stok: '10', stokSiniri: '1', musteriFiyati: '10.00', active: true, satista: true },
    token,
  );
  return { token, tid, login, product, pid: integer(product.id, true) };
}
const sale = (pid: number, quantity = 2, extra: JsonObject = {}) => ({
  stokHareketleriLists: [{ urunId: pid, miktar: quantity }],
  ...extra,
});
/** A fixture tenant whose user holds ROLE_ADMIN, for the endpoints that require it. */
async function adminFixture() {
  const n = ++sequence,
    login = `admin${n}`,
    tenant = await ok('/api/tenants', 'POST', { tenantName: `Admin fixture ${n}` }),
    tid = integer(tenant.id, true);
  await ok('/api/admin/users', 'POST', {
    login,
    email: `${login}@example.invalid`,
    password,
    tenantId: tid,
    activated: true,
    authorities: ['ROLE_ADMIN', 'ROLE_USER'],
  });
  const token = String((await ok('/api/authenticate', 'POST', { username: login, password }, '')).id_token);
  await ok('/api/kasa-hareketleris', 'POST', { kasaMiktar: '1000.00', hareket: 'Synthetic opening balance' }, token);
  const product = await ok(
    '/api/uruns',
    'POST',
    { urunAdi: `Discount product ${n}`, birim: 'ADET', stok: '100', musteriFiyati: '10.00', active: true, satista: true },
    token,
  );
  return { token, tid, login, pid: integer(product.id, true) };
}
const settings = (maxDiscountPercent: number) => ({
  stockReportEmail: '',
  stockReportEnabled: false,
  maxDiscountPercent,
});

async function cash(token: string) {
  return (await rows('/api/kasa-hareketleris?sort=id,desc', token))[0].kasaMiktar;
}
async function stock(pid: number, token: string) {
  return (await ok(`/api/uruns/${pid}`, 'GET', undefined, token)).stok;
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
  const directory = await runtime.getD1Database('DIRECTORY');
  await applyMigrations(directory);
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
  adminToken = String((await ok('/api/authenticate', 'POST', { username: 'fixture-admin', password }, '')).id_token);
});
afterAll(async () => {
  await runtime?.dispose();
});
describe('Cloudflare D1 financial lifecycle', () => {
  it('derives sale totals and ownership, reverses edit/delete effects, and preserves read-back', async () => {
    const f = await fixture();
    const created = await ok(
      '/api/satis',
      'POST',
      sale(f.pid, 2, { toplamTutar: '0', odendi: false, user: { id: 999 }, tenantId: 999 }),
      f.token,
    );
    expect(created.toplamTutar).toBe('20.00');
    expect(created.odendi).toBe(true);
    expect(created.tenantId).toBe(f.tid);
    expect(refId(created.user)).not.toBe(999);
    expect(await stock(f.pid, f.token)).toBe('8');
    expect(await cash(f.token)).toBe('120.00');
    const updated = await ok('/api/satis', 'PUT', { ...sale(f.pid, 3), id: created.id }, f.token);
    expect(updated.toplamTutar).toBe('30.00');
    expect(await stock(f.pid, f.token)).toBe('7');
    expect(await cash(f.token)).toBe('130.00');
    expect((await call(`/api/satis/${created.id}`, 'DELETE', undefined, f.token)).status).toBe(204);
    expect(await stock(f.pid, f.token)).toBe('10');
    expect(await cash(f.token)).toBe('100.00');
    expect((await call(`/api/satis/${created.id}`, 'GET', undefined, f.token)).status).toBe(404);
  });
  it('keeps card sales out of cash and collects deferred cash exactly once', async () => {
    const f = await fixture();
    const card = await ok('/api/satis', 'POST', sale(f.pid, 1, { kartliSatis: true }), f.token);
    expect(await cash(f.token)).toBe('100.00');
    expect((await call(`/api/satis/${card.id}`, 'DELETE', undefined, f.token)).status).toBe(204);
    const deferred = await ok('/api/satis?paymentNote=Synthetic%20debt', 'POST', sale(f.pid, 2, { sonraOdeme: true }), f.token);
    expect(deferred.odendi).toBe(false);
    expect(await cash(f.token)).toBe('100.00');
    const key = crypto.randomUUID();
    const paid = await ok(`/api/satis/${deferred.id}/collect-payment?paymentMethod=NAKIT`, 'POST', {}, f.token, key);
    expect(paid.odendi).toBe(true);
    expect(await cash(f.token)).toBe('120.00');
    await ok(`/api/satis/${deferred.id}/collect-payment?paymentMethod=NAKIT`, 'POST', {}, f.token, key);
    expect(await cash(f.token)).toBe('120.00');
    expect((await call(`/api/satis/${deferred.id}/collect-payment`, 'POST', {}, f.token)).status).toBe(409);
    const debt = (await rows('/api/borc-alacaks', f.token))[0];
    expect(debt.hareketTipi).toBe('ODEME');
    expect((await call(`/api/borc-alacaks/${debt.id}`, 'DELETE', undefined, f.token)).status).toBe(400);
    expect((await call(`/api/satis/${deferred.id}`, 'DELETE', undefined, f.token)).status).toBe(204);
    expect(await cash(f.token)).toBe('100.00');
    expect(await rows('/api/borc-alacaks', f.token)).toHaveLength(0);
  });
  it('does not mutate cash for deferred bank collection and compensates paid edits', async () => {
    const f = await fixture();
    const created = await ok('/api/satis', 'POST', sale(f.pid, 1, { sonraOdeme: true }), f.token);
    await ok(`/api/satis/${created.id}/collect-payment?paymentMethod=BANKA`, 'POST', {}, f.token);
    await ok('/api/satis', 'PUT', { ...sale(f.pid, 3, { sonraOdeme: true }), id: created.id }, f.token);
    expect(await cash(f.token)).toBe('100.00');
    expect((await rows('/api/borc-alacaks', f.token))[0].tutar).toBe('30.00');
  });
  it('serializes competing purchases and rolls back a transaction that fails after stock reversal', async () => {
    const f = await fixture();
    const attempts = await Promise.all([
      call('/api/satis', 'POST', sale(f.pid, 7), f.token),
      call('/api/satis', 'POST', sale(f.pid, 7), f.token),
    ]);
    expect(attempts.map(r => r.status).sort()).toEqual([201, 409]);
    expect(await stock(f.pid, f.token)).toBe('3');
    expect(await cash(f.token)).toBe('170.00');
    const entry = await ok(
      '/api/stok-girisis',
      'POST',
      { urun: { id: f.pid }, miktar: 1, notlar: 'Synthetic entry', stokHareketiTipi: 'STOK_GIRISI' },
      f.token,
    );
    const beforeStock = await stock(f.pid, f.token);
    const rejected = await call(`/api/stok-girisis/${entry.id}`, 'PUT', { ...entry, miktar: 100, stokHareketiTipi: 'FIRE' }, f.token);
    expect(rejected.status).toBe(409);
    expect(await stock(f.pid, f.token)).toBe(beforeStock);
    expect((await ok(`/api/stok-girisis/${entry.id}`, 'GET', undefined, f.token)).miktar).toBe(1);
  });
  it('deduplicates requests and rejects key reuse with different content', async () => {
    const f = await fixture(),
      key = crypto.randomUUID();
    const first = await ok('/api/satis', 'POST', sale(f.pid), f.token, key),
      second = await ok('/api/satis', 'POST', sale(f.pid), f.token, key);
    expect(second.id).toBe(first.id);
    expect(await cash(f.token)).toBe('120.00');
    expect(await stock(f.pid, f.token)).toBe('8');
    expect((await call('/api/satis', 'POST', sale(f.pid, 3), f.token, key)).status).toBe(409);
    expect(await stock(f.pid, f.token)).toBe('8');
  });
  it('calculates gram totals with quarter rounding and rejects invalid quantities/discounts', async () => {
    const f = await fixture();
    const gram = await ok(
      '/api/uruns',
      'POST',
      { urunAdi: 'Synthetic grams', birim: 'GRAM', stok: '1000', musteriFiyati: '19.99', active: true, satista: true },
      f.token,
    );
    const created = await ok('/api/satis', 'POST', sale(integer(gram.id, true), 125), f.token);
    expect(created.toplamTutar).toBe('2.50');
    expect(await stock(integer(gram.id, true), f.token)).toBe('875');
    expect((await call('/api/satis', 'POST', sale(f.pid, 0), f.token)).status).toBe(400);
    expect((await call('/api/satis', 'POST', sale(f.pid, 1, { indirim: '5' }), f.token)).status).toBe(400);
  });
  it('reverses cash expenses and transfers on edit/delete', async () => {
    const f = await fixture();
    const expense = await ok(
      '/api/giders',
      'POST',
      { tutar: '10.50', notlar: 'Synthetic expense', giderTipi: 'DIGER', odemeAraci: 'NAKIT' },
      f.token,
    );
    expect(await cash(f.token)).toBe('89.50');
    await ok(`/api/giders/${expense.id}`, 'PUT', { ...expense, tutar: '15.00', odemeAraci: 'BANKA' }, f.token);
    expect(await cash(f.token)).toBe('100.00');
    expect((await call(`/api/giders/${expense.id}`, 'DELETE', undefined, f.token)).status).toBe(204);
    const transfer = await ok(
      '/api/virmen',
      'POST',
      { tutar: '25.00', notlar: 'Synthetic transfer', cikisHesabi: 'KASA', girisHesabi: 'BANKA' },
      f.token,
    );
    expect(await cash(f.token)).toBe('75.00');
    await ok(`/api/virmen/${transfer.id}`, 'PATCH', { tutar: '10.00' }, f.token);
    expect(await cash(f.token)).toBe('90.00');
    expect((await call(`/api/virmen/${transfer.id}`, 'DELETE', undefined, f.token)).status).toBe(204);
    expect(await cash(f.token)).toBe('100.00');
  });
  it('keeps authoritative shift history and applies closed-shift corrections in the active shift', async () => {
    const f = await fixture();
    const opening = await ok(
      '/api/nobet-hareketleris',
      'POST',
      { acilisKapanis: 'ACILIS', kasa: '100.00', pirot: '999999', fark: '888' },
      f.token,
    );
    expect(opening.pirot).toBe('100.00');
    expect(opening.fark).toBe('0.00');
    const created = await ok('/api/satis', 'POST', sale(f.pid), f.token);
    const closing = await ok('/api/nobet-hareketleris', 'POST', { acilisKapanis: 'KAPANIS', kasa: '120.00' }, f.token);
    expect(closing.acilisId).toBe(opening.id);
    expect(object(JSON.parse(String(closing.kapanisDokumu))).satis).toBe('20.00');
    expect((await call('/api/satis', 'PUT', { ...sale(f.pid, 3), id: created.id }, f.token)).status).toBe(400);
    await ok('/api/nobet-hareketleris', 'POST', { acilisKapanis: 'ACILIS', kasa: '120.00' }, f.token);
    await ok(
      '/api/satis',
      'PUT',
      { ...sale(f.pid, 3), id: created.id, duzeltme: { neden: 'Synthetic correction', nakitSimdi: false } },
      f.token,
    );
    expect(await cash(f.token)).toBe('120.00');
    const context = await ok(`/api/nobet-duzeltmeler/context/satis/${created.id}`, 'GET', undefined, f.token),
      correction = object(list(context.duzeltmeler)[0]);
    expect(correction.bekleyenKasa).toBe('10.00');
    await ok(`/api/nobet-duzeltmeler/${correction.id}/odeme`, 'POST', {}, f.token);
    expect(await cash(f.token)).toBe('130.00');
    await ok(`/api/nobet-duzeltmeler/${correction.id}/odeme`, 'POST', {}, f.token);
    expect(await cash(f.token)).toBe('130.00');
    expect((await ok(`/api/nobet-hareketleris/${closing.id}`, 'GET', undefined, f.token)).kapanisDokumu).toBe(closing.kapanisDokumu);
    expect((await call(`/api/nobet-hareketleris/${opening.id}`, 'DELETE', undefined, f.token)).status).toBe(400);
  });
  it('isolates reads, writes, relationships, reports and ownership across tenants', async () => {
    const a = await fixture(),
      b = await fixture();
    const secretProduct = await ok(
      '/api/uruns',
      'POST',
      { urunAdi: 'Tenant A only', birim: 'ADET', stok: '4', musteriFiyati: '1.00' },
      a.token,
    );
    expect((await call(`/api/uruns/${secretProduct.id}`, 'GET', undefined, b.token)).status).toBe(404);
    expect((await call('/api/satis', 'POST', sale(integer(secretProduct.id, true)), b.token)).status).toBe(404);
    expect((await call(`/api/uruns/${secretProduct.id}`, 'DELETE', undefined, b.token)).status).toBe(404);
    const created = await ok('/api/satis', 'POST', sale(a.pid, 1, { tenantId: b.tid }), a.token);
    expect(created.tenantId).toBe(a.tid);
    expect((await ok('/api/dashboard-reports', 'GET', undefined, b.token)).gunlukCiro).toBe('0.00');
    expect((await call('/api/uruns', 'GET', undefined, '')).status).toBe(401);
    expect((await call('/api/tenants', 'GET', undefined, b.token)).status).toBe(403);
  });
});

describe('Cloudflare accounts, reporting and migration', () => {
  it('treats an oversized login password exactly like any other wrong credential', async () => {
    // The login path never reaches passwordValue(); the hasher rejects oversized
    // input. Assert the observable contract: 401, identical for known and unknown
    // accounts, and indistinguishable from an ordinary wrong password, so the
    // response cannot be used to probe account existence or password policy.
    const body = async (username: string, secret: string) => {
      const response = await call('/api/authenticate', 'POST', { username, password: secret }, '');
      expect(response.status).toBe(401);
      return response.text();
    };
    const oversized = await body('fixture-admin', 'x'.repeat(201));
    expect(oversized).toBe(await body('unknown-fixture', 'x'.repeat(201)));
    expect(oversized).toBe(await body('fixture-admin', 'not-the-password'));
  });
  it('applies the discount ceiling from cooperative settings instead of a hardcoded tenant id', async () => {
    const f = await adminFixture();

    // The default ceiling is zero, so a discount is rejected for a fresh tenant.
    expect((await call('/api/satis', 'POST', sale(f.pid, 2, { indirim: '10' }), f.token)).status).toBe(400);

    // The ceiling is tenant data, so this cooperative can opt in.
    await ok('/api/cooperative-settings', 'PUT', settings(25), f.token);
    const created = await ok('/api/satis', 'POST', sale(f.pid, 2, { indirim: '10' }), f.token);
    expect(created.toplamTutar).toBe('18.00');

    // A discount above the configured ceiling stays rejected.
    expect((await call('/api/satis', 'POST', sale(f.pid, 2, { indirim: '30' }), f.token)).status).toBe(400);

    // The stored ceiling is readable, and an out-of-range ceiling is refused.
    expect((await ok('/api/cooperative-settings', 'GET', undefined, f.token)).maxDiscountPercent).toBe('25');
    expect((await call('/api/cooperative-settings', 'PUT', settings(101), f.token)).status).toBe(400);

    // Lowering the ceiling revokes the allowance for subsequent sales.
    await ok('/api/cooperative-settings', 'PUT', settings(0), f.token);
    expect((await call('/api/satis', 'POST', sale(f.pid, 2, { indirim: '10' }), f.token)).status).toBe(400);
  });
  it('schedules the month-end stock report only in the Istanbul month-end window', async () => {
    const f = await adminFixture();
    const token = f.token;
    await ok(
      '/api/cooperative-settings',
      'PUT',
      { ...settings(0), stockReportEmail: 'reports@example.invalid', stockReportEnabled: true },
      token,
    );
    await ok('/api/uruns', 'POST', { urunAdi: 'Reported product', birim: 'ADET', stok: '4', musteriFiyati: '12.50', active: true }, token);
    const months = async () => (await rows('/api/report-files', token)).map(r => String(r.month));
    const baseline = (await months()).length;
    const cron = async (scheduledTime: string) => {
      const response = await call('/__test/cron', 'POST', { scheduledTime });
      expect(response.status, `cron ${scheduledTime}: ${await response.clone().text()}`).toBe(204);
    };

    // Mid-month the schedule must stay idle.
    await cron('2026-10-15T20:00:00.000Z');
    expect((await months()).length).toBe(baseline);

    // 23:00 Istanbul on the last day of the month produces exactly one report.
    await cron('2026-10-31T20:00:00.000Z');
    expect(await months()).toEqual(['2026-10']);

    // Repeating inside the same window is deduplicated by the monthly key.
    await cron('2026-10-31T20:05:00.000Z');
    expect((await months()).length).toBe(1);

    // The following month produces its own report.
    await cron('2026-11-30T20:00:00.000Z');
    expect((await months()).sort()).toEqual(['2026-10', '2026-11']);

    const [file] = await rows('/api/report-files', token);
    const download = await call(`/api/report-files/${file.id}`, 'GET', undefined, token);
    expect(download.status).toBe(200);
    expect(download.headers.get('content-type')).toContain('spreadsheetml');
  });
  it('invalidates sessions after password/role/deactivation changes and never accepts account tenant ownership', async () => {
    const f = await fixture(),
      account = await ok('/api/account', 'GET', undefined, f.token);
    expect(
      (
        await call(
          '/api/account',
          'POST',
          { email: `${f.login}@example.invalid`, tenantId: 1, authorities: ['ROLE_ADMIN'], firstName: 'Fixture', langKey: 'en' },
          f.token,
        )
      ).status,
    ).toBe(204);
    expect((await ok('/api/account', 'GET', undefined, f.token)).tenantId).toBe(f.tid);
    expect((await call('/api/tenants', 'GET', undefined, f.token)).status).toBe(403);
    expect(
      (await call('/api/account/change-password', 'POST', { currentPassword: password, newPassword: 'Synthetic-new-password-42' }, f.token))
        .status,
    ).toBe(204);
    expect((await call('/api/account', 'GET', undefined, f.token)).status).toBe(401);
    const token = String(
      (await ok('/api/authenticate', 'POST', { username: f.login, password: 'Synthetic-new-password-42' }, '')).id_token,
    );
    await ok('/api/admin/users', 'PUT', { ...account, authorities: ['ROLE_USER', 'ROLE_ADMIN'] });
    expect((await call('/api/account', 'GET', undefined, token)).status).toBe(401);
    const promoted = String(
      (await ok('/api/authenticate', 'POST', { username: f.login, password: 'Synthetic-new-password-42' }, '')).id_token,
    );
    expect((await call(`/api/admin/users/${f.login}`, 'DELETE', undefined)).status).toBe(204);
    expect((await call('/api/account', 'GET', undefined, promoted)).status).toBe(401);
  });
  it('queues reset email atomically, expires old credentials and consumes reset keys once', async () => {
    const f = await fixture();
    expect((await call('/api/account/reset-password/init', 'POST', `${f.login}@example.invalid`, '')).status).toBe(204);
    const db = await runtime.getD1Database('DIRECTORY'),
      user = await db.prepare('SELECT reset_key FROM users WHERE login=?').bind(f.login).first<{ reset_key: string }>();
    expect(user?.reset_key).toBeTruthy();
    expect(
      (await db.prepare('SELECT payload FROM directory_outbox WHERE payload LIKE ?').bind(`%${f.login}@example.invalid%`).all()).results,
    ).toHaveLength(1);
    expect(
      (await call('/api/account/reset-password/finish', 'POST', { key: user!.reset_key, newPassword: 'Synthetic-reset-password-42' }, ''))
        .status,
    ).toBe(204);
    expect(
      (await call('/api/account/reset-password/finish', 'POST', { key: user!.reset_key, newPassword: 'Synthetic-reset-password-43' }, ''))
        .status,
    ).toBe(400);
    expect((await call('/api/account', 'GET', undefined, f.token)).status).toBe(401);
    expect((await call('/api/authenticate', 'POST', { username: f.login, password: 'Synthetic-reset-password-42' }, '')).status).toBe(200);
  });
  it('recalculates invoice/shipping prices, stock, VAT producer debt and rolls back bad invoices', async () => {
    const f = await fixture(),
      producer = await ok('/api/ureticis', 'POST', { adi: 'Synthetic producer', bankaBilgileri: 'Fixture' }, f.token),
      vat = await ok('/api/kdv-kategorisis', 'POST', { kategoriAdi: 'Fixture VAT', kdvOrani: 10 }, f.token);
    await ok(`/api/uruns/${f.pid}`, 'PUT', { ...f.product, uretici: { id: producer.id }, kdvKategorisi: { id: vat.id } }, f.token);
    await ok('/api/urun-fiyat-hesaps', 'POST', { urun: { id: f.pid }, amortisman: 10 }, f.token);
    const invoice = { kargo: '10.00', fiyatHesapDTOList: [{ urunId: f.pid, miktar: 2, tutar: '20.00', agirlikAta: 1, yeniFiyat: '0' }] };
    expect((await call('/api/urun-fiyat-hesaps/yeni-fiyat', 'POST', invoice, f.token)).status).toBe(200);
    expect((await ok(`/api/uruns/${f.pid}`, 'GET', undefined, f.token)).musteriFiyati).toBe('16.50');
    expect(await stock(f.pid, f.token)).toBe('12');
    expect((await rows('/api/uretici-odemeleris', f.token))[0].tutar).toBe('22.00');
    expect(await cash(f.token)).toBe('100.00');
    const bad = {
      ...invoice,
      fiyatHesapDTOList: [...invoice.fiyatHesapDTOList, { urunId: 99999, miktar: 1, tutar: '5.00', agirlikAta: 1 }],
    };
    expect((await call('/api/urun-fiyat-hesaps/yeni-fiyat', 'POST', bad, f.token)).status).toBe(404);
    expect(await stock(f.pid, f.token)).toBe('12');
    expect((await rows('/api/uretici-odemeleris', f.token))[0].tutar).toBe('22.00');
  });
  it('preserves decimal precision above JavaScript safe integer limits', async () => {
    const f = await fixture();
    await ok(`/api/uruns/${f.pid}`, 'PUT', { ...f.product, musteriFiyati: '9007199254740993.25' }, f.token);
    const created = await ok('/api/satis', 'POST', sale(f.pid, 1), f.token);
    expect(created.toplamTutar).toBe('9007199254740993.25');
    expect(await cash(f.token)).toBe('9007199254741093.25');
    expect((await call(`/api/satis/${created.id}`, 'DELETE', undefined, f.token)).status).toBe(204);
    expect(await cash(f.token)).toBe('100.00');
  });
  it('honors query-string cancellation intent after closed shifts without changing historical closing', async () => {
    const f = await fixture();
    await ok('/api/nobet-hareketleris', 'POST', { acilisKapanis: 'ACILIS', kasa: '100.00' }, f.token);
    const created = await ok('/api/satis', 'POST', sale(f.pid), f.token);
    const closing = await ok('/api/nobet-hareketleris', 'POST', { acilisKapanis: 'KAPANIS', kasa: '120.00' }, f.token);
    await ok('/api/nobet-hareketleris', 'POST', { acilisKapanis: 'ACILIS', kasa: '120.00' }, f.token);
    expect(
      (await call(`/api/satis/${created.id}?neden=Synthetic%20cancellation&nakitSimdi=true`, 'DELETE', undefined, f.token)).status,
    ).toBe(204);
    expect(await cash(f.token)).toBe('100.00');
    expect(await stock(f.pid, f.token)).toBe('10');
    expect((await ok(`/api/satis/${created.id}`, 'GET', undefined, f.token)).iptal).toBe(true);
    expect((await ok(`/api/nobet-hareketleris/${closing.id}`, 'GET', undefined, f.token)).kapanisDokumu).toBe(closing.kapanisDokumu);
  });
  it('generates valid XLSX into R2 and prevents cross-tenant file download', async () => {
    const a = await fixture(),
      b = await fixture();
    await ok('/api/reports/stock-export', 'POST', {}, a.token);
    expect((await call('/__test/drain', 'POST', {})).status).toBe(204);
    const files = await rows('/api/report-files', a.token);
    expect(files).toHaveLength(1);
    const file = await call(`/api/report-files/${files[0].id}`, 'GET', undefined, a.token);
    expect(file.status).toBe(200);
    const zip = unzipSync(new Uint8Array(await file.arrayBuffer()));
    expect(strFromU8(zip['xl/worksheets/sheet1.xml'])).toContain('Synthetic product');
    expect(strFromU8(zip['xl/workbook.xml'])).toContain('sheet');
    expect((await call(`/api/report-files/${files[0].id}`, 'GET', undefined, b.token)).status).toBe(404);
  });
  it('publishes resumable imports only after references, every entity digest and balances reconcile', async () => {
    const tenant = await ok('/api/tenants', 'POST', { tenantName: 'Synthetic migration destination' }),
      tid = integer(tenant.id, true),
      login = `migrate${tid}`;
    await ok('/api/admin/users', 'POST', {
      login,
      email: `${login}@example.invalid`,
      password,
      tenantId: tid,
      activated: true,
      authorities: ['ROLE_USER'],
    });
    const token = String((await ok('/api/authenticate', 'POST', { username: login, password }, '')).id_token);
    const entities = Object.fromEntries(Object.keys(ENTITY_SPECS).map(k => [k, [] as Entity[]])) as Record<EntityKind, Entity[]>;
    entities.uruns = [
      {
        id: 50,
        tenantId: tid,
        urunAdi: 'Synthetic imported product',
        birim: 'ADET',
        stok: '123.5',
        musteriFiyati: '9007199254740993.25',
        active: true,
        satista: true,
      },
    ];
    entities['kasa-hareketleris'] = [{ id: 60, tenantId: tid, kasaMiktar: '456.78', tarih: '2026-01-01T00:00:00.000Z' }];
    const session = crypto.randomUUID(),
      expected = manifest(tid, entities, 0),
      base = { tenantId: tid, session };
    await ok('/api/admin/tenant-import/begin', 'POST', { ...base, schemaVersion: 1, expected });
    expect((await call('/api/uruns', 'GET', undefined, token)).status).toBe(503);
    const key = crypto.randomUUID();
    await ok('/api/admin/tenant-import/batch', 'POST', { ...base, kind: 'uruns', rows: entities.uruns }, adminToken, key);
    await ok('/api/admin/tenant-import/batch', 'POST', { ...base, kind: 'uruns', rows: entities.uruns }, adminToken, key);
    expect((await call('/api/admin/tenant-import/finish', 'POST', base)).status).toBe(409);
    expect((await call('/api/uruns', 'GET', undefined, token)).status).toBe(503);
    await ok('/api/admin/tenant-import/batch', 'POST', { ...base, kind: 'kasa-hareketleris', rows: entities['kasa-hareketleris'] });
    await ok('/api/admin/tenant-import/finish', 'POST', base);
    expect(await ok('/api/admin/tenant-reconciliation', 'POST', { tenantId: tid })).toEqual(expected);
    expect(await stock(50, token)).toBe('123.5');
    expect(await cash(token)).toBe('456.78');
    const created = await ok('/api/uruns', 'POST', { urunAdi: 'After import', birim: 'ADET', stok: '1', musteriFiyati: '1.00' }, token);
    expect(integer(created.id, true)).toBe(51);
    expect((await call('/api/admin/tenant-import/abort', 'POST', base)).status).toBe(409);
    expect(
      (await call('/api/admin/tenant-import/begin', 'POST', { ...base, session: crypto.randomUUID(), schemaVersion: 1, expected })).status,
    ).toBe(409);
  });
});
describe('Cloudflare indexed persistence queries and numeric boundaries', () => {
  it('paginates and sorts decimal values exactly, including negatives and values above 2^53', async () => {
    const f = await fixture();
    for (const amount of ['10.00', '2.00', '9007199254740993.25', '0.25'])
      await ok('/api/giders', 'POST', { tutar: amount, notlar: 'Synthetic sorting', giderTipi: 'DIGER', odemeAraci: 'BANKA' }, f.token);
    const first = await call('/api/giders?sort=tutar,asc&page=0&size=2', 'GET', undefined, f.token);
    expect(first.headers.get('x-total-count')).toBe('4');
    expect(
      list(await first.json())
        .map(object)
        .map(e => e.tutar),
    ).toEqual(['0.25', '2.00']);
    expect((await rows('/api/giders?sort=tutar,asc&page=1&size=2', f.token)).map(e => e.tutar)).toEqual(['10.00', '9007199254740993.25']);
    expect((await rows('/api/giders?sort=tutar,desc&size=2', f.token)).map(e => e.tutar)).toEqual(['9007199254740993.25', '10.00']);
    for (const balance of ['-0.25', '-10.00', '-2.00'])
      await ok('/api/kasa-hareketleris', 'POST', { kasaMiktar: balance, hareket: 'Synthetic signed sorting' }, f.token);
    expect((await rows('/api/kasa-hareketleris?sort=kasaMiktar,asc', f.token)).map(e => e.kasaMiktar)).toEqual([
      '-10.00',
      '-2.00',
      '-0.25',
      '100.00',
    ]);
    expect((await call('/api/giders?sort=__proto__,asc', 'GET', undefined, f.token)).status).toBe(400);
  });
  it('sorts relationship names against tenant-owned persisted records', async () => {
    const f = await fixture(),
      b = await ok('/api/ureticis', 'POST', { adi: 'B producer', bankaBilgileri: 'Fixture' }, f.token),
      a = await ok('/api/ureticis', 'POST', { adi: 'A producer', bankaBilgileri: 'Fixture' }, f.token);
    await ok(`/api/uruns/${f.pid}`, 'PUT', { ...f.product, uretici: { id: b.id } }, f.token);
    await ok(
      '/api/uruns',
      'POST',
      { urunAdi: 'Other product', birim: 'ADET', stok: '1', musteriFiyati: '1.00', uretici: { id: a.id } },
      f.token,
    );
    const result = await rows('/api/uruns?sort=uretici.adi,asc', f.token);
    expect(result.map(r => object(r.uretici).adi)).toEqual(['A producer', 'B producer']);
  });
  it('rejects monetary overflow atomically without changing stock, cash, or sale state', async () => {
    const f = await fixture();
    await ok(`/api/uruns/${f.pid}`, 'PUT', { ...f.product, musteriFiyati: '9000000000000000000.00' }, f.token);
    expect((await call('/api/satis', 'POST', sale(f.pid, 2), f.token)).status).toBe(400);
    expect(await stock(f.pid, f.token)).toBe('10');
    expect(await cash(f.token)).toBe('100.00');
    expect(await rows('/api/satis', f.token)).toHaveLength(0);
    expect(
      (
        await call(
          '/api/uruns',
          'POST',
          { urunAdi: 'Invalid huge number', birim: 'ADET', stok: '1e999999999', musteriFiyati: '1.00' },
          f.token,
        )
      ).status,
    ).toBe(400);
  });
});

describe('consistent Cloudflare business backup and restore', () => {
  it('freezes paginated backup contents while writes continue and restores exact ledgers/history into an empty D1 database', async () => {
    const f = await fixture();
    await ok('/api/satis', 'POST', sale(f.pid, 2), f.token);
    const run = await ok('/api/admin/tenant-backup/begin', 'POST', { tenantId: f.tid });
    const metadata = object(run.metadata),
      snapshot = Object.fromEntries(Object.keys(ENTITY_SPECS).map(k => [k, [] as Entity[]])) as Record<EntityKind, Entity[]>,
      history: JsonObject[] = [];
    expect((await call('/api/admin/tenant-backup/begin', 'POST', { tenantId: f.tid }, f.token)).status).toBe(403);
    await ok('/api/satis', 'POST', sale(f.pid, 1), f.token);
    for (const value of list(run.sections)) {
      const section = String(value);
      let after = 0;
      for (;;) {
        const page = await ok('/api/admin/tenant-backup/page', 'POST', { tenantId: f.tid, id: run.id, section, after, size: 1 });
        const records = list(page.rows).map(object);
        if (section === 'history') history.push(...records);
        else snapshot[section.slice(7) as EntityKind].push(...(records as Entity[]));
        if (page.done) break;
        expect(Number(page.next)).toBeGreaterThan(after);
        after = Number(page.next);
      }
    }
    const folder = await mkdtemp(join(tmpdir(), 'pirot-synthetic-backup-'));
    try {
      const filename = join(folder, 'tenant.json'),
        base = String(await runtime.ready);
      const result = await promisify(execFile)('bun', ['scripts/backup-tenant.ts', base, String(f.tid), filename], {
        env: { ...process.env, PIROT_MIGRATION_TOKEN: adminToken },
      });
      expect(result.stdout).toContain('checksums verified');
      expect((await stat(filename)).mode & 0o777).toBe(0o600);
      const exported = object(JSON.parse(await readFile(filename, 'utf8')));
      expect((list(object(exported.entities).uruns)[0] as JsonObject).stok).toBe('7');
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
    expect(snapshot.uruns[0].stok).toBe('8');
    expect(await stock(f.pid, f.token)).toBe('7');
    expect(manifest(f.tid, snapshot, history.length, history)).toEqual(metadata.expected);
    const directory = await runtime.getD1Database('DIRECTORY'),
      members = await directory
        .prepare('SELECT id,login,first_name AS firstName,last_name AS lastName,tenant_id AS tenantId FROM users WHERE tenant_id=?')
        .bind(f.tid)
        .all();
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
    const restored = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: bundled.outputFiles[0].text,
        compatibilityDate: '2026-10-01',
        compatibilityFlags: ['nodejs_compat'],
        durableObjects: { TENANTS: { className: 'CooperativeTenant', useSQLite: true } },
        d1Databases: ['DIRECTORY'],
        bindings: { ENVIRONMENT: 'development' },
      }),
    );
    const restoredDb = await restored.getD1Database('DIRECTORY');
    await applyMigrations(restoredDb);
    await restoredDb.prepare('INSERT INTO tenants(id,tenant_name) VALUES (?,?)').bind(f.tid, 'Synthetic restore cooperative').run();
    const namespace = await restored.getDurableObjectNamespace('TENANTS'),
      stub = namespace.get(namespace.idFromName(`tenant:${f.tid}`)),
      session = String(metadata.session);
    const restore = async (action: string, body: JsonObject) => {
      const response = await stub.fetch(`https://tenant/api/_internal/import/${action}`, {
        method: 'POST',
        headers: {
          'x-pirot-principal': JSON.stringify({ id: 0, login: 'restore-drill', tenantId: f.tid, authorities: ['ROLE_ADMIN'] }),
          'x-pirot-members': JSON.stringify(members.results),
          'content-type': 'application/json',
          'idempotency-key': crypto.randomUUID(),
        },
        body: JSON.stringify({ session, ...body }),
      });
      expect(response.status, await response.clone().text()).toBe(200);
      return object(await response.json());
    };
    try {
      await restore('begin', { schemaVersion: 1, tenantId: f.tid, expected: metadata.expected, settings: metadata.settings });
      for (const [kind, records] of Object.entries(snapshot)) if (records.length) await restore('batch', { kind, rows: records });
      if (history.length) await restore('history', { rows: history });
      expect((await restore('finish', {})).reconciliation).toEqual(metadata.expected);
    } finally {
      await restored.dispose();
    }
    await ok('/api/admin/tenant-backup/release', 'POST', { tenantId: f.tid, id: run.id });
    expect((await call('/api/admin/tenant-backup/page', 'POST', { tenantId: f.tid, id: run.id, section: 'history' })).status).toBe(404);
  });
});

describe('legacy report and financial entry-point parity', () => {
  it('serves monthly product/matrix and member VAT reports at Istanbul month boundaries', async () => {
    const f = await fixture(),
      vat = await ok('/api/kdv-kategorisis', 'POST', { kategoriAdi: 'Synthetic VAT', kdvOrani: 20 }, f.token),
      person = await ok('/api/kisilers', 'POST', { kisiAdi: 'Synthetic member', active: true }, f.token);
    await ok(`/api/uruns/${f.pid}`, 'PUT', { ...f.product, kdvKategorisi: { id: vat.id } }, f.token);
    await ok('/api/satis', 'POST', sale(f.pid, 2, { ortagaSatis: true, tarih: '2026-09-30T22:30:00.000Z' }), f.token);
    expect(await rows(`/api/satis-stok-hareketleris/getSatisRaporlari/${f.pid}`, f.token)).toEqual([
      { year: 2026, month: 10, urunAdi: 'Synthetic product', miktar: '2' },
    ]);
    const matrix = await ok('/api/satis-stok-hareketleris/getMaliSatisRaporlari', 'GET', undefined, f.token);
    expect(object(matrix.aylikSatisMap)['2026.10Synthetic product']).toBe('2');
    expect(list(matrix.tarihListesi)).toEqual(['2026-10-01T00:00:00+03:00']);
    expect((await rows('/api/reports/ortak-fatura-kisi-list?reportDate=2026-10', f.token))[0].id).toBe(person.id);
    const invoice = await ok(`/api/reports/ortak-fatura-kisi-ay?reportDate=2026-10&kisiId=${person.id}`, 'GET', undefined, f.token);
    expect(object(list(invoice.ortakFaturasiDetayDto)[0]).urunAdiKdv).toBe('Synthetic product %20');
    expect(invoice.tumToplamKdvHaric).toBe('16.66');
    expect(invoice.tumKdvToplami).toBe('3.33');
    expect(invoice.tumToplam).toBe('19.99');
    expect((await rows('/api/reports/ciro?fromDate=2026-10-01&toDate=2026-10-01', f.token))[0].tutar).toBe('20.00');
    const other = await fixture();
    const otherMatrix = await ok('/api/satis-stok-hareketleris/getMaliSatisRaporlari', 'GET', undefined, other.token);
    expect(otherMatrix.aylikSatisMap).toEqual({});
  });
  it('searches Turkish product names and authoritative users, including expenses and transfers', async () => {
    const f = await fixture(),
      account = await ok('/api/account', 'GET', undefined, f.token),
      date = '2026-09-30T22:30:00.000Z';
    await ok(`/api/uruns/${f.pid}`, 'PUT', { ...f.product, urunAdi: 'IŞIK İĞDE ÇÖREK ÜRÜN' }, f.token);
    expect(await rows('/api/_search/uruns?query=' + encodeURIComponent('ışık iğde çörek ürün'), f.token)).toHaveLength(1);
    await ok(
      '/api/giders',
      'POST',
      { tutar: '5.00', notlar: 'Synthetic report expense', giderTipi: 'DIGER', odemeAraci: 'BANKA', tarih: date },
      f.token,
    );
    await ok(
      '/api/virmen',
      'POST',
      { tutar: '5.00', notlar: 'Synthetic report transfer', cikisHesabi: 'BANKA', girisHesabi: 'KASA', tarih: date },
      f.token,
    );
    expect(await rows(`/api/_search/gider?query=${f.login}`, f.token)).toHaveLength(1);
    expect(await rows(`/api/_search/virman?query=${f.login}`, f.token)).toHaveLength(1);
    expect(await rows(`/api/giders/user-gider?userId=${account.id}&fromDate=2026-10-01`, f.token)).toHaveLength(1);
    expect((await ok(`/api/virmen/user-virman?userId=${account.id}&fromDate=2026-10-01`, 'GET', undefined, f.token)).tutar).toBe('5.00');
  });
  it('replaces and cancels a manual cash contribution without losing intervening financial movements', async () => {
    const f = await fixture(),
      original = (await rows('/api/kasa-hareketleris', f.token))[0];
    await ok('/api/satis', 'POST', sale(f.pid, 2), f.token);
    expect(await cash(f.token)).toBe('120.00');
    const replacement = await ok(
      `/api/kasa-hareketleris/${original.id}`,
      'PUT',
      { kasaMiktar: '125.00', hareket: 'Synthetic corrected opening' },
      f.token,
    );
    expect(replacement.kasaMiktar).toBe('145.00');
    expect(await cash(f.token)).toBe('145.00');
    expect((await call(`/api/kasa-hareketleris/${replacement.id}`, 'DELETE', undefined, f.token)).status).toBe(204);
    expect(await cash(f.token)).toBe('20.00');
    expect((await call(`/api/kasa-hareketleris/${replacement.id}`, 'DELETE', undefined, f.token)).status).toBe(403);
    expect(await cash(f.token)).toBe('20.00');
  });
  it('routes direct sale-line edits and deletion through the full stock/cash lifecycle', async () => {
    const f = await fixture(),
      created = await ok(
        '/api/satis',
        'POST',
        {
          stokHareketleriLists: [
            { urunId: f.pid, miktar: 1 },
            { urunId: f.pid, miktar: 1 },
          ],
        },
        f.token,
      ),
      lines = list(created.stokHareketleriLists).map(object);
    await ok(
      `/api/satis-stok-hareketleris/${lines[0].id}`,
      'PUT',
      { urun: { id: f.pid }, satis: { id: created.id }, miktar: 3, tutar: '0.00' },
      f.token,
    );
    expect(await stock(f.pid, f.token)).toBe('6');
    expect(await cash(f.token)).toBe('140.00');
    const updated = await ok(`/api/satis/${created.id}`, 'GET', undefined, f.token),
      current = list(updated.stokHareketleriLists).map(object),
      first = current.find(l => l.miktar === 1)!;
    expect((await call(`/api/satis-stok-hareketleris/${first.id}`, 'DELETE', undefined, f.token)).status).toBe(204);
    expect(await stock(f.pid, f.token)).toBe('7');
    expect(await cash(f.token)).toBe('130.00');
    const last = object(list((await ok(`/api/satis/${created.id}`, 'GET', undefined, f.token)).stokHareketleriLists)[0]);
    expect((await call(`/api/satis-stok-hareketleris/${last.id}`, 'DELETE', undefined, f.token)).status).toBe(400);
    expect(await cash(f.token)).toBe('130.00');
  });
});

describe('stock movement compensation and immutable refunds', () => {
  it('moves an edited stock entry between products, reverses deletion and rejects overspending stock atomically', async () => {
    const f = await fixture();
    const other = await ok(
      '/api/uruns',
      'POST',
      { urunAdi: 'Synthetic second product', birim: 'ADET', stok: '10', musteriFiyati: '10.00', active: true },
      f.token,
    );
    const otherId = integer(other.id, true);
    const movement = await ok(
      '/api/stok-girisis',
      'POST',
      { urun: { id: f.pid }, miktar: 5, stokHareketiTipi: 'STOK_GIRISI', notlar: 'Synthetic stock entry' },
      f.token,
    );
    expect(await stock(f.pid, f.token)).toBe('15');
    await ok(`/api/stok-girisis/${movement.id}`, 'PUT', { ...movement, urun: { id: otherId }, miktar: 3 }, f.token);
    expect(await stock(f.pid, f.token)).toBe('10');
    expect(await stock(otherId, f.token)).toBe('13');
    expect((await call(`/api/stok-girisis/${movement.id}`, 'DELETE', undefined, f.token)).status).toBe(204);
    expect(await stock(otherId, f.token)).toBe('10');
    const waste = await ok(
      '/api/stok-girisis',
      'POST',
      { urun: { id: f.pid }, miktar: 2, stokHareketiTipi: 'FIRE', notlar: 'Synthetic waste' },
      f.token,
    );
    expect(await stock(f.pid, f.token)).toBe('8');
    expect((await call(`/api/stok-girisis/${waste.id}`, 'PUT', { ...waste, miktar: 11 }, f.token)).status).toBe(409);
    expect(await stock(f.pid, f.token)).toBe('8');
    expect((await ok(`/api/stok-girisis/${waste.id}`, 'GET', undefined, f.token)).miktar).toBe(2);
    await ok(`/api/stok-girisis/${waste.id}`, 'PUT', { ...waste, miktar: 3 }, f.token);
    expect(await stock(f.pid, f.token)).toBe('7');
    expect((await call(`/api/stok-girisis/${waste.id}`, 'DELETE', undefined, f.token)).status).toBe(204);
    expect(await stock(f.pid, f.token)).toBe('10');
    expect(await cash(f.token)).toBe('100.00');
  });
  it('refunds cash once, permits note edits, and keeps historical refund effects immutable', async () => {
    const f = await fixture();
    const refund = await ok(
      '/api/stok-girisis',
      'POST',
      { urun: { id: f.pid }, miktar: 2, stokHareketiTipi: 'IADE', notlar: 'Synthetic refund' },
      f.token,
    );
    expect(await stock(f.pid, f.token)).toBe('12');
    expect(await cash(f.token)).toBe('80.00');
    await ok(`/api/stok-girisis/${refund.id}`, 'PUT', { ...refund, notlar: 'Reviewed synthetic refund' }, f.token);
    expect(await stock(f.pid, f.token)).toBe('12');
    expect(await cash(f.token)).toBe('80.00');
    expect((await call(`/api/stok-girisis/${refund.id}`, 'PUT', { ...refund, miktar: 3 }, f.token)).status).toBe(400);
    expect((await call(`/api/stok-girisis/${refund.id}`, 'DELETE', undefined, f.token)).status).toBe(400);
    expect(await stock(f.pid, f.token)).toBe('12');
    expect(await cash(f.token)).toBe('80.00');
  });
});

describe('HTTP request byte bounds', () => {
  it('rejects oversized authenticated financial and streamed authentication bodies before mutation', async () => {
    const f = await fixture();
    const rejected = await call('/api/satis', 'POST', { ...sale(f.pid), notlar: 'x'.repeat(2_000_000) }, f.token);
    expect(rejected.status).toBe(413);
    expect(await stock(f.pid, f.token)).toBe('10');
    expect(await cash(f.token)).toBe('100.00');
    expect(await rows('/api/satis', f.token)).toHaveLength(0);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"username":"fixture-admin","password":"'));
        controller.enqueue(new Uint8Array(2_000_000).fill(120));
        controller.enqueue(new TextEncoder().encode('"}'));
        controller.close();
      },
    });
    const streamedOptions = { method: 'POST', body, duplex: 'half' as const, headers: { 'content-type': 'application/json' } };
    const login = await runtime.dispatchFetch('https://pirot.test/api/authenticate', streamedOptions);
    expect(login.status).toBe(413);
    expect(((await login.json()) as { message: string }).message).toBe('error.invalidrequest');
  });
});
