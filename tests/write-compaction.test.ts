import { describe, it, expect } from 'vitest';
import { compact } from '../src/server/d1-store';
import { MAX_BINDINGS } from '../src/server/d1-schema';
import type { SqlValue } from '../src/server/sql-contract';

/**
 * `compact` rewrites the buffered statements of a command before they are committed. The argument
 * for why that cannot change what lands is that every statement is a keyed write of a distinct
 * primary key and the tables do not reference each other — both properties of the code that produces
 * the statements, not of the statements themselves.
 *
 * These tests check the claim from the other direction. Given writes that satisfy those properties,
 * the compacted form must carry exactly the same writes: none dropped, none duplicated, and no
 * statement whose placeholder count disagrees with its bindings.
 */

interface Statement {
  sql: string;
  bindings: SqlValue[];
}
const upsert = (table: string, id: number, data = `{"id":${id}}`): Statement => ({
  sql: `INSERT INTO ${table}(tenant_id,id,data) VALUES (?,?,?) ON CONFLICT(tenant_id,id) DO UPDATE SET data=excluded.data`,
  bindings: [1, id, data],
});
const keyedUpsert = (table: string, value: string): Statement => ({
  sql: `INSERT INTO ${table}(tenant_id,kind,value) VALUES (?,?,?) ON CONFLICT(tenant_id,kind) DO UPDATE SET value=excluded.value`,
  bindings: [1, value, 'v'],
});
const remove = (table: string, id: number): Statement => ({
  sql: `DELETE FROM ${table} WHERE tenant_id=? AND id=?`,
  bindings: [1, id],
});
const snapshotCopy = (): Statement => ({
  sql: 'INSERT INTO business_backup_records(tenant_id,section,ordinal,data) SELECT 1,copied.* FROM (SELECT 1 AS section) copied',
  bindings: [1],
});

/** The upserted rows a statement writes, one array of bound values per row, whatever its batched shape. */
function upsertRows(statement: Statement): string[][] {
  const values = statement.sql.indexOf(') VALUES') + ') VALUES'.length,
    conflict = statement.sql.indexOf(') ON CONFLICT');
  if (values < ') VALUES'.length || (conflict >= 0 && conflict < values)) return [];
  const clause = `${statement.sql.slice(values, conflict < 0 ? undefined : conflict)})`,
    groups = clause.match(/\([^()]*\)/g) ?? [];
  if (!groups.length) return [];
  const width = statement.bindings.length / groups.length;
  return statement.bindings.reduce<string[][]>((rows, value, index) => {
    (rows[Math.floor(index / width)] ??= []).push(String(value));
    return rows;
  }, []);
}

/**
 * The rows a delete statement removes, identified the same way whether it was written as one row or
 * as an `IN (...)` list: target table plus the key column it pins.
 */
function removedKeys(statement: Statement): string[] {
  if (!statement.sql.startsWith('DELETE FROM ')) return [];
  const grouped = statement.sql.includes(' IN (');
  // Grouped deletes end `... AND id IN (...)`, so the key column is the last segment before the
  // list. Single-row deletes end `... AND id=?`, so it is the last segment before the final `=?`.
  const head = grouped ? statement.sql.slice(0, statement.sql.indexOf(' IN (')) : statement.sql.slice(0, statement.sql.lastIndexOf('=?')),
    target = head.slice(0, head.indexOf(' WHERE ')),
    column = head.includes(' AND ') ? head.slice(head.lastIndexOf(' AND ') + 5) : head.slice(head.indexOf(' WHERE ') + 7),
    ids = grouped ? statement.bindings.slice(1) : [statement.bindings[statement.bindings.length - 1]];
  return ids.map(id => `${target}#${column}=${id}`);
}

/** Every write a statement list performs, order-independent, so before and after can be compared. */
function writes(statements: Statement[]): string[] {
  return statements.flatMap(statement => [...upsertRows(statement).map(row => `write:${row.join('|')}`), ...removedKeys(statement)]).sort();
}
const placeholders = (sql: string) => (sql.match(/\?/g) ?? []).length;
const wellFormed = (statements: Statement[]) => statements.every(statement => placeholders(statement.sql) === statement.bindings.length);

describe('write compaction', () => {
  it('keeps every write exactly once when rows of one table are interleaved', () => {
    // The shape that matters: a command interleaves line, product, line, product, so grouping by
    // adjacency alone would not help. This is the sale the budget work was for.
    const statements: Statement[] = [];
    for (let line = 1; line <= 40; line++)
      statements.push(upsert('satis_stok_hareketleri', line), upsert('urun', line, `{"stok":${1000 - line}}`));
    statements.push(upsert('satis', 1));

    const out = compact(statements);

    expect(writes(out)).toEqual(writes(statements));
    expect(out.length).toBeLessThan(statements.length);
    expect(wellFormed(out)).toBe(true);
  });

  it('never emits a statement past the bound-parameter limit', () => {
    // Several tables all growing at once, so the limit has to hold across every statement produced.
    // Every key is distinct, which is what the per-(table,key) write map guarantees upstream.
    const statements: Statement[] = [];
    for (let i = 0; i < 120; i++)
      statements.push(
        upsert('satis_stok_hareketleri', i),
        remove('satis_stok_hareketleri', i),
        keyedUpsert('business_sequences', `shared-${i}`),
      );

    const out = compact(statements);

    expect(out.length).toBeGreaterThan(1);
    expect(out.every(statement => statement.bindings.length <= MAX_BINDINGS)).toBe(true);
    expect(writes(out)).toEqual(writes(statements));
    expect(wellFormed(out)).toBe(true);
  });

  it('splits one table across statements without losing or duplicating a row', () => {
    const statements: Statement[] = [];
    for (let i = 0; i < 300; i++) statements.push(upsert('satis_stok_hareketleri', i));

    const out = compact(statements);

    expect(out.length).toBeGreaterThan(1);
    expect(writes(out)).toEqual(writes(statements));
    expect(wellFormed(out)).toBe(true);
  });

  it('keeps a statement it cannot group, and everything around it, in order', () => {
    // The frozen-snapshot copy reads the rows around it, so it must keep its position rather than
    // being folded into a neighbouring group.
    const statements: Statement[] = [upsert('urun', 1), upsert('urun', 2), snapshotCopy(), upsert('urun', 3), upsert('urun', 4)];

    const out = compact(statements);
    const copy = out.findIndex(statement => statement.sql.includes('business_backup_records'));

    // `urun` rows on either side of the copy are grouped, so the copy ends up alone in the middle.
    expect(copy).toBe(1);
    expect(out[copy].sql).toBe(statements[2].sql);
    expect(writes(out.slice(0, copy))).toEqual(writes(statements.slice(0, 2)));
    expect(writes(out.slice(copy + 1))).toEqual(writes(statements.slice(3)));
  });

  it('does not borrow a conflict clause between statements that share a target', () => {
    // The emitted clause comes from whichever statement opened the group, so two statements whose
    // column lists match but whose conflict targets differ must stay separate.
    const first: Statement = {
      sql: 'INSERT INTO urun(tenant_id,id,data) VALUES (?,?,?) ON CONFLICT(tenant_id,id) DO UPDATE SET data=excluded.data',
      bindings: [1, 1, '{}'],
    };
    const second: Statement = {
      sql: 'INSERT INTO urun(tenant_id,id,data) VALUES (?,?,?) ON CONFLICT(tenant_id,data) DO UPDATE SET data=excluded.data',
      bindings: [1, 2, '{}'],
    };

    const out = compact([first, second]);

    expect(out).toHaveLength(2);
    expect(out[0].sql).toBe(first.sql);
    expect(out[1].sql).toBe(second.sql);
  });

  it('does not close other tables when one table spends its binding budget', () => {
    // The failure this guards: a group that runs out of budget used to flush every open group, so
    // the table with the widest rows — history, at eight bindings a row — determined how often all
    // the others were split. Compaction then produced one statement per table per handful of rows,
    // which is the per-row pattern it exists to remove.
    const history = (id: number): Statement => ({
      sql: `INSERT INTO business_history(tenant_id,id,kind,entity_id,actor,operation,before_json,after_json,at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,id) DO UPDATE SET kind=excluded.kind,entity_id=excluded.entity_id,actor=excluded.actor,operation=excluded.operation,before_json=excluded.before_json,after_json=excluded.after_json,at=excluded.at`,
      bindings: [1, id, 'uruns', id, 'actor', 'CREATE', null, null, '2026-10-01T00:00:00.000Z'],
    });
    const statements: Statement[] = [];
    // A hundred lines, each writing its own line row, its own product row and two history rows,
    // interleaved the way `saveSale` issues them.
    for (let line = 1; line <= 100; line++)
      statements.push(upsert('satis_stok_hareketleri', line), upsert('urun', line), history(line * 2), history(line * 2 + 1));

    const out = compact(statements);

    // Nothing is lost or duplicated, whatever the grouping does.
    expect(writes(out)).toEqual(writes(statements));
    expect(wellFormed(out)).toBe(true);
    // Four tables, and none of them split by another table's budget. A hundred three-binding rows
    // pack into four statements whatever else is being written; the pre-fix flush produced 74.
    expect(out.filter(s => s.sql.startsWith('INSERT INTO urun(')).length).toBeLessThanOrEqual(4);
    expect(out.filter(s => s.sql.startsWith('INSERT INTO satis_stok_hareketleri(')).length).toBeLessThanOrEqual(4);
    expect(out.length).toBeLessThanOrEqual(32);
    // Eight-binding history rows are the floor: 200 of them cannot fit in fewer than 16 statements.
    expect(out.filter(s => s.sql.startsWith('INSERT INTO business_history(')).length).toBeGreaterThanOrEqual(16);
    expect(Math.max(...out.map(statement => placeholders(statement.sql)))).toBeLessThanOrEqual(MAX_BINDINGS);
  });

  it('collapses deletes of one table into a single keyed statement', () => {
    const statements: Statement[] = [];
    for (let i = 1; i <= 20; i++) statements.push(remove('satis_stok_hareketleri', i));

    const out = compact(statements);

    expect(out).toHaveLength(1);
    expect(out[0].sql).toBe('DELETE FROM satis_stok_hareketleri WHERE tenant_id=? AND id IN (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    expect(out[0].bindings).toEqual([1, ...Array.from({ length: 20 }, (_, index) => index + 1)]);
  });
});
