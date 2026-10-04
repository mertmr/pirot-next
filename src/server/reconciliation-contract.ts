import { createHash } from 'node:crypto';
import { ENTITY_SPECS, type EntityKind } from './entity-specs';
import { decimal, type Entity, type JsonObject } from './value';

/**
 * The reconciliation manifest is a financial contract: the importer compares it
 * byte for byte before publishing a tenant, so both the server and the migration
 * preparation script must build it the same way.
 *
 * This module is the single definition. It is deliberately free of D1 and of
 * TenantStore so a build script can import it without a database.
 */

/** Stable JSON encoding: object keys are sorted so digests do not depend on key order. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

export function checksum(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

/**
 * The audited history fields, in a fixed order. The tenant key is deliberately
 * excluded: a history row is identified by its own columns, and including the
 * tenant would make the digest depend on the loader rather than on the record.
 */
export const HISTORY_FIELDS = ['kind', 'entity_id', 'actor', 'operation', 'before_json', 'after_json', 'at'] as const;

export function historyRecord(row: JsonObject): JsonObject {
  return Object.fromEntries(HISTORY_FIELDS.map(field => [field, row[field] ?? null]));
}

/** Rows must already be ordered by id, as both loaders order them. */
export function digestRows<T>(rows: Iterable<T>): { digest: string; count: number } {
  const hash = createHash('sha256');
  let count = 0;
  for (const row of rows) {
    hash.update(canonical(row)).update('\n');
    count++;
  }
  return { digest: hash.digest('hex'), count };
}

/**
 * Builds the manifest from rows that are already loaded and ordered by id.
 * This is the only place the shape of a reconciliation is defined.
 */
export function buildManifest(tenantId: number, entities: Record<EntityKind, Entity[]>, history: JsonObject[]): JsonObject {
  const counts: JsonObject = {},
    digests: JsonObject = {};
  for (const kind of Object.keys(ENTITY_SPECS) as EntityKind[]) {
    const rows = [...entities[kind]].sort((a, b) => a.id - b.id),
      { digest, count } = digestRows(rows);
    counts[kind] = count;
    digests[kind] = digest;
  }
  const sum = (kind: EntityKind, field: string, predicate: (row: Entity) => boolean = () => true) =>
    entities[kind]
      .filter(predicate)
      .reduce((total, row) => total.plus(decimal(row[field], '0')), decimal('0'))
      .toString();
  // The cash balance is the latest ledger row by timestamp, then by id.
  const cash = [...entities['kasa-hareketleris']].sort((a, b) => String(b.tarih).localeCompare(String(a.tarih)) || b.id - a.id)[0];
  return {
    historyDigest: digestRows(history.map(historyRecord)).digest,
    tenantId,
    counts,
    digests,
    historyCount: history.length,
    balances: {
      stock: sum('uruns', 'stok'),
      cash: cash?.kasaMiktar ?? null,
      sales: sum('satis', 'toplamTutar', r => !r.iptal),
      deferred: sum('satis', 'toplamTutar', r => !!r.sonraOdeme && !r.odendi && !r.iptal),
      producer: sum('uretici-odemeleris', 'tutar'),
    },
  };
}
