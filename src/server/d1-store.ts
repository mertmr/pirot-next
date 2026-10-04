import { ENTITY_TABLES, MAX_BINDINGS, TABLES, type TableSpec } from './d1-schema';
import type { EntityKind } from './entity-specs';
import type { SqlCursor, SqlValue, TenantSql } from './sql-contract';
import { BusinessError } from './value';
import { operationContext, operationId, replayOperation } from './operation-context';

type Row = Record<string, SqlValue>;
interface Change {
  row: Row;
  removed: boolean;
}
interface Query {
  sql: string;
  bindings: SqlValue[];
}
/**
 * Read state that survives the replays of a single transaction attempt.
 *
 * `rows` caches whole result sets and `points` caches single-row lookups by primary key. Both are
 * keyed so that a lookup is issued at most once for the whole operation: the key deliberately
 * describes the physical read, not the query as rewritten for the buffered writes, so a growing
 * write set cannot invalidate a row that has already been loaded.
 */
export interface ReadCache {
  rows: Map<string, Row[]>;
  points: Map<string, Row | null>;
  historyBase: { signature: string; value: number } | null;
}
export function readCache(): ReadCache {
  return { rows: new Map(), points: new Map(), historyBase: null };
}
/**
 * Signals that a read could not be served from the plan and must be fetched from D1 before the
 * whole command is planned again.
 *
 * This travels as a thrown error through ordinary business logic, so any `catch` around a store
 * read must re-throw it. Catching it silently downgrades the read to whatever the fallback
 * returns, which for a tenant-scoped lookup means answering from incomplete data.
 */
export class ReadRequired extends Error {
  constructor(
    readonly key: string,
    readonly query: Query,
    /**
     * Called with the fetched rows so the driver can file the result somewhere the cache cannot
     * address by query key, such as a value that has to be combined with buffered writes.
     */
    readonly absorb?: (rows: Row[]) => void,
  ) {
    super('D1 read required');
  }
}
function cursor<T extends Row>(rows: T[]): SqlCursor<T> {
  return {
    toArray: () => rows,
    one: () => {
      if (rows.length !== 1) throw new Error('Expected exactly one SQL row');
      return rows[0];
    },
    [Symbol.iterator]: () => rows[Symbol.iterator](),
  };
}
function split(input: string): string[] {
  const result: string[] = [];
  let start = 0,
    depth = 0,
    quoted = false;
  for (let i = 0; i < input.length; i++) {
    if (input[i] === "'") {
      if (quoted && input[i + 1] === "'") {
        i++;
        continue;
      }
      quoted = !quoted;
    }
    if (!quoted) {
      if (input[i] === '(') depth++;
      if (input[i] === ')') depth--;
      if (input[i] === ',' && depth === 0) {
        result.push(input.slice(start, i).trim());
        start = i + 1;
      }
    }
  }
  result.push(input.slice(start).trim());
  return result;
}
// The existing services remain synchronous. Reads suspend planning and are replayed
// against D1; writes are buffered until validation succeeds and the revision matches.
export class D1TenantSql implements TenantSql {
  readonly databaseSize = null;
  readonly changes = new Map<string, Map<string, Change>>();
  readonly writes: Query[] = [];
  constructor(
    readonly tenantId: number,
    readonly cache: ReadCache,
  ) {
    if (!Number.isSafeInteger(tenantId) || tenantId <= 0) throw new BusinessError('tenantrequired', 403);
  }
  private spec(table: string): TableSpec {
    const spec = TABLES[table];
    if (!spec) throw new Error(`Unsupported tenant table: ${table}`);
    return spec;
  }
  private key(table: string, row: Row): string {
    return JSON.stringify(this.spec(table).keys.map(k => row[k]));
  }
  /**
   * Rewrites a tenant query so it reads the tenant's own rows plus the writes buffered so far.
   *
   * `withChanges` false produces the physical read alone. That variant is what makes a primary-key
   * lookup cacheable: the buffered delta is folded in by the caller instead of being baked into the
   * query text, so an operation that keeps writing does not re-read rows it already resolved.
   */
  private scoped(sql: string, bindings: SqlValue[], withChanges = true): Query {
    const tokens = sql.replace(/'(?:''|[^'])*'/g, "''");
    const ctes: string[] = [],
      params: SqlValue[] = [];
    for (const [table, spec] of Object.entries(TABLES)) {
      if (!new RegExp(`\\b${table}\\b`, 'i').test(tokens)) continue;
      const occurrences = [...tokens.matchAll(new RegExp(`\\b${table}\\b`, 'gi'))].length;
      const selectedKind =
        table === 'entities' &&
        occurrences === 1 &&
        /WHERE (?:\w+\.)?kind=\?/i.test(tokens) &&
        typeof bindings[0] === 'string' &&
        Object.hasOwn(ENTITY_TABLES, bindings[0])
          ? (bindings[0] as EntityKind)
          : null;
      const delta = withChanges
        ? [...(this.changes.get(table)?.values() ?? [])].filter(change => !selectedKind || change.row.kind === selectedKind)
        : [];
      const base = selectedKind
        ? `SELECT '${selectedKind}' AS kind,id,data FROM ${ENTITY_TABLES[selectedKind]} WHERE tenant_id=${this.tenantId}`
        : `SELECT ${spec.columns.join(',')} FROM ${spec.physical} WHERE tenant_id=${this.tenantId}`;
      const materialized = table === 'entities' && occurrences > 1 ? 'MATERIALIZED ' : '';

      if (!delta.length) {
        ctes.push(`${table} AS ${materialized}(${base})`);
        continue;
      }
      const name = `delta_${table}`;
      const chunks: string[] = [];
      let chunk: Change[] = [],
        bytes = 0;
      for (const change of delta) {
        const size = JSON.stringify(change).length;
        if (bytes + size > 500000 && chunk.length) {
          params.push(JSON.stringify(chunk));
          chunks.push('SELECT value FROM json_each(?)');
          chunk = [];
          bytes = 0;
        }
        chunk.push(change);
        bytes += size;
      }
      if (chunk.length) {
        params.push(JSON.stringify(chunk));
        chunks.push('SELECT value FROM json_each(?)');
      }
      ctes.push(`${name} AS MATERIALIZED (${chunks.join(' UNION ALL ')})`);
      ctes.push(
        `${table} AS ${materialized}(SELECT ${spec.columns.map(c => `b.${c}`).join(',')} FROM (${base}) b WHERE NOT EXISTS (SELECT 1 FROM ${name} d WHERE ${spec.keys.map(k => `b.${k}=json_extract(d.value,'$.row.${k}')`).join(' AND ')}) UNION ALL SELECT ${spec.columns.map(c => `json_extract(value,'$.row.${c}') AS ${c}`).join(',')} FROM ${name} WHERE json_extract(value,'$.removed')=0)`,
      );
    }
    return { sql: `${ctes.length ? `WITH ${ctes.join(',')} ` : ''}${sql}`, bindings: [...params, ...bindings] };
  }
  /**
   * Resolves one row by full primary key. Buffered writes answer first, so a row this operation has
   * already written is never re-read; otherwise the physical row is fetched once and cached under a
   * key that ignores the write set. That is what stops a long operation from spending one D1 query
   * per row it merely touches.
   *
   * The cached row is always the complete set of columns. Callers project different columns out of
   * the same key, and a row cached from a narrower read must not be used to answer a wider one.
   */
  private point(table: string, keyRow: Row): Row | null {
    const spec = this.spec(table),
      changed = this.changes.get(table)?.get(this.key(table, keyRow));
    if (changed) return changed.removed ? null : changed.row;
    const memo = `${table}|${JSON.stringify(spec.keys.map(k => keyRow[k]))}`;
    if (this.cache.points.has(memo)) return this.cache.points.get(memo)!;
    // The key values are bound from the already-resolved row, so a predicate that pinned a literal
    // and one that bound it address the same physical read.
    const sql = `SELECT ${spec.columns.join(',')} FROM ${table} WHERE ${spec.keys.map(k => `${k}=?`).join(' AND ')}`;
    throw new ReadRequired(
      `point|${memo}`,
      this.scoped(
        sql,
        spec.keys.map(k => keyRow[k] as SqlValue),
        false,
      ),
      rows => this.cache.points.set(memo, rows[0] ?? null),
    );
  }
  /** Collects the key columns a WHERE clause pins with an equality, when it pins exactly the key. */
  private pinnedKeys(table: string, where: string | undefined, bindings: SqlValue[]): Row | null {
    const spec = this.spec(table);
    if (!where) return null;
    const clauses = where.split(/ AND /i);
    if (clauses.length !== spec.keys.length) return null;
    const row: Row = {};
    let offset = 0;
    for (const clause of clauses) {
      const match = /^(\w+)=(\?|'[^']*')$/.exec(clause.trim());
      if (!match || !spec.keys.includes(match[1])) return null;
      row[match[1]] = match[2] === '?' ? bindings[offset++] : match[2].slice(1, -1);
    }
    return row;
  }
  private read(sql: string, bindings: SqlValue[]): Row[] {
    const simple = /^SELECT ([\w,]+) FROM (\w+) WHERE ([\w=?' :.-]+)$/i.exec(sql);
    if (simple && TABLES[simple[2]]) {
      const keyRow = this.pinnedKeys(simple[2], simple[3], bindings);
      if (keyRow) {
        const columns = simple[1].split(','),
          found = this.point(simple[2], keyRow);
        return found ? [Object.fromEntries(columns.map(c => [c, found[c] ?? null]))] : [];
      }
    }
    const query = this.scoped(sql, bindings),
      key = JSON.stringify(query);
    const rows = this.cache.rows.get(key);
    if (!rows) throw new ReadRequired(key, query);
    return rows;
  }
  /**
   * Allocates the next history id without reading the table once per audited write.
   *
   * The physical maximum is fetched at most once per transaction attempt and rows buffered here are
   * added on top. A removal recorded in this operation can invalidate that maximum, so the cache key
   * carries the removed ids.
   */
  private nextHistoryId(): number {
    const changes = [...(this.changes.get('history')?.values() ?? [])],
      removed = changes
        .filter(change => change.removed)
        .map(change => Number(change.row.id))
        .sort((a, b) => a - b),
      signature = JSON.stringify(removed);
    if (!this.cache.historyBase || this.cache.historyBase.signature !== signature) {
      const sql = `SELECT coalesce(max(id),0) AS id FROM history${removed.length ? ` WHERE id NOT IN (${removed.map(() => '?').join(',')})` : ''}`;
      throw new ReadRequired(`history|${signature}`, this.scoped(sql, removed, false), rows => {
        this.cache.historyBase = { signature, value: Number(rows[0]?.id ?? 0) };
      });
    }
    const buffered = changes.filter(change => !change.removed).map(change => Number(change.row.id));
    return Math.max(this.cache.historyBase.value, 0, ...buffered) + 1;
  }
  private writeRow(table: string, row: Row, removed = false) {
    const spec = this.spec(table),
      key = this.key(table, row);
    if (!this.changes.has(table)) this.changes.set(table, new Map());
    this.changes.get(table)!.set(key, { row, removed });
    let physical = spec.physical,
      columns = spec.columns,
      keys = spec.keys;
    if (table === 'entities') {
      physical = ENTITY_TABLES[row.kind as EntityKind];
      if (!physical) throw new BusinessError('invalidrequest');
      columns = ['id', 'data'];
      keys = ['id'];
    }
    if (removed)
      this.writes.push({
        sql: `DELETE FROM ${physical} WHERE tenant_id=? AND ${keys.map(k => `${k}=?`).join(' AND ')}`,
        bindings: [this.tenantId, ...keys.map(k => row[k])],
      });
    else
      this.writes.push({
        sql: `INSERT INTO ${physical}(tenant_id,${columns.join(',')}) VALUES (${['tenant_id', ...columns].map(() => '?').join(',')}) ON CONFLICT(tenant_id,${keys.join(',')}) DO UPDATE SET ${columns
          .filter(c => !keys.includes(c))
          .map(c => `${c}=excluded.${c}`)
          .join(',')}`,
        bindings: [this.tenantId, ...columns.map(c => row[c] ?? null)],
      });
  }
  exec<T extends Row = Row>(query: string, ...bindings: SqlValue[]): SqlCursor<T> {
    const sql = query.trim().replace(/;$/, '');
    if (/^CREATE\s/i.test(sql)) return cursor([] as T[]);
    if (/^PRAGMA table_info\(outbox\)$/i.test(sql)) return cursor(TABLES.outbox.columns.map(name => ({ name })) as unknown as T[]);
    if (/^SELECT\s/i.test(sql)) return cursor(this.read(sql, bindings) as T[]);
    if (sql.includes(';')) {
      if (bindings.length) throw new Error('Bindings with multiple statements unsupported');
      for (const statement of sql.split(';')) if (statement.trim()) this.exec(statement);
      return cursor([] as T[]);
    }
    const insert = /^INSERT INTO (\w+)\(([^)]+)\)\s+VALUES\s*\(/i.exec(sql);
    if (insert) {
      const table = insert[1],
        spec = this.spec(table),
        columns = split(insert[2]);
      let end = insert[0].length,
        depth = 1,
        quoted = false;
      for (; end < sql.length; end++) {
        const c = sql[end];
        if (c === "'") {
          if (quoted && sql[end + 1] === "'") {
            end++;
            continue;
          }
          quoted = !quoted;
        }
        if (!quoted && c === '(') depth++;
        if (!quoted && c === ')' && --depth === 0) break;
      }
      let index = 0;
      const value = (expression: string): SqlValue => {
        if (expression === '?') return bindings[index++];
        if (/^null$/i.test(expression)) return null;
        if (/^-?\d+(?:\.\d+)?$/.test(expression)) return Number(expression);
        if (/^'(?:''|[^'])*'$/.test(expression)) return expression.slice(1, -1).replace(/''/g, "'");
        throw new Error(`Unsupported SQL value: ${expression}`);
      };
      const expressions = split(sql.slice(insert[0].length, end));
      const row: Row = Object.fromEntries(columns.map((c, i) => [c, value(expressions[i])]));
      if (table === 'history' && row.id === undefined) row.id = this.nextHistoryId();
      const tail = sql.slice(end + 1);
      const returning = /RETURNING\s+(\w+)$/i.exec(tail);
      const echo = (value: Row) => cursor((returning ? [{ [returning[1]]: value[returning[1]] }] : []) as T[]);
      if (/ON CONFLICT/i.test(tail)) {
        const assignments = /DO UPDATE SET ([\s\S]+?)(?: RETURNING\s|$)/i.exec(tail)?.[1];
        if (!assignments) throw new Error('Unsupported upsert');
        const parsed = split(assignments).map(assignment => {
          const [field, expression] = assignment.split('=');
          return [field.trim(), expression.trim()] as [string, string];
        });
        for (const [, expression] of parsed)
          if (!/^excluded\.\w+$/.test(expression) && expression !== 'value+1' && expression !== 'max(value,excluded.value)')
            throw new Error(`Unsupported upsert expression: ${expression}`);
        const overwrite = table === 'entities' && parsed.every(([, expression]) => /^excluded\.\w+$/.test(expression));
        const known = this.changes.get(table)?.get(this.key(table, row));
        if (overwrite) {
          // An entity row is always written as a whole-row overwrite, so the stored row cannot
          // change the outcome and reading it back first would only cost a query per row.
          if (known && !known.removed && spec.columns.every(c => (row[c] ?? null) === (known.row[c] ?? null))) return echo(row);
        } else {
          // An expression such as value+1 is only meaningful against the stored row, so that row has
          // to be loaded before the merge.
          const old = this.read(
            `SELECT ${spec.columns.join(',')} FROM ${table} WHERE ${spec.keys.map(k => `${k}=?`).join(' AND ')}`,
            spec.keys.map(k => row[k]),
          )[0];
          if (old) {
            const updated = { ...old };
            for (const [field, expression] of parsed)
              updated[field] =
                expression === 'value+1'
                  ? Number(old.value) + 1
                  : expression === 'max(value,excluded.value)'
                    ? Math.max(Number(old.value), Number(row.value))
                    : row[expression.slice(9)];
            Object.assign(row, updated);
            if (spec.columns.every(c => (row[c] ?? null) === (old[c] ?? null))) return echo(row);
          }
        }
      }
      this.writeRow(table, row);
      return echo(row);
    }
    const copy = /^INSERT INTO (backup_records)\(([^)]+)\)\s+(SELECT[\s\S]+)$/i.exec(sql);
    if (copy) {
      const scoped = this.scoped(copy[3], bindings);
      const projection = scoped.sql.replace(/SELECT (?=[\s\S]*$)/, 'SELECT ');
      // INSERT ... WITH ... SELECT keeps the frozen snapshot inside the same D1 batch.
      this.writes.push({
        sql: `INSERT INTO business_backup_records(tenant_id,${copy[2]}) SELECT ${this.tenantId},copied.* FROM (${projection}) copied`,
        bindings: scoped.bindings,
      });
      return cursor([] as T[]);
    }
    const update = /^UPDATE (\w+) SET (.+?) WHERE (.+)$/i.exec(sql);
    if (update) {
      const assignments = split(update[2]);
      const values = bindings.slice(0, assignments.length);
      const rows = this.read(
        `SELECT ${this.spec(update[1]).columns.join(',')} FROM ${update[1]} WHERE ${update[3]}`,
        bindings.slice(assignments.length),
      );
      for (const old of rows) {
        const row = { ...old };
        assignments.forEach((a, i) => {
          if (!/^\w+=\?$/.test(a.trim())) throw new Error('Unsupported update');
          row[a.split('=')[0].trim()] = values[i];
        });
        this.writeRow(update[1], row);
      }
      return cursor([] as T[]);
    }
    const remove = /^DELETE FROM (\w+)(?: WHERE ([\s\S]+))?$/i.exec(sql);
    if (remove) {
      // A delete pinned to the full key only needs the key to record the removal, so the stored row
      // is skipped. Removing a row that was never there stays a no-op either way.
      const keyRow = this.pinnedKeys(remove[1], remove[2], bindings);
      if (keyRow) {
        this.writeRow(remove[1], keyRow, true);
        return cursor([] as T[]);
      }
      for (const row of this.read(
        `SELECT ${this.spec(remove[1]).columns.join(',')} FROM ${remove[1]}${remove[2] ? ` WHERE ${remove[2]}` : ''}`,
        bindings,
      ))
        this.writeRow(remove[1], row, true);
      return cursor([] as T[]);
    }
    throw new Error(`Unsupported tenant SQL: ${sql}`);
  }
}
/**
 * Counts what an operation costs against D1, so the query budget is asserted rather than assumed.
 * `reads` is one round trip to satisfy a suspended read, `writes` one committed batch.
 */
export const queryStats = { reads: 0, writes: 0 };

interface Group {
  head: string;
  tail: string;
  width: number;
  rows: SqlValue[][];
  order: number;
}
interface DeleteGroup {
  head: string;
  constant: SqlValue[];
  pinned: string;
  ids: SqlValue[];
  order: number;
}
function placeholders(rows: number, width: number): string {
  const row = `(${new Array(width).fill('?').join(',')})`;
  return new Array(rows).fill(row).join(',');
}

/**
 * Collapses the writes to one table into a single statement.
 *
 * The per-invocation budget is charged per statement, not per round trip, and `writeRow` emits one
 * statement per row, so a twenty-line sale paid four statements for every line and the reverse side
 * of an edit paid one more per removed line. Buffering rows that share a table into a single `VALUES`
 * list, or a run of key-pinned deletes into one `IN (...)` list, makes the cost track the number of
 * tables a command touches instead of the number of rows it writes.
 *
 * Rows are grouped by target table rather than by adjacency, because a command interleaves them:
 * line, product, line, product. That reorders statements relative to how the command issued them,
 * which cannot change what is committed: every statement is a keyed write of a distinct primary key,
 * `changes` has already collapsed each key to a single buffered write, and the tables carry no
 * foreign keys to each other. Only a statement that is neither a keyed upsert nor a generated
 * delete keeps its position, because the frozen-snapshot copy reads the rows around it.
 */
export function compact(writes: Query[]): Query[] {
  const out: Query[] = [];
  // Includes the trailing space so a group of one row is emitted byte-identically to the statement it
  // replaces, which keeps a committed batch readable against the code that produced it.
  const OPEN = ') VALUES ';
  let upserts: Group[] = [],
    deletes: DeleteGroup[] = [];
  const flush = () => {
    out.push(
      ...deletes
        .sort((a, b) => a.order - b.order)
        .map(group => ({
          sql: `${group.head} IN (${group.ids.map(() => '?').join(',')})`,
          bindings: [...group.constant, ...group.ids],
        })),
    );
    out.push(
      ...upserts
        .sort((a, b) => a.order - b.order)
        .map(group => ({ sql: `${group.head}${placeholders(group.rows.length, group.width)}${group.tail}`, bindings: group.rows.flat() })),
    );
    upserts = [];
    deletes = [];
  };
  const pushUpsert = (head: string, tail: string, bindings: SqlValue[]) => {
    const width = bindings.length,
      // Matched on the conflict clause as well as the column list. Today a table's column list
      // determines its `ON CONFLICT` target, so the two cannot disagree — but the emitted SQL takes
      // the clause from whichever query opened the group, so a table whose conflict target ever
      // varied per row would write later rows under the wrong one.
      existing = upserts.find(
        candidate => candidate.head === head && candidate.tail === tail && candidate.rows.length * candidate.width + width <= MAX_BINDINGS,
      );
    if (existing) {
      existing.rows.push(bindings);
      return;
    }
    // The table is already being written, so this row starts a second statement for it rather than
    // growing the first past the bound-parameter limit. Both lists are rebound by `flush`, so the
    // push below has to read them again rather than work from an array captured before it.
    if (upserts.some(candidate => candidate.head === head && candidate.tail === tail)) flush();
    upserts.push({ head, tail, width, rows: [bindings], order: upserts.length });
  };
  const pushDelete = (head: string, bindings: SqlValue[]) => {
    const constant = bindings.slice(0, -1),
      pinned = JSON.stringify(constant),
      id = bindings[bindings.length - 1];
    const existing = deletes.find(
      candidate => candidate.head === head && candidate.pinned === pinned && candidate.ids.length + constant.length + 1 <= MAX_BINDINGS,
    );
    if (existing) {
      existing.ids.push(id);
      return;
    }
    if (deletes.some(candidate => candidate.head === head && candidate.pinned === pinned)) flush();
    deletes.push({ head, constant, pinned, ids: [id], order: deletes.length });
  };
  for (const query of writes) {
    const open = query.sql.indexOf(OPEN),
      close = query.sql.indexOf(') ON CONFLICT');
    if (open >= 0 && close >= 0) {
      pushUpsert(query.sql.slice(0, open + OPEN.length), query.sql.slice(close + 1), query.bindings);
      continue;
    }
    // A generated delete pins its key with `col=?` on every column, so all but the last value are
    // shared by rows targeting the same table and only that last value varies per row.
    const marker = query.sql.lastIndexOf('=?');
    if (query.sql.startsWith('DELETE FROM ') && marker > 0 && marker === query.sql.length - 2) {
      pushDelete(query.sql.slice(0, marker), query.bindings);
      continue;
    }
    flush();
    out.push(query);
  }
  flush();
  return out;
}
export async function d1Transaction<T>(db: D1Database, tenantId: number, run: (sql: D1TenantSql) => Promise<T>): Promise<T> {
  const context = operationContext();
  await db.prepare('INSERT INTO business_versions(tenant_id,version) VALUES (?,0) ON CONFLICT(tenant_id) DO NOTHING').bind(tenantId).run();
  for (let attempt = 0; attempt < 8; attempt++) {
    const version = await db.prepare('SELECT version FROM business_versions WHERE tenant_id=?').bind(tenantId).first<number>('version');
    const cache = readCache();
    for (let reads = 0; reads < 20000; reads++) {
      const sql = new D1TenantSql(tenantId, cache);
      let result: T;
      try {
        result = await replayOperation(context, () => run(sql));
      } catch (error) {
        if (!(error instanceof ReadRequired)) throw error;
        queryStats.reads++;
        const rows = await db
          .prepare(error.query.sql)
          .bind(...error.query.bindings)
          .all<Row>();
        cache.rows.set(error.key, rows.results);
        error.absorb?.(rows.results);
        continue;
      }
      if (!sql.writes.length) {
        const current = await db.prepare('SELECT version FROM business_versions WHERE tenant_id=?').bind(tenantId).first<number>('version');
        if (current === version) return result;
        break;
      }
      const token = operationId(),
        statements = compact(sql.writes),
        batch = [
          db.prepare('UPDATE business_versions SET version=version+1 WHERE tenant_id=? AND version=?').bind(tenantId, version),
          db.prepare('INSERT INTO business_write_guards(token,matched) VALUES (?,changes())').bind(token),
          ...statements.map(q => db.prepare(q.sql).bind(...q.bindings)),
          db.prepare('DELETE FROM business_write_guards WHERE token=?').bind(token),
        ];
      try {
        // Counted from the batch rather than as `statements.length + 3`, so the budget cannot drift
        // from the statements actually sent when a guard is added or removed.
        queryStats.writes += batch.length;
        await db.batch(batch);
        return result;
      } catch (error) {
        if (error instanceof Error && /CHECK constraint failed: matched=1/.test(error.message)) break;
        throw error;
      }
    }
  }
  throw new BusinessError('conflict', 409);
}
