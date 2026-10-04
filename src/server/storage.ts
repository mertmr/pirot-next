import { operationDate, operationId } from './operation-context';
import type { TenantSql, TransactionRunner, SqlValue } from './sql-contract';
import { ENTITY_SPECS, type EntityKind } from './entity-specs';
import { MAX_BINDINGS } from './d1-schema';
import { BusinessError, type Entity, type JsonObject, object, integer, clone, refId } from './value';
import type { CurrentUser } from './env';
export const TENANT_SCHEMA_VERSION = 2;
/**
 * The snapshot a relation to a user exposes. Members come from the directory rather than the tenant,
 * so this is the projection every reader must agree on.
 */
function projectUser(user: JsonObject): JsonObject {
  return {
    id: user.id,
    login: user.login,
    firstName: user.firstName ?? null,
    lastName: user.lastName ?? null,
    tenantId: user.tenantId,
  };
}
interface Ref {
  field: string;
  target: EntityKind | 'users';
  id: number;
  child?: Node;
}
interface Node {
  kind: EntityKind;
  value: Entity;
  depth: number;
  refs: Map<string, Ref>;
  expanded: boolean;
}
export class TenantStore {
  /**
   * The widest `IN (...)` list a read of `table` may bind.
   *
   * Relation reads are chunked so one oversized batch cannot exceed the bound-parameter limit, but
   * how large a chunk may be is not a constant. Every read is rewritten to merge the buffered writes
   * for the table it reads, and that rewrite binds one parameter per chunk of buffered JSON ahead of
   * anything the caller asked for. A fixed allowance is wrong in both directions: it forgets the row
   * kind an entity read binds alongside its id list, and it forgets that a large write set spans
   * several chunks. Either one turns into `too many SQL variables` at execution time, which fails the
   * whole command for a cooperative one product wider than the guess.
   *
   * `own` is what the query binds besides the id list: one for the row kind on an entity read, none
   * on a snapshot read. The floor keeps a caller's loop making progress if a write set ever
   * approaches the limit on its own.
   */
  private chunkLimit(table: 'entities' | 'users_snapshot', own: number): number {
    return Math.max(1, MAX_BINDINGS - own - this.sql.deltaBindings(table));
  }
  /**
   * Rows this operation has already seen. A lookup that has been served once is served again from
   * here, which is what keeps a loop over related rows from spending a query per iteration.
   *
   * Only presence is recorded, never the row itself: callers mutate the entities they receive, so
   * handing back a shared object would expose those mutations to the next reader.
   */
  private readonly seen = new Set<string>();
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
  /**
   * Verifies that the caller really owns the tenant it claims. The member snapshot is written by
   * `syncUsers`, which the handler always calls, so that there is exactly one writer and one
   * stored shape per user.
   */
  assertTenant(actor: CurrentUser) {
    if (!Number.isSafeInteger(actor.tenantId) || actor.tenantId <= 0) throw new BusinessError('tenantrequired', 403);
    const rows = this.sql.exec<{ value: string }>("SELECT value FROM tenant_meta WHERE key='tenant_id'").toArray();
    if (!rows.length) this.sql.exec("INSERT INTO tenant_meta(key,value) VALUES ('tenant_id',?)", String(actor.tenantId));
    else if (rows[0].value !== String(actor.tenantId)) throw new BusinessError('forbidden', 403);
  }
  tenantId(): number {
    return integer(this.sql.exec<{ value: string }>("SELECT value FROM tenant_meta WHERE key='tenant_id'").one().value, true);
  }
  /**
   * Cooperative-owned configuration. Absent keys fall back, so a new rule never
   * widens access. Persisted JSON holds booleans and numbers as well as strings,
   * so each shape is normalised rather than rejected.
   */
  setting(key: string, fallback = ''): string {
    const row = this.sql.exec<{ value: string }>("SELECT value FROM tenant_meta WHERE key='settings'").toArray()[0];
    const value = row ? object(JSON.parse(row.value))[key] : undefined;
    if (typeof value === 'string') return value;
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'number') return String(value);
    return fallback;
  }
  saveSettings(settings: JsonObject) {
    this.sql.exec(
      "INSERT INTO tenant_meta(key,value) VALUES ('settings',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      JSON.stringify(settings),
    );
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
    const entity = object(JSON.parse(row.data)) as Entity;
    this.seen.add(`${kind}:${entity.id}`);
    return entity;
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
    )) {
      const entity = object(JSON.parse(row.data)) as Entity;
      this.seen.add(`${kind}:${entity.id}`);
      yield entity;
    }
  }
  /**
   * Loads several rows of one kind with a single query. Callers that walk a list of related ids
   * use this so the cost does not grow with the length of the list.
   */
  select(kind: EntityKind, ids: number[]): Map<number, Entity> {
    const wanted = [...new Set(ids.map(id => integer(id, true)))].sort((a, b) => a - b),
      found = new Map<number, Entity>(),
      limit = this.chunkLimit('entities', 1);
    const remember = (entity: Entity) => {
      this.seen.add(`${kind}:${entity.id}`);
      found.set(Number(entity.id), entity);
    };
    for (let start = 0; start < wanted.length; start += limit) {
      const chunk = wanted.slice(start, start + limit);
      this.sql
        .exec<{ data: string }>(
          chunk.length === 1
            ? 'SELECT data FROM entities WHERE kind=? AND id=?'
            : `SELECT data FROM entities WHERE kind=? AND id IN (${chunk.map(() => '?').join(',')})`,
          kind,
          ...chunk,
        )
        .toArray()
        .forEach(row => remember(object(JSON.parse(row.data)) as Entity));
    }
    return found;
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
    if (!this.seen.has(`${kind}:${id}`)) this.get(kind, id);
    this.sql.exec('DELETE FROM entities WHERE kind=? AND id=?', kind, id);
  }
  user(id: number): JsonObject {
    const r = this.sql.exec<{ data: string }>('SELECT data FROM users_snapshot WHERE id=?', id).toArray()[0];
    if (!r) throw new BusinessError('notfound', 404);
    return projectUser(object(JSON.parse(r.data)));
  }
  /**
   * Refreshes the member snapshot from the directory payload the request carries.
   *
   * The whole snapshot is read once and only the members whose stored copy actually differs are
   * written. A cooperative with many users would otherwise spend a query per member on every
   * request, including reads, and would bump the tenant revision even when nothing changed.
   */
  syncUsers(members: JsonObject[], tenantId: number): void {
    if (!members.length) return;
    for (const member of members) if (member.tenantId !== tenantId) throw new BusinessError('forbidden', 403);
    const ids = members.map(m => integer(m.id, true)),
      current = new Map<number, string>(),
      limit = this.chunkLimit('users_snapshot', 0);
    // Chunked for the same reason `chunkLimit` exists: the member list is every user of the
    // cooperative, and the rewrite binds its own parameters ahead of this list.
    for (let start = 0; start < ids.length; start += limit) {
      const chunk = ids.slice(start, start + limit);
      for (const row of this.sql
        .exec<{ id: number; data: string }>(`SELECT id,data FROM users_snapshot WHERE id IN (${chunk.map(() => '?').join(',')})`, ...chunk)
        .toArray())
        current.set(row.id, row.data);
    }
    for (const member of members) {
      const id = integer(member.id, true),
        data = JSON.stringify(member);
      if (current.get(id) === data) continue;
      this.sql.exec('INSERT INTO users_snapshot(id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data', id, data);
    }
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
  /**
   * Resolves relations for a batch of entities at once.
   *
   * Every referenced id is known before anything is fetched, so each target kind costs one query
   * instead of one per row: a twenty line sale resolves all of its products with a single read.
   * A relation whose target is missing keeps its bare `{ id }` stub, exactly as a per-row lookup
   * would, and the whole operation is planned before a single query runs.
   */
  hydrateAll(kind: EntityKind, entities: Entity[]): Entity[] {
    const roots = entities.map(entity => this.plan(kind, entity, 0)),
      attached: Node[][] = roots.map(() => []);
    if (kind === 'satis' && roots.length) {
      // One scan covers every sale in the batch, so a page of sales costs the same as one sale.
      // Chunked because the caller decides the page size; a sale's lines all carry that sale's
      // id, so a chunked scan still returns each sale's lines in `ORDER BY id`.
      const saleIds = roots.map(root => integer(root.value.id, true)),
        lines: Entity[] = [],
        limit = this.chunkLimit('entities', 1);
      for (let start = 0; start < saleIds.length; start += limit) {
        const chunk = saleIds.slice(start, start + limit);
        lines.push(
          ...this.rows('satis-stok-hareketleris', `json_extract(data,'$.satis.id') IN (${chunk.map(() => '?').join(',')})`, chunk),
        );
      }
      roots.forEach((root, index) => {
        attached[index] = lines
          .filter(raw => refId(raw.satis) === saleIds[index])
          .map(raw => {
            const line = { ...raw };
            delete line.satis;
            return this.plan('satis-stok-hareketleris', line as Entity, 1);
          });
      });
    }
    this.resolve([...roots, ...attached.flat()], roots, attached);
    return roots.map(root => root.value);
  }
  hydrate(kind: EntityKind, entity: Entity): Entity {
    return this.hydrateAll(kind, [entity])[0];
  }
  private plan(kind: EntityKind, entity: Entity, depth: number): Node {
    const value = clone(entity) as Entity,
      node: Node = { kind, value, depth, refs: new Map(), expanded: false };
    if (depth > 1) return node;
    for (const [field, definition] of Object.entries(ENTITY_SPECS[kind].fields)) {
      const spec = definition as { type: string; target?: string },
        found = value[field];
      if (spec.type !== 'relation' || !found) continue;
      const id = integer(object(found).id, true);
      if (spec.target === 'users') node.refs.set(field, { field, target: 'users', id });
      else if (spec.target && spec.target in ENTITY_SPECS) node.refs.set(field, { field, target: spec.target as EntityKind, id });
    }
    return node;
  }
  private batchRows(table: 'entities' | 'users_snapshot', kind: string | null, ids: number[]): { id: number; data: string }[] {
    const found: { id: number; data: string }[] = [],
      limit = this.chunkLimit(table, kind ? 1 : 0);
    for (let start = 0; start < ids.length; start += limit) {
      const chunk = ids.slice(start, start + limit);
      found.push(
        ...(chunk.length === 1
          ? this.sql.exec<{ id: number; data: string }>(
              `SELECT id,data FROM ${table} WHERE ${kind ? 'kind=? AND ' : ''}id=?`,
              ...(kind ? [kind, chunk[0]] : [chunk[0]]),
            )
          : this.sql.exec<{ id: number; data: string }>(
              `SELECT id,data FROM ${table} WHERE ${kind ? 'kind=? AND ' : ''}id IN (${chunk.map(() => '?').join(',')})`,
              ...(kind ? [kind, ...chunk] : chunk),
            )
        ).toArray(),
      );
    }
    return found;
  }
  private resolve(nodes: Node[], roots: Node[], attached: Node[][]): void {
    const users = new Map<number, JsonObject>();
    for (;;) {
      const pending = nodes.filter(node => !node.expanded && node.depth <= 1);
      if (!pending.length) break;
      pending.forEach(node => (node.expanded = true));
      const wanted = new Map<EntityKind, Set<number>>(),
        wantedUsers = new Set<number>();
      for (const node of pending)
        for (const ref of node.refs.values()) {
          if (ref.target === 'users') wantedUsers.add(ref.id);
          else {
            const ids = wanted.get(ref.target) ?? new Set<number>();
            ids.add(ref.id);
            wanted.set(ref.target, ids);
          }
        }
      const userRows = new Map(this.batchRows('users_snapshot', null, [...wantedUsers]).map(row => [row.id, row]));
      for (const id of wantedUsers) {
        const row = userRows.get(id);
        if (row) users.set(id, projectUser(object(JSON.parse(row.data))));
      }
      const loaded = new Map<EntityKind, Map<number, Entity>>();
      for (const [target, ids] of wanted)
        loaded.set(
          target,
          new Map(this.batchRows('entities', target, [...ids]).map(row => [row.id, object(JSON.parse(row.data)) as Entity])),
        );
      for (const node of pending)
        for (const ref of node.refs.values()) {
          if (ref.target === 'users') continue;
          const data = loaded.get(ref.target)?.get(ref.id);
          if (data) {
            ref.child = this.plan(ref.target, data, node.depth + 1);
            nodes.push(ref.child);
          }
        }
    }
    // Deepest first, so a relation is only exposed once its own relations are resolved.
    for (const node of [...nodes].sort((a, b) => b.depth - a.depth))
      for (const ref of node.refs.values()) {
        if (ref.target === 'users') {
          const user = users.get(ref.id);
          if (user) node.value[ref.field] = user;
        } else if (ref.child) node.value[ref.field] = ref.child.value;
      }
    roots.forEach((root, index) => {
      if (root.kind === 'satis') root.value.stokHareketleriLists = attached[index].map(node => node.value);
    });
  }
}
