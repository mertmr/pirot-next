import { operationDate } from './operation-context';
import { TenantStore } from './storage';
import { BusinessError, Decimal, type Entity, type JsonObject, decimal, text, refId, dayRange, istanbulDay, object } from './value';
export class Reports {
  constructor(readonly store: TenantStore) {}
  sales(from?: string, to?: string): Entity[] {
    const conditions = ["coalesce(json_extract(data,'$.iptal'),0)=0"],
      bindings: SqlStorageValue[] = [];
    if (from) {
      conditions.push("json_extract(data,'$.tarih')>=?");
      bindings.push(from);
    }
    if (to) {
      conditions.push("json_extract(data,'$.tarih')<?");
      bindings.push(to);
    }
    return [...this.store.rows('satis', conditions.join(' AND '), bindings)];
  }
  ciro(fromDay: string, toDay: string, byUser = false, userId?: number): JsonObject[] {
    const [from] = dayRange(fromDay),
      [, to] = dayRange(toDay),
      groups = new Map<string, { total: Decimal; card: Decimal; day: string; login: string }>();
    for (const sale of this.sales(from, to)) {
      if (userId && (!sale.user || refId(sale.user) !== userId)) continue;
      const day = istanbulDay(sale.tarih),
        login = sale.user ? text(object(sale.user).login) : '';
      const key = byUser ? `${day}:${login}` : day;
      const group = groups.get(key) ?? { total: new Decimal(0), card: new Decimal(0), day, login };
      group.total = group.total.plus(decimal(sale.toplamTutar));
      if (sale.kartliSatis) group.card = group.card.plus(decimal(sale.toplamTutar));
      groups.set(key, group);
    }
    return [...groups.values()]
      .sort((a, b) => a.day.localeCompare(b.day) || a.login.localeCompare(b.login))
      .map(g => ({
        tarih: `${g.day}T00:00:00+03:00`,
        tutar: g.total.toFixed(2),
        kartli: g.card.toFixed(2),
        nakit: g.total.minus(g.card).toFixed(2),
        ...(byUser ? { nobetci: g.login } : {}),
      }));
  }
  dashboard(day = istanbulDay(operationDate().toISOString())): JsonObject {
    const [, end] = dayRange(day),
      sales = this.ciro(day, day)[0];
    const cash = this.store.latest('kasa-hareketleris', new Date(Date.parse(end) - 1).toISOString());
    const weekStart = istanbulDay(new Date(Date.parse(dayRange(day)[0]) - 7 * 86400000).toISOString()),
      week = this.ciro(weekStart, day);
    return {
      kasadaNeVar: cash?.kasaMiktar ?? '0.00',
      gunlukCiro: sales?.tutar ?? '0.00',
      kartliSatis: sales?.kartli ?? '0.00',
      nakitSatis: sales?.nakit ?? '0.00',
      haftalikCiroRakamlari: week.map(r => r.tutar),
      haftalikCiroTarihleri: week.map(r => r.tarih),
      toplamBorc: this.store
        .all('uretici-odemeleris')
        .reduce((sum, e) => sum.plus(decimal(e.tutar, '0')), new Decimal(0))
        .toFixed(2),
    };
  }
  dayEnd(day: string): JsonObject {
    const [start, end] = dayRange(day);
    const inDay = (e: Entity) => !e.iptal && String(e.tarih) >= start && String(e.tarih) < end;
    const latest = this.store.latest('nobet-hareketleris', new Date(Date.parse(end) - 1).toISOString());
    const opening = latest?.acilisId
      ? this.store.maybe('nobet-hareketleris', Number(latest.acilisId))
      : latest?.acilisKapanis === 'ACILIS'
        ? latest
        : null;
    const transfers = [
      ...this.store.rows('virmen', "json_extract(data,'$.tarih')>=? AND json_extract(data,'$.tarih')<?", [start, end]),
    ].filter(inDay);
    return {
      giderList: this.store.hydrateAll(
        'giders',
        [...this.store.rows('giders', "json_extract(data,'$.tarih')>=? AND json_extract(data,'$.tarih')<?", [start, end])].filter(inDay),
      ),
      virman: transfers[0] ? this.store.hydrate('virmen', transfers[0]) : null,
      virmanList: this.store.hydrateAll('virmen', transfers),
      dashboardReports: this.dashboard(day),
      nobetHareketleri: latest ? this.store.hydrate('nobet-hareketleris', latest) : null,
      acilisHareketi: opening ? this.store.hydrate('nobet-hareketleris', opening) : null,
    };
  }
  monthlyProducts(productId?: number): JsonObject[] {
    if (productId) this.store.get('uruns', productId);
    const groups = new Map<string, { month: string; name: string; quantity: Decimal }>();
    for (const row of this.store.sql.exec<{ quantity: number; tarih: string; name: string }>(
      `SELECT json_extract(l.data,'$.miktar') AS quantity,json_extract(s.data,'$.tarih') AS tarih,json_extract(p.data,'$.urunAdi') AS name FROM entities l JOIN entities s ON s.kind='satis' AND s.id=json_extract(l.data,'$.satis.id') JOIN entities p ON p.kind='uruns' AND p.id=json_extract(l.data,'$.urun.id') WHERE l.kind='satis-stok-hareketleris' AND coalesce(json_extract(s.data,'$.iptal'),0)=0 ${productId ? 'AND p.id=?' : ''}`,
      ...(productId ? [productId] : []),
    )) {
      const month = istanbulDay(row.tarih).slice(0, 7),
        key = `${month}:${row.name}`,
        group = groups.get(key) ?? { month, name: row.name, quantity: new Decimal(0) };
      group.quantity = group.quantity.plus(row.quantity);
      groups.set(key, group);
    }
    return [...groups.values()]
      .sort((a, b) => b.month.localeCompare(a.month) || a.name.localeCompare(b.name, 'tr'))
      .map(g => ({ year: Number(g.month.slice(0, 4)), month: Number(g.month.slice(5)), urunAdi: g.name, miktar: g.quantity.toString() }));
  }
  monthlyMatrix(): JsonObject {
    const rows = this.monthlyProducts(),
      months = [...new Set(rows.map(r => `${r.year}-${String(r.month).padStart(2, '0')}`))].sort();
    return {
      aylikSatisMap: Object.fromEntries(rows.map(r => [`${r.year}.${String(r.month).padStart(2, '0')}${r.urunAdi}`, r.miktar])),
      tarihListesi: months.map(m => `${m}-01T00:00:00+03:00`),
      urunAdiListesi: [...new Set(rows.map(r => r.urunAdi))],
    };
  }
  months(): JsonObject[] {
    return [
      ...new Set(
        this.sales()
          .filter(s => s.ortagaSatis)
          .map(s => istanbulDay(s.tarih).slice(0, 7)),
      ),
    ]
      .sort()
      .reverse()
      .slice(0, 10)
      .map(month => ({ year: Number(month.slice(0, 4)), month: Number(month.slice(5)), reportDate: month, tarih: month }));
  }
  monthSales(month: string): Entity[] {
    if (!/^\d{4}-\d{2}$/.test(month) || Number(month.slice(5)) < 1 || Number(month.slice(5)) > 12) throw new BusinessError('invaliddate');
    const year = Number(month.slice(0, 4)),
      nextMonth = Number(month.slice(5)) === 12 ? `${year + 1}-01` : `${year}-${String(Number(month.slice(5)) + 1).padStart(2, '0')}`;
    return this.sales(dayRange(`${month}-01`)[0], dayRange(`${nextMonth}-01`)[0]).filter(s => s.ortagaSatis);
  }
  people(month: string): Entity[] {
    const ids = new Set(
      this.monthSales(month)
        .filter(s => s.kisi)
        .map(s => refId(s.kisi)),
    );
    return [...ids].sort((a, b) => a - b).map(id => this.store.get('kisilers', id));
  }
  invoice(month: string, personId: number): JsonObject {
    this.store.get('kisilers', personId);
    const ids = new Set(
      this.monthSales(month)
        .filter(s => s.kisi && refId(s.kisi) === personId)
        .map(s => s.id),
    );
    const groups = new Map<number, { q: Decimal; total: Decimal }>();
    for (const saleId of ids)
      for (const line of this.store.matching('satis-stok-hareketleris', 'satis.id', saleId)) {
        const pid = refId(line.urun),
          g = groups.get(pid) ?? { q: new Decimal(0), total: new Decimal(0) };
        g.q = g.q.plus(decimal(line.miktar));
        g.total = g.total.plus(decimal(line.tutar));
        groups.set(pid, g);
      }
    const details: JsonObject[] = [];
    const vat = new Map<number, Decimal>();
    for (const [pid, g] of groups) {
      if (g.q.isZero()) continue;
      const product = this.store.get('uruns', pid);
      const category = product.kdvKategorisi ? this.store.get('kdv-kategorisis', refId(product.kdvKategorisi)) : null;
      if (!category) continue;
      const rate = decimal(category.kdvOrani, '0');
      const q = product.birim === 'GRAM' ? g.q.div(1000) : g.q;
      const unit = g.total.div(q).toDecimalPlaces(2).div(new Decimal(100).plus(rate)).toDecimalPlaces(5).times(100).toDecimalPlaces(2);
      const total = unit.times(q).toDecimalPlaces(2);
      details.push({
        urunAdiKdv: `${product.urunAdi} %${rate.toString()}`,
        kdvKategorisi: category,
        miktar: `${product.birim === 'GRAM' ? q.toFixed(3) : q.toString()} ${product.birim === 'GRAM' ? 'KG' : product.birim}`,
        birimFiyat: unit.toFixed(2),
        toplamTutar: total.toFixed(2),
      });
      if (category) vat.set(category.id, (vat.get(category.id) ?? new Decimal(0)).plus(total.times(rate).div(100)));
    }
    const vatRows = this.store
      .all('kdv-kategorisis')
      .map(c => ({ kdvKategorisi: c.kategoriAdi, kdvTutari: (vat.get(c.id) ?? new Decimal(0)).toFixed(2) }));
    const net = details.reduce((sum, d) => sum.plus(decimal(d.toplamTutar)), new Decimal(0)),
      tax = vatRows.reduce((sum, d) => sum.plus(decimal(d.kdvTutari)), new Decimal(0));
    return {
      ortakFaturasiDetayDto: details,
      kdvToplamList: vatRows,
      tumKdvToplami: tax.toFixed(2),
      tumToplamKdvHaric: net.toFixed(2),
      tumToplam: net.plus(tax).toFixed(2),
    };
  }
  depletion(productId: number, stockDate: string): JsonObject {
    this.store.get('uruns', productId);
    let start: string;
    if (/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}$/.test(stockDate)) {
      const [d, m, y] = stockDate.slice(0, 10).split('/');
      start = new Date(`${y}-${m}-${d}T${stockDate.slice(11)}+03:00`).toISOString();
    } else {
      const n = Date.parse(stockDate);
      if (!Number.isFinite(n)) throw new BusinessError('invaliddate');
      start = new Date(n).toISOString();
    }
    const until = new Date(Date.parse(start) + 31 * 86400000).toISOString();
    const history = this.store.sql
      .exec<{ before_json: string | null; after_json: string | null; at: string }>(
        "SELECT before_json,after_json,at FROM history WHERE kind='uruns' AND entity_id=? AND at>=? AND at<=? ORDER BY at,id",
        productId,
        new Date(Date.parse(start) - 5000).toISOString(),
        until,
      )
      .toArray()
      .filter(r => r.after_json && object(JSON.parse(r.after_json)).stok != null);
    if (!history.length) throw new BusinessError('notfound', 422);
    const first = history[0],
      initial = decimal(object(JSON.parse(first.after_json!)).stok),
      limit = initial.times('0.05');
    let last = history.at(-1)!;
    for (const row of history.slice(1)) {
      const after = decimal(object(JSON.parse(row.after_json!)).stok),
        before = row.before_json ? decimal(object(JSON.parse(row.before_json)).stok, '0') : initial;
      if (after.gt(before)) {
        break;
      }
      last = row;
      if (after.lte(limit)) break;
    }
    const days = Math.floor((Date.parse(last.at) - Date.parse(first.at)) / 86400000);
    if (days <= 0) throw new BusinessError('notfound', 422);
    const sales = new Set(this.sales(first.at, new Date(Date.parse(last.at) + 1).toISOString()).map(s => s.id));
    const lines = this.store.matching('satis-stok-hareketleris', 'urun.id', productId).filter(l => l.satis && sales.has(refId(l.satis)));
    const total = lines.reduce((sum, l) => sum.plus(decimal(l.miktar)), new Decimal(0)),
      monthly = total.div(days).toDecimalPlaces(2).times(30);
    const waste = this.store
      .matching('stok-girisis', 'urun.id', productId)
      .filter(
        s =>
          s.urun &&
          refId(s.urun) === productId &&
          s.stokHareketiTipi === 'FIRE' &&
          String(s.tarih) >= first.at &&
          String(s.tarih) <= last.at,
      )
      .reduce((sum, s) => sum.plus(decimal(s.miktar)), new Decimal(0));
    return {
      aylikTukenmeHizi: monthly.toFixed(2),
      haftalikTukenmeHizi: monthly.div(4).toFixed(2),
      raporVeriOlcekSuresi: String(days),
      stokGunluguList: this.store.hydrateAll('satis-stok-hareketleris', lines),
      urunFire: waste.toString(),
    };
  }
}
