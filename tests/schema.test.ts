import { describe, it, expect } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { businessSchema, TABLES } from '../src/server/d1-schema';

// The tenant schema has two representations: the declarative ENTITY_SPECS plus
// businessSchema(), and the checked-in migrations that D1 actually receives.
// Nothing else connects them, so a field added to ENTITY_SPECS would otherwise
// produce DDL that never reaches a deployed database. This asserts they agree.
//
// 0003 is the generated baseline. Later migrations are incremental by design and
// must not be folded back into 0003, which has already been applied.
const indexNames = (ddl: string) =>
  new Set([...ddl.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF NOT EXISTS\s+)?(\w+)/gi)].map(m => m[1]));

describe('business schema', () => {
  it('matches the checked-in business baseline migration exactly', async () => {
    const migration = await readFile('migrations/0003_business.sql', 'utf8');
    expect(businessSchema()).toBe(migration);
  });

  it('delivers every index the generated schema declares', async () => {
    // 0003 is frozen once applied, so anything added to businessSchema() afterwards has to reach
    // D1 through a later migration. Without this, an index could be declared in the generator and
    // exist nowhere, and the query that needed it would fall back to a scan that only shows up as
    // latency in production. Later migrations may add more; none may be missing.
    const applied = new Set<string>();
    for (const file of (await readdir('migrations')).filter(name => name.endsWith('.sql')))
      for (const name of indexNames(await readFile(`migrations/${file}`, 'utf8'))) applied.add(name);
    const declared = indexNames(businessSchema());
    expect(declared.size).toBeGreaterThan(0);
    expect([...declared].filter(name => !applied.has(name))).toEqual([]);
  });

  it('keeps the revision guard unreachable from tenant SQL', () => {
    // business_write_guards carries the CHECK(matched=1) revision guard, and
    // business_versions holds the per-tenant revision. The guard is fail-closed:
    // if tenant SQL could read or write either, the mechanism would be defeated.
    expect(Object.keys(TABLES)).not.toContain('business_write_guards');
    expect(Object.keys(TABLES)).not.toContain('business_versions');
  });
});
