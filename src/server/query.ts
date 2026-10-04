import type { SqlValue } from './sql-contract';
import { ENTITY_SPECS, type EntityKind } from './entity-specs';
import { TenantStore } from './storage';
import { BusinessError, integer, object, type Entity, type JsonValue } from './value';
interface Field {
  type: string;
  target?: string;
}
function order(kind: EntityKind, field: string, direction: string): string {
  if (!['asc', 'desc'].includes(direction) || !/^[a-zA-Z][\w]*(?:\.[a-zA-Z][\w]*)?$/.test(field)) throw new BusinessError('invalidrequest');
  const sqlDirection = direction.toUpperCase(),
    reverse = direction === 'asc' ? 'DESC' : 'ASC';
  if (field === 'id') return `e.id ${sqlDirection}`;
  const [name, nested] = field.split('.');
  if (!Object.hasOwn(ENTITY_SPECS[kind].fields, name)) throw new BusinessError('invalidrequest');
  let spec = (ENTITY_SPECS[kind].fields as Record<string, Field>)[name],
    value = `json_extract(e.data,'$.${name}')`;
  if (nested) {
    if (spec.type !== 'relation' || !spec.target) throw new BusinessError('invalidrequest');
    if (spec.target === 'users') {
      if (!['id', 'login', 'firstName', 'lastName'].includes(nested)) throw new BusinessError('invalidrequest');
      value = `(SELECT json_extract(u.data,'$.${nested}') FROM users_snapshot u WHERE u.id=json_extract(e.data,'$.${name}.id'))`;
      spec = { type: nested === 'id' ? 'integer' : 'string' };
    } else {
      const target = spec.target as EntityKind;
      if (!Object.hasOwn(ENTITY_SPECS[target].fields, nested) && nested !== 'id') throw new BusinessError('invalidrequest');
      value = `(SELECT ${nested === 'id' ? 'r.id' : `json_extract(r.data,'$.${nested}')`} FROM entities r WHERE r.kind='${target}' AND r.id=json_extract(e.data,'$.${name}.id'))`;
      spec = nested === 'id' ? { type: 'integer' } : (ENTITY_SPECS[target].fields as Record<string, Field>)[nested];
    }
  }
  if (spec.type !== 'decimal') return `${value} COLLATE NOCASE ${sqlDirection}`;
  // Compare decimal strings by sign and zero-padded magnitude; SQLite REAL would lose cents above 2^53.
  const negative = `substr(${value},1,1)='-'`,
    absolute = `CASE WHEN ${negative} THEN substr(${value},2) ELSE ${value} END`,
    dot = `instr((${absolute}),'.')`;
  const whole = `CASE WHEN ${dot}=0 THEN (${absolute}) ELSE substr((${absolute}),1,${dot}-1) END`,
    fraction = `CASE WHEN ${dot}=0 THEN '' ELSE substr((${absolute}),${dot}+1) END`;
  const zero = '0'.repeat(40),
    key = `substr('${zero}'||(${whole}),-40)||substr((${fraction})||'${zero}',1,40)`;
  return `CASE WHEN ${value} IS NULL THEN -2 WHEN ${negative} THEN -1 ELSE 1 END ${sqlDirection},CASE WHEN ${negative} THEN (${key}) END ${reverse},CASE WHEN NOT (${negative}) THEN (${key}) END ${sqlDirection}`;
}
export function page(
  store: TenantStore,
  kind: EntityKind,
  url: URL,
  condition = '1',
  bindings: SqlValue[] = [],
): { data: JsonValue; headers: Record<string, string> } {
  const q = url.searchParams,
    p = q.has('page') ? integer(q.get('page')) : 0,
    size = q.has('size') ? integer(q.get('size'), true) : 20;
  if (p < 0 || size > 1000 || !Number.isSafeInteger(p * size)) throw new BusinessError('invalidrequest');
  const sorts = q.getAll('sort'),
    ordering = (sorts.length ? sorts : ['id,asc'])
      .map(s => {
        const [field, direction] = s.split(',');
        return order(kind, field, direction ?? 'asc');
      })
      .join(',');
  const total = store.count(kind, condition, bindings),
    pages = Math.max(1, Math.ceil(total / size));
  const raw = store.sql
    .exec<{ data: string }>(
      `SELECT e.data FROM entities e WHERE e.kind=? AND (${condition}) ORDER BY ${ordering},e.id ASC LIMIT ? OFFSET ?`,
      kind,
      ...bindings,
      size,
      p * size,
    )
    .toArray()
    .map(r => object(JSON.parse(r.data)) as Entity);
  const rows = store.hydrateAll(kind, raw);
  if (kind === 'stok-girisis')
    for (const row of rows) {
      row.urunAdi = row.urun ? object(row.urun).urunAdi : null;
      row.userLogin = row.user ? object(row.user).login : null;
    }
  const link = (index: number, rel: string) => {
    const target = new URL(url);
    target.searchParams.set('page', String(index));
    target.searchParams.set('size', String(size));
    return `<${target.pathname}${target.search}>; rel="${rel}"`;
  };
  const links = [link(0, 'first'), link(pages - 1, 'last')];
  if (p > 0) links.push(link(p - 1, 'prev'));
  if (p < pages - 1) links.push(link(p + 1, 'next'));
  return { data: rows, headers: { 'x-total-count': String(total), link: links.join(', ') } };
}
