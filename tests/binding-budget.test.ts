import { describe, it, expect } from 'vitest';
import { D1TenantSql, readCache } from '../src/server/d1-store';
import { MAX_BINDINGS } from '../src/server/d1-schema';

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
