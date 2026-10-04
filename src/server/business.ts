import { operationDate } from './operation-context';
import { ENTITY_SPECS, type EntityKind } from './entity-specs';
import { TenantStore } from './storage';
import { Corrections } from './corrections';
import type { CurrentUser } from './env';
import {
  BusinessError,
  Decimal,
  type Entity,
  type JsonObject,
  object,
  list,
  text,
  integer,
  refId,
  decimal,
  money,
  quarter,
  date,
  flag,
  requireEnum,
  clone,
} from './value';
const moneyFields = new Set([
  'musteriFiyati',
  'fiyat',
  'tutar',
  'toplamTutar',
  'kasaMiktar',
  'degisimTutari',
  'kasa',
  'pirot',
  'fark',
  'farkDenge',
  'kasaDegisimi',
  'bekleyenKasa',
]);
const historicalFields = new Set(['nobetAcilisId', 'iptal', 'duzeltildi', 'acilisId', 'kapanisDokumu']);

/**
 * Parses a cooperative setting that is stored as text. An absent or unreadable value
 * becomes zero, so introducing a rule can only ever narrow what the application allows.
 */
function configuredDecimal(raw: string): Decimal {
  try {
    return decimal(raw);
  } catch {
    return new Decimal(0);
  }
}
interface FieldSpec {
  type: string;
  required: boolean;
  target?: string;
  values?: readonly string[];
  maxLength?: number;
}
export class BusinessService {
  readonly corrections: Corrections;
  constructor(
    readonly store: TenantStore,
    readonly actor: CurrentUser,
  ) {
    this.corrections = new Corrections(store, actor);
  }
  newEntity(kind: EntityKind): Entity {
    return { id: this.store.next(kind), tenantId: this.actor.tenantId };
  }
  sanitize(kind: EntityKind, request: JsonObject, existing?: Entity): Entity {
    const result: Entity = existing ? clone(existing) : this.newEntity(kind);
    for (const [field, raw] of Object.entries(ENTITY_SPECS[kind].fields)) {
      const spec = raw as FieldSpec;
      if (field === 'user' || historicalFields.has(field)) continue;
      const value = request[field];
      if (value === undefined) {
        if (spec.required && result[field] == null) throw new BusinessError('invalidrequest');
        continue;
      }
      if (value === null) {
        if (spec.required) throw new BusinessError('invalidrequest');
        result[field] = null;
        continue;
      }
      switch (spec.type) {
        case 'string': {
          const v = text(value);
          if (v.length > (spec.maxLength ?? 5000) || (spec.required && !v.trim())) throw new BusinessError('invalidrequest');
          result[field] = v;
          break;
        }
        case 'integer':
          result[field] = integer(value);
          break;
        case 'boolean':
          result[field] = flag(value);
          break;
        case 'date':
          result[field] = date(value);
          break;
        case 'enum':
          result[field] = requireEnum(value, spec.values ?? []);
          break;
        case 'decimal':
          result[field] = moneyFields.has(field) ? money(value) : decimal(value).toString();
          break;
        case 'relation': {
          const id = refId(value);
          if (spec.target === 'users') {
            const user = this.store.user(id);
            if (user.tenantId !== this.actor.tenantId) throw new BusinessError('forbidden', 403);
          } else if (spec.target && spec.target in ENTITY_SPECS) this.store.get(spec.target as EntityKind, id);
          else throw new BusinessError('invalidrequest');
          result[field] = { id };
          break;
        }
        default:
          throw new BusinessError('invalidrequest');
      }
    }
    if ('user' in ENTITY_SPECS[kind].fields && !existing) result.user = this.store.user(this.actor.id);
    if ('tarih' in ENTITY_SPECS[kind].fields && result.tarih == null) result.tarih = operationDate().toISOString();
    return result;
  }
  saveGeneric(kind: EntityKind, request: JsonObject, id?: number): Entity {
    if (id === undefined && request.id != null) throw new BusinessError('invalidrequest');
    const before = id === undefined ? null : this.store.get(kind, id);
    if (id !== undefined && request.id != null && integer(request.id, true) !== id) throw new BusinessError('invalidrequest');
    if (kind === 'satis-stok-hareketleris' || kind === 'nobet-duzeltmeler' || kind === 'kasa-hareketleris')
      throw new BusinessError('forbidden', 403);
    if (kind === 'borc-alacaks' && (request.satis || before?.satis)) throw new BusinessError('salelinkeddebt');
    const result = this.sanitize(kind, request, before ?? undefined);
    if (kind === 'uruns') {
      result.active = flag(result.active, true);
      result.stok = decimal(result.stok, '0').toString();
      if (decimal(result.stok).lt(0) || decimal(result.stokSiniri, '0').lt(0) || decimal(result.musteriFiyati, '0').lt(0))
        throw new BusinessError('invalidstock');
      result.stokSiniri = decimal(result.stokSiniri, '0').toString();
    }
    if (kind === 'kisilers') result.active = flag(result.active, true);
    if (kind === 'kdv-kategorisis' && (integer(result.kdvOrani) < 0 || integer(result.kdvOrani) > 100))
      throw new BusinessError('invalidrequest');
    if (kind === 'urun-fiyat-hesaps') {
      for (const f of ['amortisman', 'giderPusulaMustahsil', 'dukkanGider', 'kooperatifCalisma', 'dayanisma', 'fire']) {
        result[f] = integer(result[f] ?? 0);
        if (Number(result[f]) < 0 || Number(result[f]) > 1000) throw new BusinessError('invalidrequest');
      }
      if (result.urun && this.store.matching(kind, 'urun.id', refId(result.urun)).some(v => v.id !== result.id))
        throw new BusinessError('duplicate', 409);
    }
    if (kind === 'borc-alacaks' && result.tutar != null) result.tutar = money(result.tutar, true);
    this.store.put(kind, result);
    if (kind === 'urun-fiyat-hesaps' && result.urun) {
      const product = this.store.get('uruns', refId(result.urun));
      if (before?.urun && refId(before.urun) !== product.id) {
        const old = this.store.get('uruns', refId(before.urun));
        old.urunFiyatHesap = null;
        this.store.put('uruns', old);
      }
      product.urunFiyatHesap = { id: result.id };
      this.store.put('uruns', product);
    }
    this.store.audit(kind, result.id, this.actor, before ? 'UPDATE' : 'CREATE', before, result);
    return this.store.hydrate(kind, result);
  }
  deleteGeneric(kind: EntityKind, id: number) {
    const before = this.store.get(kind, id);
    if (['satis-stok-hareketleris', 'nobet-duzeltmeler', 'kasa-hareketleris'].includes(kind)) throw new BusinessError('forbidden', 403);
    if (kind === 'borc-alacaks' && before.satis) throw new BusinessError('salelinkeddebt');
    if (kind === 'uruns') {
      const after = clone(before);
      after.active = false;
      this.store.put(kind, after);
      this.store.audit(kind, id, this.actor, 'DEACTIVATE', before, after);
      return;
    }
    for (const [other, spec] of Object.entries(ENTITY_SPECS))
      for (const [field, raw] of Object.entries(spec.fields)) {
        const fieldSpec = raw as FieldSpec;
        if (fieldSpec.target === kind && this.store.count(other as EntityKind, `json_extract(data,'$.${field}.id')=?`, [id]) > 0) {
          if (kind === 'urun-fiyat-hesaps' && other === 'uruns') continue;
          throw new BusinessError('referenced', 409);
        }
      }
    if (kind === 'urun-fiyat-hesaps' && before.urun) {
      const product = this.store.get('uruns', refId(before.urun));
      product.urunFiyatHesap = null;
      this.store.put('uruns', product);
    }
    this.store.remove(kind, id);
    this.store.audit(kind, id, this.actor, 'DELETE', before, null);
  }
  lines(saleId: number): Entity[] {
    return this.store.matching('satis-stok-hareketleris', 'satis.id', saleId);
  }
  debt(saleId: number): Entity | null {
    return this.store.matching('borc-alacaks', 'satis.id', saleId)[0] ?? null;
  }
  saleCash(sale: Entity): Decimal {
    if (sale.sonraOdeme) {
      const debt = this.debt(sale.id);
      if (!debt) throw new BusinessError('salelinkeddebt');
      return sale.odendi && debt.odemeAraci === 'NAKIT' ? decimal(sale.toplamTutar) : new Decimal(0);
    }
    return sale.kartliSatis ? new Decimal(0) : decimal(sale.toplamTutar);
  }
  stock(product: Entity, change: Decimal) {
    const before = clone(product);
    const stock = decimal(product.stok);
    if (stock.lt(0) || stock.plus(change).lt(0)) throw new BusinessError('insufficientstock', 409);
    product.stok = stock.plus(change).toString();
    this.store.put('uruns', product);
    this.store.audit('uruns', product.id, this.actor, 'STOCK', before, product);
  }
  saveSale(request: JsonObject, id?: number, note?: string): Entity {
    if (id === undefined && request.id != null) throw new BusinessError('invalidrequest');
    const before = id === undefined ? null : this.store.get('satis', id);
    const audit = before ? this.corrections.begin('satis', before, request.duzeltme, 'DUZELTME') : null;
    const oldCash = before ? this.saleCash(before) : new Decimal(0);
    const oldLines = before ? this.lines(before.id) : [];
    const requested = list(request.stokHareketleriLists).map(v => object(v));
    if (!requested.length || requested.length > 500) throw new BusinessError('invalidrequest');
    if (note && note.trim().length > 500) throw new BusinessError('invalidrequest');
    const deferred = before ? flag(before.sonraOdeme) : flag(request.sonraOdeme);
    if (before && request.sonraOdeme != null && flag(request.sonraOdeme) !== deferred) throw new BusinessError('invalidpayment');
    if (deferred && flag(request.kartliSatis) && (!before || !before.odendi)) throw new BusinessError('invalidpayment');
    const previous = new Map<number, Decimal>(),
      next = new Map<number, Decimal>();
    for (const line of oldLines) {
      const pid = refId(line.urun);
      previous.set(pid, (previous.get(pid) ?? new Decimal(0)).plus(integer(line.miktar, true)));
    }
    for (const line of requested) {
      const pid = integer(line.urunId, true),
        q = integer(line.miktar, true);
      next.set(pid, (next.get(pid) ?? new Decimal(0)).plus(q));
    }
    // One read covers every product the old and new lines touch, so the cost does not scale with
    // the number of lines.
    const touched = [...new Set([...previous.keys(), ...next.keys()])].sort((a, b) => a - b),
      loaded = this.store.select('uruns', touched),
      products = new Map<number, Entity>();
    for (const pid of touched) {
      const product = loaded.get(pid);
      if (!product) throw new BusinessError('notfound', 404);
      if (next.has(pid) && product.active === false) throw new BusinessError('notfound', 404);
      if (product.musteriFiyati == null || decimal(product.musteriFiyati).lt(0)) throw new BusinessError('invalidamount');
      if (
        decimal(product.stok)
          .plus(previous.get(pid) ?? 0)
          .lt(next.get(pid) ?? 0)
      )
        throw new BusinessError('insufficientstock', 409);
      products.set(pid, product);
    }
    let discount = decimal(request.indirim, '0');
    if (before && request.indirim == null) {
      const subtotal = oldLines.reduce((sum, l) => sum.plus(decimal(l.tutar)), new Decimal(0));
      discount = subtotal.gt(0)
        ? new Decimal(100).minus(decimal(before.toplamTutar).times(100).div(subtotal).toDecimalPlaces(6)).clamp(0, 100)
        : new Decimal(0);
    }
    // The ceiling is read before parsing: a read that only D1 can satisfy is signalled by
    // throwing, so the store call must stay out of the try in configuredDecimal.
    const ceiling = configuredDecimal(this.store.setting('maxDiscountPercent', '0'));
    if (discount.lt(0) || discount.gt(100) || discount.gt(ceiling)) throw new BusinessError('invaliddiscount');
    const sale: Entity = before ? clone(before) : this.newEntity('satis');
    sale.tarih = audit ? before!.tarih : date(request.tarih, before ? text(before.tarih) : undefined);
    sale.ortagaSatis = flag(request.ortagaSatis);
    sale.sonraOdeme = deferred;
    sale.kartliSatis = before && deferred ? flag(before.kartliSatis) : flag(request.kartliSatis);
    sale.odendi = before ? flag(before.odendi) : !deferred;
    sale.iptal = false;
    sale.duzeltildi = !!audit || flag(before?.duzeltildi);
    sale.indirim = discount.toString();
    if (!audit) sale.user = this.store.user(this.actor.id);
    if (!before) sale.nobetAcilisId = this.corrections.activeOpening()?.id ?? null;
    if (sale.ortagaSatis) {
      if (!before?.ortagaSatis) {
        const people = this.store.all('kisilers').filter(p => p.active !== false);
        if (!people.length) throw new BusinessError('notfound', 404);
        sale.kisi = { id: people[Math.floor(Math.random() * people.length)].id };
      }
    } else sale.kisi = null;
    const lines = requested.map(line => {
      const product = products.get(integer(line.urunId, true))!;
      const q = integer(line.miktar, true);
      const price = decimal(product.musteriFiyati)
        .times(q)
        .div(product.birim === 'GRAM' ? 1000 : 1);
      return {
        ...this.newEntity('satis-stok-hareketleris'),
        urun: { id: product.id },
        satis: { id: sale.id },
        miktar: q,
        tutar: money(quarter(price)),
        tarih: sale.tarih,
      } as Entity;
    });
    const subtotal = lines.reduce((sum, l) => sum.plus(decimal(l.tutar)), new Decimal(0));
    sale.toplamTutar = money(quarter(subtotal.times(new Decimal(100).minus(discount).div(100).toDecimalPlaces(6))));
    for (const [pid, product] of products) this.stock(product, (previous.get(pid) ?? new Decimal(0)).minus(next.get(pid) ?? 0));
    for (const line of oldLines) this.store.remove('satis-stok-hareketleris', line.id);
    this.store.put('satis', sale);
    for (const line of lines) this.store.put('satis-stok-hareketleris', line);
    if (deferred) {
      let debt = before ? this.debt(sale.id) : null;
      if (before && !debt) throw new BusinessError('salelinkeddebt');
      if (!debt)
        debt = {
          ...this.newEntity('borc-alacaks'),
          satis: { id: sale.id },
          tutar: sale.toplamTutar,
          notlar: note?.trim() || `Satış sonrası ödeme - ${sale.id}`,
          odemeAraci: 'SONRA_ODEME',
          hareketTipi: 'BORC',
          tarih: operationDate().toISOString(),
          user: sale.user,
        };
      debt.tutar = sale.toplamTutar;
      this.store.put('borc-alacaks', debt);
    }
    const delta = this.saleCash(sale).minus(oldCash);
    if (audit && !audit.nakitSimdi && delta.gt(0)) {
      sale.odendi = false;
      this.store.put('satis', sale);
    }
    this.corrections.finish(
      'satis',
      audit,
      sale,
      delta.toFixed(2),
      deferred ? 'TAHSILAT' : 'SATIS',
      before ? 'Satis Guncellemesi' : 'Satis Yapildi',
    );
    this.store.audit('satis', sale.id, this.actor, before ? 'UPDATE' : 'CREATE', before, sale);
    if (!before)
      for (const [pid, product] of products) {
        if (
          !next.has(pid) ||
          !product.urunSorumlusu ||
          decimal(product.stokSiniri, '0').lte(0) ||
          decimal(product.stok).gt(decimal(product.stokSiniri))
        )
          continue;
        const member = this.store.sql
          .exec<{ data: string }>('SELECT data FROM users_snapshot WHERE id=?', refId(product.urunSorumlusu))
          .toArray()[0];
        if (member) {
          const recipient = object(JSON.parse(member.data));
          if (recipient.email)
            this.store.enqueue({
              type: 'email',
              to: recipient.email,
              subject: 'Stok Uyarısı / Stock warning',
              text: `Ürün: ${product.urunAdi} — stok: ${product.stok} — sınır: ${product.stokSiniri}`,
            });
        }
      }
    return this.store.hydrate('satis', sale);
  }
  deleteSale(id: number, intent?: JsonObject) {
    const sale = this.store.get('satis', id),
      before = clone(sale);
    const audit = this.corrections.begin('satis', sale, intent, 'IPTAL');
    const reverse = this.saleCash(sale).negated();
    const lines = this.lines(id),
      debt = this.debt(id),
      // Restoring stock touches one product per line; they are read together.
      restored = this.store.select(
        'uruns',
        lines.map(line => refId(line.urun)),
      );
    for (const line of [...lines].sort((a, b) => refId(a.urun) - refId(b.urun))) {
      const product = restored.get(refId(line.urun));
      if (!product) throw new BusinessError('notfound', 404);
      this.stock(product, new Decimal(integer(line.miktar, true)));
    }
    if (audit) {
      sale.iptal = true;
      this.store.put('satis', sale);
      if (debt) {
        debt.hareketTipi = 'IPTAL';
        this.store.put('borc-alacaks', debt);
      }
    }
    this.corrections.finish('satis', audit, sale, reverse.toFixed(2), sale.sonraOdeme ? 'TAHSILAT' : 'SATIS', 'Satis Silindi');
    if (!audit) {
      for (const line of lines) this.store.remove('satis-stok-hareketleris', line.id);
      if (debt) this.store.remove('borc-alacaks', debt.id);
      this.store.remove('satis', id);
    }
    this.store.audit('satis', id, this.actor, audit ? 'CANCEL' : 'DELETE', before, audit ? sale : null);
  }
  collectSale(id: number, method: string): Entity {
    requireEnum(method, ['NAKIT', 'BANKA']);
    const sale = this.store.get('satis', id),
      before = clone(sale),
      debt = this.debt(id);
    if (sale.iptal || !sale.sonraOdeme || sale.odendi || !debt || debt.odemeAraci !== 'SONRA_ODEME' || debt.hareketTipi !== 'BORC')
      throw new BusinessError('invalidpayment', 409);
    if (method === 'NAKIT') this.corrections.cash(debt.tutar, `Gecikmeli Ödeme Alındı - Satış ${id} (Nakit)`, 'TAHSILAT');
    debt.hareketTipi = 'ODEME';
    debt.odemeAraci = method;
    debt.notlar = (text(debt.notlar) + ' | ' + `Ödeme alındı (${method === 'NAKIT' ? 'Nakit' : 'Kart'}) - ${id}`).slice(-500);
    sale.odendi = true;
    sale.kartliSatis = method === 'BANKA';
    this.store.put('borc-alacaks', debt);
    this.store.put('satis', sale);
    this.store.audit('satis', id, this.actor, 'COLLECT', before, sale);
    return this.store.hydrate('satis', sale);
  }
  stockDelta(type: string, q: number): Decimal {
    return new Decimal(q).times(['STOK_GIRISI', 'STOK_DUZELTME', 'IADE'].includes(type) ? 1 : -1);
  }
  saveStock(request: JsonObject, id?: number): Entity {
    const before = id ? this.store.get('stok-girisis', id) : null;
    const result = this.sanitize('stok-girisis', request, before ?? undefined);
    integer(result.miktar, true);
    const newProduct = this.store.get('uruns', refId(result.urun));
    if (before?.stokHareketiTipi === 'IADE') {
      if (before.miktar !== result.miktar || before.stokHareketiTipi !== result.stokHareketiTipi || refId(before.urun) !== newProduct.id)
        throw new BusinessError('returnimmutable');
    } else {
      if (before)
        this.stock(
          this.store.get('uruns', refId(before.urun)),
          this.stockDelta(text(before.stokHareketiTipi), integer(before.miktar, true)).negated(),
        );
      this.stock(this.store.get('uruns', newProduct.id), this.stockDelta(text(result.stokHareketiTipi), integer(result.miktar, true)));
      if (result.stokHareketiTipi === 'IADE')
        this.corrections.cash(
          decimal(
            quarter(
              decimal(newProduct.musteriFiyati)
                .times(integer(result.miktar, true))
                .div(newProduct.birim === 'GRAM' ? 1000 : 1),
            ),
          )
            .negated()
            .toFixed(2),
          'Musteri iadesi: Kasadan para cikti',
          'IADE',
        );
    }
    this.store.put('stok-girisis', result);
    this.store.audit('stok-girisis', result.id, this.actor, before ? 'UPDATE' : 'CREATE', before, result);
    return this.store.hydrate('stok-girisis', result);
  }
  deleteStock(id: number) {
    const existing = this.store.get('stok-girisis', id);
    if (existing.stokHareketiTipi === 'IADE') throw new BusinessError('returnimmutable');
    this.stock(
      this.store.get('uruns', refId(existing.urun)),
      this.stockDelta(text(existing.stokHareketiTipi), integer(existing.miktar, true)).negated(),
    );
    this.store.remove('stok-girisis', id);
    this.store.audit('stok-girisis', id, this.actor, 'DELETE', existing, null);
  }
  financialCash(kind: 'giders' | 'virmen', e: Entity): Decimal {
    if (kind === 'giders') return e.odemeAraci === 'NAKIT' ? decimal(e.tutar).negated() : new Decimal(0);
    return new Decimal(0).plus(e.girisHesabi === 'KASA' ? decimal(e.tutar) : 0).minus(e.cikisHesabi === 'KASA' ? decimal(e.tutar) : 0);
  }
  saveFinancial(kind: 'giders' | 'virmen', request: JsonObject, id?: number): Entity {
    const before = id ? this.store.get(kind, id) : null;
    const audit = before ? this.corrections.begin(kind, before, request.duzeltme, 'DUZELTME') : null;
    const result = this.sanitize(kind, request, before ?? undefined);
    result.tutar = money(result.tutar, true);
    if (kind === 'giders') requireEnum(result.odemeAraci, ['NAKIT', 'BANKA']);
    else {
      requireEnum(result.cikisHesabi, ['KASA', 'BANKA']);
      requireEnum(result.girisHesabi, ['KASA', 'BANKA']);
      if (result.cikisHesabi === result.girisHesabi) throw new BusinessError('invalidpayment');
    }
    if (audit) {
      result.tarih = before!.tarih;
      result.duzeltildi = true;
    } else if (!before) result.nobetAcilisId = this.corrections.activeOpening()?.id ?? null;
    result.iptal = false;
    this.store.put(kind, result);
    this.corrections.finish(
      kind,
      audit,
      result,
      this.financialCash(kind, result)
        .minus(before ? this.financialCash(kind, before) : 0)
        .toFixed(2),
      kind === 'giders' ? 'GIDER' : 'VIRMAN',
      kind === 'giders' ? 'Gider işlemi' : 'Virman işlemi',
    );
    this.store.audit(kind, result.id, this.actor, before ? 'UPDATE' : 'CREATE', before, result);
    return this.store.hydrate(kind, result);
  }
  deleteFinancial(kind: 'giders' | 'virmen', id: number, intent?: JsonObject) {
    const old = this.store.get(kind, id),
      before = clone(old),
      audit = this.corrections.begin(kind, old, intent, 'IPTAL');
    if (audit) {
      old.iptal = true;
      this.store.put(kind, old);
    }
    this.corrections.finish(
      kind,
      audit,
      old,
      this.financialCash(kind, old).negated().toFixed(2),
      kind === 'giders' ? 'GIDER' : 'VIRMAN',
      'İşlem iptal edildi',
    );
    if (!audit) this.store.remove(kind, id);
    this.store.audit(kind, id, this.actor, audit ? 'CANCEL' : 'DELETE', before, audit ? old : null);
  }
}
