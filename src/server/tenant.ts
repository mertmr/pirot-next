import { operationDate, operationId } from './operation-context';
import { D1TenantSql, d1Transaction } from './d1-store';
import { outboundEmailEnabled } from './email-policy';
import { DurableObject } from 'cloudflare:workers';
import type { Env, CurrentUser } from './env';
import { readRequestText } from './request-body';
import { TenantStore } from './storage';
import { BusinessService } from './business';
import { Shifts } from './shifts';
import { Reports } from './reports';
import { ENTITY_SPECS, type EntityKind } from './entity-specs';
import {
  BusinessError,
  type Entity,
  type JsonObject,
  type JsonValue,
  object,
  list,
  integer,
  text,
  refId,
  decimal,
  money,
  quarter,
  istanbulDay,
  dayRange,
} from './value';
import { errorResponse } from './errors';
import { page } from './query';
import { TenantMigration, reconciliation } from './migration';
import { TenantBackup } from './backup';
interface Result {
  data: JsonValue;
  status?: number;
  headers?: Record<string, string>;
}
class TenantHandler {
  constructor(
    readonly store: TenantStore,
    readonly env: Env,
  ) {}
  async fetch(request: Request): Promise<Response> {
    // This handler is reachable only through a Worker binding. The public Worker overwrites the principal header.
    const actor = object(JSON.parse(request.headers.get('x-pirot-principal') || 'null')) as unknown as CurrentUser;
    if (!Number.isSafeInteger(actor.id) || !actor.login || !Array.isArray(actor.authorities)) throw new BusinessError('unauthorized', 401);
    const url = new URL(request.url),
      method = request.method;
    let body: JsonValue = null;
    if (!['GET', 'HEAD'].includes(method)) {
      const raw = await readRequestText(request);
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        throw new BusinessError('invalidrequest');
      }
    }
    const mutating = !['GET', 'HEAD'].includes(method);
    const recordIdempotency = mutating && !url.pathname.endsWith('/backup/page');
    const key = request.headers.get('idempotency-key');
    if (mutating && (!key || key.length > 200)) throw new BusinessError('idempotencyrequired');
    const fingerprint = mutating
      ? Array.from(
          new Uint8Array(
            await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([method, url.pathname, url.search, body]))),
          ),
        )
          .map(b => b.toString(16).padStart(2, '0'))
          .join('')
      : '';
    const result = this.store.transaction(() => {
      this.store.assertTenant(actor);
      const members = request.headers.get('x-pirot-members');
      // Internal jobs call the tenant with a synthetic system principal and no directory payload, so
      // there is no member to snapshot for them. A real request always carries the directory list,
      // which includes the caller.
      this.store.syncUsers(
        members ? list(JSON.parse(members)).map(object) : actor.id > 0 ? [actor as unknown as JsonObject] : [],
        actor.tenantId,
      );
      if (key && recordIdempotency) {
        const old = this.store.sql
          .exec<{ fingerprint: string; response: string }>('SELECT fingerprint,response FROM idempotency WHERE key=?', `${actor.id}:${key}`)
          .toArray()[0];
        if (old) {
          if (old.fingerprint !== fingerprint) throw new BusinessError('idempotencyconflict', 409);
          return JSON.parse(old.response) as Result;
        }
      }
      const result = this.handle(url, method, body, actor);
      if (key && recordIdempotency)
        this.store.sql.exec(
          'INSERT INTO idempotency(key,fingerprint,response,created_at) VALUES (?,?,?,?)',
          `${actor.id}:${key}`,
          fingerprint,
          JSON.stringify(result),
          operationDate().toISOString(),
        );
      return result;
    });
    return result.status === 204
      ? new Response(null, { status: 204, headers: result.headers })
      : Response.json(result.data, { status: result.status ?? 200, headers: { 'cache-control': 'no-store', ...result.headers } });
  }
  handle(url: URL, method: string, body: JsonValue, actor: CurrentUser): Result {
    const path = url.pathname.replace(/^\/api\//, ''),
      parts = path.split('/'),
      service = new BusinessService(this.store, actor),
      shifts = new Shifts(this.store, actor),
      reports = new Reports(this.store);
    const request = () => object(body);
    const migration = new TenantMigration(this.store, actor);
    if (path.startsWith('_internal/import/')) return { data: migration.handle(parts[2], body ? request() : {}) };
    if (path === '_internal/reconciliation') {
      if (!actor.authorities.includes('ROLE_ADMIN')) throw new BusinessError('forbidden', 403);
      return { data: reconciliation(this.store) };
    }
    if (migration.state()?.status === 'importing') throw new BusinessError('importinprogress', 503);
    if (path.startsWith('_internal/backup/') && method === 'POST')
      return { data: new TenantBackup(this.store, actor).handle(parts[2], request()) };
    if (path === '_internal/outbox' && method === 'GET') {
      if (!actor.authorities.includes('ROLE_SYSTEM')) throw new BusinessError('forbidden', 403);
      return {
        data: this.store.sql
          .exec<{ id: string }>(
            `SELECT id FROM outbox WHERE delivered_at IS NULL AND (${outboundEmailEnabled(this.env) ? '1' : "json_extract(payload,'$.type')<>'email'"}) AND (queued_at IS NULL OR queued_at<?) ORDER BY created_at LIMIT 100`,
            new Date(operationDate().getTime() - 600000).toISOString(),
          )
          .toArray()
          .map(r => ({ id: r.id })),
      };
    }
    if (parts[0] === '_internal' && parts[1] === 'outbox' && parts.length === 3 && method === 'GET') {
      if (!actor.authorities.includes('ROLE_SYSTEM')) throw new BusinessError('forbidden', 403);
      const row = this.store.sql
        .exec<{ payload: string }>('SELECT payload FROM outbox WHERE id=? AND delivered_at IS NULL', parts[2])
        .toArray()[0];
      return row ? { data: object(JSON.parse(row.payload)) } : { data: null, status: 204 };
    }
    if (path === '_internal/outbox/queued' && method === 'POST') {
      if (!actor.authorities.includes('ROLE_SYSTEM')) throw new BusinessError('forbidden', 403);
      for (const id of list(request().ids))
        this.store.sql.exec('UPDATE outbox SET queued_at=? WHERE id=?', operationDate().toISOString(), text(id));
      return { data: null, status: 204 };
    }
    if (path === '_internal/outbox/ack' && method === 'POST') {
      if (!actor.authorities.includes('ROLE_SYSTEM')) throw new BusinessError('forbidden', 403);
      for (const id of list(request().ids))
        this.store.sql.exec('UPDATE outbox SET delivered_at=? WHERE id=?', operationDate().toISOString(), text(id));
      return { data: null, status: 204 };
    }
    if ((path === '_internal/monthly-stock-report' || path === 'reports/stock-export') && method === 'POST') {
      if (path.startsWith('_internal') && !actor.authorities.includes('ROLE_SYSTEM')) throw new BusinessError('forbidden', 403);
      const enabled = this.store.setting('stockReportEnabled') === 'true';
      if (path.startsWith('_internal') && !enabled) return { data: { skipped: true } };
      const month = path.startsWith('_internal')
        ? text(request().month)
        : new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit' }).format(operationDate());
      const id = operationId();
      this.store.enqueue({
        type: 'stock-report',
        id,
        tenantId: actor.tenantId,
        month,
        to: path.startsWith('_internal') && outboundEmailEnabled(this.env) ? this.store.setting('stockReportEmail') || null : null,
        products: this.store
          .all('uruns')
          .filter(p => p.active !== false)
          .map(p => ({ urunAdi: p.urunAdi, stok: p.stok ?? '0', musteriFiyati: p.musteriFiyati ?? '0', birim: p.birim })),
      });
      return { data: { id, status: 'queued' }, status: 202 };
    }
    if (path === '_internal/snapshot' && method === 'GET') {
      if (!actor.authorities.includes('ROLE_ADMIN') && !actor.authorities.includes('ROLE_SYSTEM'))
        throw new BusinessError('forbidden', 403);
      return {
        data: {
          tenantId: actor.tenantId,
          schemaVersion: 1,
          entities: Object.fromEntries(Object.keys(ENTITY_SPECS).map(k => [k, this.store.all(k as EntityKind)])),
          history: this.store.sql.exec('SELECT * FROM history ORDER BY id').toArray() as unknown as JsonValue,
        },
      };
    }
    if (path === 'cooperative-settings' || path === 'cooperative-operations') {
      if (!actor.authorities.includes('ROLE_ADMIN')) throw new BusinessError('forbidden', 403);
      if (path === 'cooperative-operations' && method === 'GET')
        return {
          data: {
            tenantId: actor.tenantId,
            emailEnabled: outboundEmailEnabled(this.env),
            schemaVersion: 2,
            entityCounts: Object.fromEntries(Object.keys(ENTITY_SPECS).map(k => [k, this.store.count(k as EntityKind)])),
            pendingJobs: this.store.sql
              .exec<{ n: number }>(
                `SELECT count(*) AS n FROM outbox WHERE delivered_at IS NULL AND (${outboundEmailEnabled(this.env) ? '1' : "json_extract(payload,'$.type')<>'email'"})`,
              )
              .one().n,
            historyRecords: this.store.sql.exec<{ n: number }>('SELECT count(*) AS n FROM history').one().n,
            databaseBytes: this.store.sql.databaseSize,
          },
        };
      if (method === 'GET')
        return {
          data: {
            stockReportEmail: this.store.setting('stockReportEmail'),
            stockReportEnabled: this.store.setting('stockReportEnabled') === 'true',
            maxDiscountPercent: this.store.setting('maxDiscountPercent', '0'),
          },
        };
      if (path === 'cooperative-settings' && method === 'PUT') {
        const input = request(),
          email = text(input.stockReportEmail).trim(),
          maxDiscountPercent = integer(input.maxDiscountPercent ?? 0);
        if (
          email.length > 254 ||
          (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) ||
          (input.stockReportEnabled && outboundEmailEnabled(this.env) && !email) ||
          maxDiscountPercent < 0 ||
          maxDiscountPercent > 100
        )
          throw new BusinessError('invalidrequest');
        const value = {
          stockReportEmail: email,
          stockReportEnabled: input.stockReportEnabled === true,
          maxDiscountPercent: String(maxDiscountPercent),
        };
        this.store.saveSettings(value);
        return { data: value };
      }
    }
    if (path === 'dashboard-reports' && method === 'GET') return { data: reports.dashboard() };
    if (parts[0] === 'reports' && method === 'GET') {
      const q = url.searchParams,
        from = q.get('fromDate') ?? '',
        to = q.get('toDate') ?? from;
      switch (parts.slice(1).join('/')) {
        case 'ciro':
          return { data: reports.ciro(from, to) };
        case 'ciro/by-nobetci':
          return { data: reports.ciro(from, from, true) };
        case 'ciro/nobetci-date':
          return {
            data: reports.ciro(from, from, true, integer(q.get('userId'), true))[0] ?? {
              tutar: '0.00',
              kartli: '0.00',
              nakit: '0.00',
              tarih: from,
              nobetci: '',
            },
          };
        case 'report-date-list':
          return { data: reports.months() };
        case 'ortak-fatura-kisi-list':
          return { data: reports.people(q.get('reportDate') ?? '') };
        case 'ortak-fatura-kisi-ay':
          return { data: reports.invoice(q.get('reportDate') ?? '', integer(q.get('kisiId'), true)) };
        case 'gun-sonu-raporu':
          return { data: reports.dayEnd(q.get('reportDate') ?? '') };
        case 'urunTukenmeHizi':
          return { data: reports.depletion(integer(q.get('urunId'), true), q.get('stokDate') ?? '') };
      }
    }
    if (parts[0] === 'nobet-duzeltmeler') {
      if (parts[1] === 'context' && method === 'GET') return { data: service.corrections.context(parts[2], integer(parts[3], true)) };
      if (parts[1] === 'nobet' && method === 'GET') return { data: service.corrections.forShift(integer(parts[2], true)) };
      if (parts[2] === 'odeme' && method === 'POST') return { data: service.corrections.settle(integer(parts[1], true)) };
    }
    if (method === 'GET' && path === 'satis-stok-hareketleris/getMaliSatisRaporlari') return { data: reports.monthlyMatrix() };
    if (method === 'GET' && parts[0] === 'satis-stok-hareketleris' && parts[1] === 'getSatisRaporlari')
      return { data: reports.monthlyProducts(integer(parts[2], true)) };
    if (method === 'GET' && (path === 'giders/user-gider' || path === 'virmen/user-virman')) {
      const kind = path.startsWith('giders') ? 'giders' : 'virmen',
        userId = integer(url.searchParams.get('userId'), true),
        [from, to] = dayRange(url.searchParams.get('fromDate') ?? '');
      const records = [
        ...this.store.rows(
          kind,
          "json_extract(data,'$.user.id')=? AND json_extract(data,'$.tarih')>=? AND json_extract(data,'$.tarih')<? AND coalesce(json_extract(data,'$.iptal'),0)=0",
          [userId, from, to],
        ),
      ].map(e => this.store.hydrate(kind, e));
      return { data: kind === 'giders' ? records : (records[0] ?? null) };
    }
    if (path === 'nobet-hareketleris/workflow' && method === 'GET') return { data: shifts.workflow() };
    if (path === 'nobet-hareketleris/acilis' && method === 'GET') {
      const userId = integer(url.searchParams.get('userId'), true),
        day = url.searchParams.get('fromDate') ?? '';
      const found = this.store
        .matching('nobet-hareketleris', 'user.id', userId)
        .filter(s => s.user && s.acilisKapanis === 'ACILIS' && istanbulDay(s.tarih) === day)
        .at(-1);
      if (!found) throw new BusinessError('notfound', 404);
      return { data: this.store.hydrate('nobet-hareketleris', found) };
    }
    if (path === 'urun-fiyat-hesaps/yeni-fiyat' && method === 'POST') {
      this.receiveInvoice(request(), service);
      return { data: null };
    }
    if (parts[0] === 'urun-fiyat-hesaps' && parts[1] === 'urun-fiyat-by-urun-id' && method === 'GET') {
      const pid = integer(parts[2], true);
      this.store.get('uruns', pid);
      const found = this.store.matching('urun-fiyat-hesaps', 'urun.id', pid)[0];
      if (!found) throw new BusinessError('notfound', 404);
      return { data: this.store.hydrate('urun-fiyat-hesaps', found) };
    }
    if (path === 'uruns/satis' && method === 'GET')
      return {
        data: this.store
          .all('uruns')
          .filter(e => e.active !== false && e.satista === true)
          .map(e => this.store.hydrate('uruns', e)),
      };
    if (path === 'uruns/stok-girisi' && method === 'GET')
      return {
        data: this.store
          .all('uruns')
          .filter(e => e.active !== false)
          .map(e => this.store.hydrate('uruns', e)),
      };
    if (path === 'findOnlyStokGirisiByUrun' && method === 'GET') {
      const id = integer(url.searchParams.get('id'), true);
      this.store.get('uruns', id);
      return {
        data: this.store
          .matching('stok-girisis', 'urun.id', id)
          .filter(s => s.stokHareketiTipi === 'STOK_GIRISI')
          .map(s => ({
            stokGirisiId: s.id,
            miktar: s.miktar,
            stokGirisAciklamasi: `Miktar: ${s.miktar} - Tarihi: ${s.tarih}`,
            stokGirisiTarihi: s.tarih,
          })),
      };
    }
    if (parts[0] === '_search' || path === 'searchStokGirisiByUrun') {
      if (method !== 'GET') throw new BusinessError('notfound', 404);
      const aliases: Record<string, EntityKind> = { uruns: 'uruns', satis: 'satis', gider: 'giders', virman: 'virmen' };
      const kind = path === 'searchStokGirisiByUrun' ? 'stok-girisis' : Object.hasOwn(aliases, parts[1]) ? aliases[parts[1]] : null;
      if (!kind) throw new BusinessError('notfound', 404);
      const query = (url.searchParams.get('query') ?? '').toLocaleLowerCase('tr');
      if (query.length > 1000) throw new BusinessError('invalidrequest');
      const lower = (field: string) => {
        let result = field;
        for (const [upper, lower] of [
          ['I', 'ı'],
          ['İ', 'i'],
          ['Ç', 'ç'],
          ['Ğ', 'ğ'],
          ['Ö', 'ö'],
          ['Ş', 'ş'],
          ['Ü', 'ü'],
        ])
          result = `replace(${result},'${upper}','${lower}')`;
        return `lower(${result})`;
      };
      const condition =
        kind === 'uruns'
          ? `coalesce(json_extract(e.data,'$.active'),1)<>0 AND instr(${lower("json_extract(e.data,'$.urunAdi')")},?)>0`
          : kind === 'stok-girisis'
            ? `json_extract(e.data,'$.urun.id') IN (SELECT id FROM entities WHERE kind='uruns' AND instr(${lower("json_extract(data,'$.urunAdi')")},?)>0)`
            : `json_extract(e.data,'$.user.id') IN (SELECT id FROM users_snapshot WHERE instr(lower(json_extract(data,'$.login')),?)>0)`;
      return page(this.store, kind, url, condition, [query]);
    }
    const kind = parts[0] as EntityKind;
    if (!Object.hasOwn(ENTITY_SPECS, kind)) throw new BusinessError('notfound', 404);
    if (parts[2] === 'collect-payment' && method === 'POST') {
      const id = integer(parts[1], true),
        saleId =
          kind === 'satis'
            ? id
            : kind === 'borc-alacaks'
              ? refId(this.store.get(kind, id).satis)
              : (() => {
                  throw new BusinessError('notfound', 404);
                })();
      const sale = service.collectSale(saleId, url.searchParams.get('paymentMethod') ?? 'NAKIT');
      return { data: kind === 'satis' ? sale : this.store.hydrate('borc-alacaks', service.debt(saleId)!) };
    }
    const id = parts[1] ? integer(parts[1], true) : method === 'PUT' && kind === 'satis' ? integer(request().id, true) : undefined;
    if (method === 'GET') {
      if (id) return { data: this.store.hydrate(kind, this.store.get(kind, id)) };
      return page(this.store, kind, url, kind === 'uruns' ? "coalesce(json_extract(data,'$.active'),1)<>0" : '1');
    }
    if (method === 'DELETE') {
      if (!id) throw new BusinessError('invalidrequest');
      const intent = body
        ? request()
        : url.searchParams.has('neden')
          ? { neden: url.searchParams.get('neden'), nakitSimdi: url.searchParams.get('nakitSimdi') === 'true' }
          : undefined;
      if (kind === 'satis') service.deleteSale(id, intent);
      else if (kind === 'stok-girisis') service.deleteStock(id);
      else if (kind === 'giders' || kind === 'virmen') service.deleteFinancial(kind, id, intent);
      else if (kind === 'nobet-hareketleris') throw new BusinessError('shiftimmutable');
      else if (kind === 'satis-stok-hareketleris') this.modifyLine(service, null, id);
      else if (kind === 'kasa-hareketleris') this.deleteCash(id, service);
      else service.deleteGeneric(kind, id);
      return { data: null, status: 204 };
    }
    if (!['POST', 'PUT', 'PATCH'].includes(method)) throw new BusinessError('notfound', 404);
    if (method === 'POST' && (id || request().id != null)) throw new BusinessError('invalidrequest');
    if (method !== 'POST' && !id) throw new BusinessError('invalidrequest');
    let payload = request();
    if (id && method === 'PATCH')
      payload = { ...this.store.get(kind, id), ...Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== null)) };
    if (id && payload.id != null && integer(payload.id, true) !== id) throw new BusinessError('invalidrequest');
    const entity =
      kind === 'satis'
        ? service.saveSale(payload, id, url.searchParams.get('paymentNote') ?? undefined)
        : kind === 'stok-girisis'
          ? service.saveStock(payload, id)
          : kind === 'giders' || kind === 'virmen'
            ? service.saveFinancial(kind, payload, id)
            : kind === 'nobet-hareketleris'
              ? shifts.save(payload, id)
              : kind === 'satis-stok-hareketleris'
                ? this.modifyLine(service, payload, id)
                : kind === 'kasa-hareketleris'
                  ? this.saveCash(payload, id, service)
                  : service.saveGeneric(kind, payload, id);
    return {
      data: entity,
      status: method === 'POST' ? 201 : 200,
      headers: method === 'POST' ? { location: `/api/${kind}/${entity.id}` } : {},
    };
  }
  modifyLine(service: BusinessService, request: JsonObject | null, id?: number): Entity {
    const old = id ? this.store.get('satis-stok-hareketleris', id) : null;
    const saleId = old ? refId(old.satis) : refId(request!.satis);
    if (old && request?.satis && refId(request.satis) !== saleId) throw new BusinessError('invalidrequest');
    const sale = this.store.get('satis', saleId);
    if (sale.iptal || service.corrections.closing('satis', sale) != null) throw new BusinessError('correctionrequired');
    const lines = service
      .lines(saleId)
      .filter(l => l.id !== id)
      .map(l => ({ urunId: refId(l.urun), miktar: l.miktar }));
    const productId = request ? refId(request.urun) : null;
    if (request) lines.push({ urunId: productId!, miktar: integer(request.miktar, true) });
    const updated = service.saveSale({ ...sale, stokHareketleriLists: lines }, saleId);
    if (!request) return updated;
    const line = list(updated.stokHareketleriLists)
      .map(object)
      .findLast(l => l.urun && refId(l.urun) === productId && l.miktar === integer(request.miktar, true));
    if (!line) throw new BusinessError('notfound', 404);
    return line as Entity;
  }
  saveCash(request: JsonObject, id: number | undefined, service: BusinessService): Entity {
    const before = id ? this.store.get('kasa-hareketleris', id) : null;
    const prior = before ? structuredClone(before) : null;
    if (before && (!before.manual || before.iptal)) throw new BusinessError('forbidden', 403);
    const latest = this.store.latest('kasa-hareketleris');
    const current = decimal(latest?.kasaMiktar, '0');
    const delta =
      request.degisimTutari != null
        ? decimal(money(request.degisimTutari))
        : before
          ? decimal(money(request.kasaMiktar)).minus(decimal(before.kasaMiktar)).plus(decimal(before.degisimTutari, '0'))
          : decimal(money(request.kasaMiktar)).minus(current);
    const message = text(request.hareket).trim();
    if (!message || message.length > 5000) throw new BusinessError('invalidrequest');
    if (before) {
      service.corrections.cash(decimal(before.degisimTutari, '0').negated().toFixed(2), 'Manuel kasa hareketi geri alındı', 'DIGER');
      before.iptal = true;
      this.store.put('kasa-hareketleris', before);
    }
    const row: Entity = {
      id: this.store.next('kasa-hareketleris'),
      tenantId: service.actor.tenantId,
      manual: true,
      kasaMiktar: money(
        current
          .minus(before ? decimal(before.degisimTutari, '0') : 0)
          .plus(delta)
          .toFixed(2),
      ),
      degisimTutari: delta.toFixed(2),
      hareket: message,
      hareketTipi: 'DIGER',
      tarih: operationDate().toISOString(),
    };
    this.store.put('kasa-hareketleris', row);
    this.store.audit('kasa-hareketleris', row.id, service.actor, before ? 'REPLACE' : 'CREATE', prior, row);
    return row;
  }
  deleteCash(id: number, service: BusinessService) {
    const row = this.store.get('kasa-hareketleris', id),
      before = structuredClone(row);
    if (!row.manual || row.iptal) throw new BusinessError('forbidden', 403);
    service.corrections.cash(decimal(row.degisimTutari, '0').negated().toFixed(2), 'Manuel kasa hareketi iptal edildi', 'DIGER');
    row.iptal = true;
    this.store.put('kasa-hareketleris', row);
    this.store.audit('kasa-hareketleris', id, service.actor, 'CANCEL', before, row);
  }
  receiveInvoice(request: JsonObject, service: BusinessService) {
    const rows = list(request.fiyatHesapDTOList).map(object);
    if (!rows.length || rows.length > 500) throw new BusinessError('invalidrequest');
    const shipping = decimal(money(request.kargo ?? '0'));
    if (shipping.lt(0) || shipping.decimalPlaces() > 2) throw new BusinessError('invalidamount');
    const weight = rows.reduce((sum, r) => sum.plus(decimal(r.agirlikAta, '0')), decimal('0'));
    if (shipping.gt(0) && weight.lte(0)) throw new BusinessError('invalidquantity');
    for (const row of rows) {
      const product = this.store.get('uruns', integer(row.urunId, true)),
        quantity = integer(row.miktar, true),
        invoiceTotal = decimal(money(row.tutar, true));
      const config = this.store.matching('urun-fiyat-hesaps', 'urun.id', product.id)[0];
      if (!config || !product.uretici) throw new BusinessError('notfound', 404);
      const markup = ['amortisman', 'giderPusulaMustahsil', 'dukkanGider', 'kooperatifCalisma', 'dayanisma', 'fire'].reduce(
        (sum, k) => sum.plus(decimal(config[k], '0')),
        decimal('0'),
      );
      const share = shipping.isZero() ? decimal('0') : decimal(row.agirlikAta, '0').div(weight).times(shipping);
      if (share.lt(0)) throw new BusinessError('invalidamount');
      const price = quarter(
        invoiceTotal
          .plus(share)
          .div(product.birim === 'GRAM' ? decimal(quantity).div(1000) : quantity)
          .times(decimal('1').plus(markup.div(100))),
      );
      const before = structuredClone(product);
      product.musteriFiyati = price;
      this.store.put('uruns', product);
      this.store.audit('uruns', product.id, service.actor, 'PRICE', before, product);
      service.saveGeneric('urun-fiyats', { urun: { id: product.id }, fiyat: price });
      service.saveStock({ urun: { id: product.id }, miktar: quantity, notlar: 'Faturali Stok Girisi', stokHareketiTipi: 'STOK_GIRISI' });
      const rate = product.kdvKategorisi ? decimal(this.store.get('kdv-kategorisis', refId(product.kdvKategorisi)).kdvOrani) : decimal('0');
      const total = invoiceTotal.times(decimal('1').plus(rate.div(100))).toFixed(2);
      let payment = this.store.matching('uretici-odemeleris', 'uretici.id', refId(product.uretici))[0];
      const previous = payment ? structuredClone(payment) : null;
      if (!payment) payment = { ...service.newEntity('uretici-odemeleris'), uretici: { id: refId(product.uretici) }, tutar: '0.00' };
      payment.tutar = money(decimal(payment.tutar).plus(total).toFixed(2));
      payment.sonGuncellenmeTarihi = operationDate().toISOString();
      this.store.put('uretici-odemeleris', payment);
      this.store.audit('uretici-odemeleris', payment.id, service.actor, 'INVOICE', previous, payment);
    }
  }
}

export class CooperativeTenant extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    try {
      const actor = object(JSON.parse(request.headers.get('x-pirot-principal') || 'null')) as unknown as CurrentUser;
      if (
        !Number.isSafeInteger(actor.tenantId) ||
        actor.tenantId <= 0 ||
        !Number.isSafeInteger(actor.id) ||
        !actor.login ||
        !Array.isArray(actor.authorities)
      )
        throw new BusinessError('unauthorized', 401);
      const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await readRequestText(request);
      return await d1Transaction(this.env.DIRECTORY, actor.tenantId, async (sql: D1TenantSql) => {
        const store = new TenantStore(sql, { transactionSync: run => run() }, outboundEmailEnabled(this.env));
        store.initialize();
        return new TenantHandler(store, this.env).fetch(
          new Request(request.url, { method: request.method, headers: request.headers, body }),
        );
      });
    } catch (error) {
      return errorResponse(error, request);
    }
  }
}
