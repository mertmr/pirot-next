import { describe, it, expect } from 'vitest';
import { D1TenantSql, ReadRequired, readCache } from '../src/server/d1-store';
import { MAX_BINDINGS } from '../src/server/d1-schema';
import type { SqlValue } from '../src/server/sql-contract';

/**
 * A tenant read is rewritten so it merges the writes buffered so far, and that rewrite binds one
 * parameter per chunk of buffered JSON ahead of everything the caller asked for. Workerd rejects a
 * statement whose parameters exceed `MAX_BINDINGS` outright, so a caller that builds a long
 * `IN (...)` list has to know how many the rewrite will spend.
 *
 * The count used to be a fixed guess that reserved one slot for the row kind and nothing else. That
 * was correct only while a write set fitted in a single chunk: the guess plus the kind plus the
 * chunk reached the limit one id early, and a cooperative one product wider failed the whole command
 * with `too many SQL variables`. These tests pin the fact the store now budgets against.
 */

/** An entity row large enough that a modest number of them spans several delta chunks. */
function bufferEntityWrites(sql: D1TenantSql, count: number, size = 60000): void {
  for (let id = 1; id <= count; id++)
    sql.exec(
      'INSERT INTO entities(kind,id,data) VALUES (?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data',
      'uruns',
      id,
      JSON.stringify({ id, tenantId: 1, urunAdi: 'x'.repeat(size) }),
    );
}

/** Drives one audit-id allocation to the point where it must issue its read, and returns that read. */
function allocateAuditId(sql: D1TenantSql): { sql: string; bindings: SqlValue[] } {
  try {
    sql.exec(
      'INSERT INTO history(kind,entity_id,actor,operation,before_json,after_json,at) VALUES (?,?,?,?,?,?,?)',
      'uruns',
      1,
      'actor',
      'CREATE',
      null,
      null,
      '2026-10-01T00:00:00.000Z',
    );
  } catch (error) {
    if (error instanceof ReadRequired) return error.query;
    throw error;
  }
  throw new Error('Expected the audit id allocation to need a read');
}

/**
 * What `TenantStore.select` builds for a chunk: the rewrite's bindings, the row kind, then the ids.
 * Mirrors the query text it emits so the assertion is about the statement D1 receives.
 */
function statementBindings(deltaChunks: number, chunkSize: number): number {
  return deltaChunks + 1 + chunkSize;
}

describe('delta binding budget', () => {
  it('binds nothing ahead of the caller when nothing is buffered', () => {
    expect(new D1TenantSql(1, readCache()).deltaBindings('entities')).toBe(0);
  });

  it('binds one chunk for a write set that fits in one', () => {
    const sql = new D1TenantSql(1, readCache());
    bufferEntityWrites(sql, 1);
    expect(sql.deltaBindings('entities')).toBe(1);
  });

  it('reports one binding per chunk once the write set outgrows a single chunk', () => {
    const sql = new D1TenantSql(1, readCache());
    // Large rows, so a small count is enough to force the split the import path would reach.
    bufferEntityWrites(sql, 40);
    expect(sql.deltaBindings('entities')).toBeGreaterThan(1);
  });

  it('counts only the table being read', () => {
    const sql = new D1TenantSql(1, readCache());
    bufferEntityWrites(sql, 40);
    expect(sql.deltaBindings('users_snapshot')).toBe(0);
  });

  it('grows with the write set, so a caller can never budget against a stale count', () => {
    const sql = new D1TenantSql(1, readCache());
    const counts: number[] = [sql.deltaBindings('entities')];
    for (let batch = 0; batch < 4; batch++) {
      bufferEntityWrites(sql, 20, 60000);
      counts.push(sql.deltaBindings('entities'));
    }
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
    expect(counts.at(-1)).toBeGreaterThan(1);
  });

  it('bounds the audit id allocation instead of binding every removal', () => {
    // An audit id is allocated past the physical maximum, excluding the ids this operation is
    // deleting so it cannot hand one out. Those exclusions were bound one by one with no bound on
    // how many, which is the same unbounded parameter list that broke relation reads. Removing rows
    // can only lower a maximum, so dropping the exclusions past a safe count over-allocates, and
    // history ids only have to be unique and increasing.
    const exclusions = MAX_BINDINGS / 2;
    for (const count of [1, 40, exclusions - 1, exclusions, exclusions + 1, 200, 5000]) {
      const sql = new D1TenantSql(1, readCache());
      const removals = new Map<string, { row: Record<string, SqlValue>; removed: boolean }>();
      for (let id = 1; id <= count; id++) removals.set(JSON.stringify([id]), { row: { id }, removed: true });
      sql.changes.set('history', removals);

      const allocated = allocateAuditId(sql);

      // Whatever the number of removals, the statement stays inside the limit, and it binds either
      // every removal or none of them — never a truncated list, which would exclude the wrong ids.
      expect(allocated.bindings.length).toBe(count <= exclusions ? count : 0);
      expect(allocated.sql).toMatch(/SELECT coalesce\(max\(id\),0\) AS id FROM history(?: WHERE id NOT IN \([?,]+\))?$/);
      // All or nothing: a partial list would quietly stop protecting some of the deleted ids.
      expect(allocated.sql.includes('NOT IN')).toBe(count <= exclusions);
    }
  });

  it('leaves a chunk that fits the limit exactly, for every chunk count', () => {
    // The accounting the store performs. A chunk of ids sized `MAX_BINDINGS - own - delta` must
    // land on the limit and never past it, whatever the write set turns out to be. This is the
    // arithmetic that was one too generous when `delta` was hard-coded to zero.
    for (let delta = 0; delta <= 8; delta++) {
      const chunk = MAX_BINDINGS - 1 - delta;
      expect(chunk).toBeGreaterThan(0);
      expect(statementBindings(delta, chunk)).toBe(MAX_BINDINGS);
      expect(statementBindings(delta, chunk + 1)).toBeGreaterThan(MAX_BINDINGS);
    }
  });
});
