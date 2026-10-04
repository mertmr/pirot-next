import { operationDate } from './operation-context';
import { ENTITY_SPECS, type EntityKind } from './entity-specs';
import { TenantStore } from './storage';
import { buildManifest, canonical, checksum, HISTORY_FIELDS } from './reconciliation-contract';
import { BusinessError, type JsonObject, type Entity, object, list, integer, text, decimal, date, refId } from './value';
import type { CurrentUser } from './env';
export { canonical, checksum };
/**
 * Loads the manifest from persisted rows. The shape of a reconciliation is defined
 * once, in reconciliation-contract, so the importer and the build script cannot drift.
 */
export function reconciliation(store: TenantStore): JsonObject {
  const entities = {} as Record<EntityKind, Entity[]>;
  for (const kind of Object.keys(ENTITY_SPECS) as EntityKind[]) {
    entities[kind] = [];
    for (const row of store.sql.exec<{ data: string }>('SELECT data FROM entities WHERE kind=? ORDER BY id', kind))
      entities[kind].push(object(JSON.parse(row.data)) as Entity);
  }
  const history = store.sql.exec<Record<string, string>>(`SELECT ${HISTORY_FIELDS.join(',')} FROM history ORDER BY id`).toArray();
  return buildManifest(store.tenantId(), entities, history);
}
export class TenantMigration {
  constructor(
    readonly store: TenantStore,
    readonly actor: CurrentUser,
  ) {}
  state(): JsonObject | null {
    const row = this.store.sql.exec<{ value: string }>("SELECT value FROM tenant_meta WHERE key='import'").toArray()[0];
    return row ? object(JSON.parse(row.value)) : null;
  }
  handle(action: string, input: JsonObject): JsonObject {
    if (!this.actor.authorities.includes('ROLE_ADMIN')) throw new BusinessError('forbidden', 403);
    const state = this.state();
    if (action === 'status') return { state, reconciliation: reconciliation(this.store) };
    const session = text(input.session);
    if (!/^[a-zA-Z0-9-]{16,100}$/.test(session)) throw new BusinessError('invalidrequest');
    if (action === 'begin') {
      if (state?.session === session) return { state };
      if (
        state ||
        this.store.sql.exec<{ n: number }>('SELECT count(*) AS n FROM entities').one().n ||
        this.store.sql.exec<{ n: number }>('SELECT count(*) AS n FROM history').one().n
      )
        throw new BusinessError('duplicate', 409);
      if (integer(input.schemaVersion, true) !== 1 || integer(input.tenantId, true) !== this.actor.tenantId)
        throw new BusinessError('invalidrequest');
      const value = {
        session,
        status: 'importing',
        startedAt: operationDate().toISOString(),
        expected: object(input.expected),
        settings: input.settings ?? null,
      };
      this.store.sql.exec("INSERT INTO tenant_meta(key,value) VALUES ('import',?)", JSON.stringify(value));
      return { state: value };
    }
    if (!state || state.session !== session || state.status !== 'importing') throw new BusinessError('invalidtransition', 409);
    if (action === 'batch') {
      const kind = text(input.kind);
      if (!Object.hasOwn(ENTITY_SPECS, kind)) throw new BusinessError('invalidrequest');
      const rows = list(input.rows);
      if (!rows.length || rows.length > 500) throw new BusinessError('invalidrequest');
      for (const value of rows) {
        const entity = object(value);
        integer(entity.id, true);
        if (integer(entity.tenantId, true) !== this.actor.tenantId) throw new BusinessError('forbidden', 403);
        if (this.store.maybe(kind as EntityKind, integer(entity.id, true))) throw new BusinessError('duplicate', 409);
        this.store.put(kind as EntityKind, entity as Entity);
      }
      return { inserted: rows.length };
    }
    if (action === 'history') {
      const rows = list(input.rows);
      if (!rows.length || rows.length > 500) throw new BusinessError('invalidrequest');
      for (const value of rows) {
        const row = object(value);
        if (integer(row.tenantId, true) !== this.actor.tenantId || !Object.hasOwn(ENTITY_SPECS, text(row.kind)))
          throw new BusinessError('forbidden', 403);
        for (const key of ['before_json', 'after_json'])
          if (row[key]) {
            const entity = object(JSON.parse(text(row[key])));
            if (integer(entity.tenantId, true) !== this.actor.tenantId) throw new BusinessError('forbidden', 403);
          }
        this.store.sql.exec(
          'INSERT INTO history(kind,entity_id,actor,operation,before_json,after_json,at) VALUES (?,?,?,?,?,?,?)',
          text(row.kind),
          integer(row.entity_id, true),
          text(row.actor),
          text(row.operation),
          row.before_json ? text(row.before_json) : null,
          row.after_json ? text(row.after_json) : null,
          date(row.at),
        );
      }
      return { inserted: rows.length };
    }
    if (action === 'abort') {
      // Only an unpublished import can be cleared. Live tenant state is never an import destination.
      this.store.sql.exec("DELETE FROM entities;DELETE FROM sequences;DELETE FROM history;DELETE FROM tenant_meta WHERE key='import'");
      return { aborted: true };
    }
    if (action === 'finish') {
      this.validate();
      const actual = reconciliation(this.store),
        expected = object(state.expected);
      if (canonical(actual) !== canonical(expected)) throw new BusinessError('reconciliationfailed', 409);
      if (state.settings) {
        const settings = object(state.settings);
        this.store.sql.exec(
          "INSERT INTO tenant_meta(key,value) VALUES ('settings',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
          JSON.stringify(settings),
        );
      }
      state.status = 'complete';
      state.finishedAt = operationDate().toISOString();
      this.store.sql.exec("UPDATE tenant_meta SET value=? WHERE key='import'", JSON.stringify(state));
      return { state, reconciliation: actual };
    }
    throw new BusinessError('notfound', 404);
  }
  validate() {
    for (const kind of Object.keys(ENTITY_SPECS) as EntityKind[])
      for (const row of this.store.rows(kind)) {
        for (const [field, raw] of Object.entries(ENTITY_SPECS[kind].fields)) {
          const spec = raw as { type: string; required: boolean; target?: string; values?: readonly string[] },
            value = row[field];
          if (value == null) {
            if (spec.required) throw new BusinessError('invalidrequest');
            continue;
          }
          if (spec.type === 'relation') {
            const id = refId(value);
            if (spec.target === 'users') this.store.user(id);
            else this.store.get(spec.target as EntityKind, id);
          } else if (spec.type === 'decimal') {
            if (typeof value !== 'string') throw new BusinessError('invalidamount');
            decimal(value);
          } else if (spec.type === 'integer') integer(value);
          else if (spec.type === 'boolean' && typeof value !== 'boolean') throw new BusinessError('invalidrequest');
          else if (spec.type === 'enum' && !spec.values?.includes(text(value))) throw new BusinessError('invalidrequest');
          else if (spec.type === 'date' && date(value) !== value) throw new BusinessError('invaliddate');
          else if (spec.type === 'string') text(value);
        }
        if (kind === 'satis-stok-hareketleris' && (!row.satis || !row.urun)) throw new BusinessError('invalidrequest');
        for (const field of ['nobetAcilisId', 'acilisId', 'kapanisId', 'odemeNobetId'])
          if (row[field] != null) this.store.get('nobet-hareketleris', integer(row[field], true));
      }
  }
}
