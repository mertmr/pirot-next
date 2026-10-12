import { operationDate, operationId } from './operation-context';
import type { TenantSql, TransactionRunner, SqlValue } from './sql-contract';
import { ReadRequired } from './d1-store';
import { ENTITY_SPECS, type EntityKind } from './entity-specs';
import { BusinessError, type Entity, type JsonObject, object, integer, clone } from './value';
import type { CurrentUser } from './env';
export const TENANT_SCHEMA_VERSION = 2;
export class TenantStore {
  constructor(
    readonly sql: TenantSql,
    readonly storage: TransactionRunner,
    readonly emailEnabled = true,
  ) {}
  initialize() {
    this.sql.exec('CREATE TABLE IF NOT EXISTS tenant_meta (key TEXT PRIMARY KEY,value TEXT NOT NULL)');
    const version = this.sql.exec<{ value: string }>("SELECT value FROM tenant_meta WHERE key='schema_version'").toArray()[0];
    if (
      version &&
      (!Number.isSafeInteger(Number(version.value)) || Number(version.value) < 1 || Number(version.value) > TENANT_SCHEMA_VERSION)
    )
      throw new BusinessError('configuration', 503);
    this.sql.exec(`
  CREATE TABLE IF NOT EXISTS entities (
    kind TEXT NOT NULL,id INTEGER NOT NULL CHECK(id>0),data TEXT NOT NULL CHECK(json_valid(data)),
    PRIMARY KEY(kind,id),CHECK(json_extract(data,'$.id')=id)
  );
  CREATE INDEX IF NOT EXISTS entities_date ON entities(kind,json_extract(data,'$.tarih'),id);
  CREATE INDEX IF NOT EXISTS entities_user ON entities(kind,json_extract(data,'$.user.id'),id);
  CREATE INDEX IF NOT EXISTS entities_product ON entities(kind,json_extract(data,'$.urun.id'),id);
  CREATE INDEX IF NOT EXISTS entities_sale ON entities(kind,json_extract(data,'$.satis.id'),id);
  CREATE TABLE IF NOT EXISTS sequences(kind TEXT PRIMARY KEY,value INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS idempotency(key TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,response TEXT NOT NULL,created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS history(id INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL,entity_id INTEGER NOT NULL,
    actor TEXT NOT NULL,operation TEXT NOT NULL,before_json TEXT,after_json TEXT,at TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS history_entity ON history(kind,entity_id,id);
  CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY,payload TEXT NOT NULL CHECK(json_valid(payload)),created_at TEXT NOT NULL,delivered_at TEXT);
  CREATE TABLE IF NOT EXISTS users_snapshot(id INTEGER PRIMARY KEY,data TEXT NOT NULL CHECK(json_valid(data)));
  `);
    if (
      !this.sql
        .exec<{ name: string }>('PRAGMA table_info(outbox)')
        .toArray()
        .some(c => c.name === 'queued_at')
    )
      this.sql.exec('ALTER TABLE outbox ADD COLUMN queued_at TEXT');
    this.sql.exec(
      "INSERT INTO tenant_meta(key,value) VALUES ('schema_version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      String(TENANT_SCHEMA_VERSION),
    );
  }
  assertTenant(actor: CurrentUser) {
    if (!Number.isSafeInteger(actor.tenantId) || actor.tenantId <= 0) throw new BusinessError('tenantrequired', 403);
    const rows = this.sql.exec<{ value: string }>("SELECT value FROM tenant_meta WHERE key='tenant_id'").toArray();
    if (!rows.length) this.sql.exec("INSERT INTO tenant_meta(key,value) VALUES ('tenant_id',?)", String(actor.tenantId));
    else if (rows[0].value !== String(actor.tenantId)) throw new BusinessError('forbidden', 403);
    this.sql.exec(
      'INSERT INTO users_snapshot(id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
      actor.id,
      JSON.stringify(actor),
    );
  }
  tenantId(): number {
    return integer(this.sql.exec<{ value: string }>("SELECT value FROM tenant_meta WHERE key='tenant_id'").one().value, true);
  }
  transaction<T>(run: () => T): T {
    return this.storage.transactionSync(run);
  }
  next(kind: EntityKind): number {
    return integer(
      this.sql
        .exec<{ value: number }>(
          'INSERT INTO sequences(kind,value) VALUES (?,1) ON CONFLICT(kind) DO UPDATE SET value=value+1 RETURNING value',
          kind,
        )
        .one().value,
      true,
    );
  }
  get(kind: EntityKind, id: number): Entity {
    const row = this.sql.exec<{ data: string }>('SELECT data FROM entities WHERE kind=? AND id=?', kind, integer(id, true)).toArray()[0];
    if (!row) throw new BusinessError('notfound', 404);
    return object(JSON.parse(row.data)) as Entity;
  }
  maybe(kind: EntityKind, id: number): Entity | null {
    try {
      return this.get(kind, id);
    } catch (e) {
      if (e instanceof BusinessError && e.code === 'notfound') return null;
      throw e;
    }
  }
  *rows(kind: EntityKind, condition = '1', bindings: SqlValue[] = []): Generator<Entity> {
    for (const row of this.sql.exec<{ data: string }>(
      `SELECT data FROM entities WHERE kind=? AND (${condition}) ORDER BY id`,
      kind,
      ...bindings,
    ))
      yield object(JSON.parse(row.data)) as Entity;
  }
  all(kind: EntityKind): Entity[] {
    return [...this.rows(kind)];
  }
  matching(kind: EntityKind, field: string, value: SqlValue): Entity[] {
    if (!/^[a-zA-Z][\w]*(?:\.[a-zA-Z][\w]*)?$/.test(field)) throw new BusinessError('invalidrequest');
    return [...this.rows(kind, `json_extract(data,'$.${field}')=?`, [value])];
  }
  count(kind: EntityKind, condition = '1', bindings: SqlValue[] = []): number {
    return this.sql.exec<{ n: number }>(`SELECT count(*) AS n FROM entities e WHERE kind=? AND (${condition})`, kind, ...bindings).one().n;
  }
  latest(kind: EntityKind, at?: string): Entity | null {
    const row = this.sql
      .exec<{ data: string }>(
        `SELECT data FROM entities WHERE kind=? ${at ? "AND json_extract(data,'$.tarih')<=?" : ''} ORDER BY json_extract(data,'$.tarih') DESC,id DESC LIMIT 1`,
        kind,
        ...(at ? [at] : []),
      )
      .toArray()[0];
    return row ? (object(JSON.parse(row.data)) as Entity) : null;
  }
  put(kind: EntityKind, data: Entity): Entity {
    integer(data.id, true);
    if (data.tenantId !== this.tenantId()) throw new BusinessError('forbidden', 403);
    this.sql.exec(
      'INSERT INTO entities(kind,id,data) VALUES (?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data',
      kind,
      data.id,
      JSON.stringify(data),
    );
    this.sql.exec(
      'INSERT INTO sequences(kind,value) VALUES (?,?) ON CONFLICT(kind) DO UPDATE SET value=max(value,excluded.value)',
      kind,
      data.id,
    );
    return data;
  }
  remove(kind: EntityKind, id: number) {
    this.get(kind, id);
    this.sql.exec('DELETE FROM entities WHERE kind=? AND id=?', kind, id);
  }
  user(id: number): JsonObject {
    const r = this.sql.exec<{ data: string }>('SELECT data FROM users_snapshot WHERE id=?', id).toArray()[0];
    if (!r) throw new BusinessError('notfound', 404);
    const u = object(JSON.parse(r.data));
    return { id: u.id, login: u.login, firstName: u.firstName ?? null, lastName: u.lastName ?? null, tenantId: u.tenantId };
  }
  audit(kind: EntityKind, id: number, actor: CurrentUser, operation: string, before: Entity | null, after: Entity | null) {
    this.sql.exec(
      'INSERT INTO history(kind,entity_id,actor,operation,before_json,after_json,at) VALUES (?,?,?,?,?,?,?)',
      kind,
      id,
      actor.login,
      operation,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
      operationDate().toISOString(),
    );
  }
  enqueue(payload: JsonObject) {
    if (payload.type === 'email' && !this.emailEnabled) return;
    const id = operationId();
    this.sql.exec('INSERT INTO outbox(id,payload,created_at) VALUES (?,?,?)', id, JSON.stringify(payload), operationDate().toISOString());
    return id;
  }
  hydrate(kind: EntityKind, entity: Entity, depth = 0): Entity {
    const result = clone(entity);
    if (depth > 1) return result;
    const spec = ENTITY_SPECS[kind];
    for (const [field, raw] of Object.entries(spec.fields)) {
      const definition = raw as { type: string; target?: string };
      const value = result[field];
      if (definition.type !== 'relation' || !value) continue;
      const id = integer(object(value).id, true);
      if (definition.target === 'users') {
        try {
          result[field] = this.user(id);
        } catch (error) {
          if (error instanceof ReadRequired) throw error;
          result[field] = value;
        }
      } else if (definition.target && definition.target in ENTITY_SPECS) {
        const relation = this.maybe(definition.target as EntityKind, id);
        if (relation) result[field] = this.hydrate(definition.target as EntityKind, relation, depth + 1);
      }
    }
    if (kind === 'satis') {
      result.stokHareketleriLists = this.matching('satis-stok-hareketleris', 'satis.id', result.id).map(l => {
        const line = this.hydrate('satis-stok-hareketleris', l, 1);
        delete line.satis;
        return line;
      });
      const debt = this.matching('borc-alacaks', 'satis.id', result.id)[0];
      if (debt) {
        const hydratedDebt = this.hydrate('borc-alacaks', debt, 1);
        delete hydratedDebt.satis;
        result.borcAlacak = hydratedDebt;
      }
    }
    return result;
  }
}
