import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { businessSchema, TABLES } from '../src/server/d1-schema';

// The tenant schema has two representations: the declarative ENTITY_SPECS plus
// businessSchema(), and the checked-in migration that D1 actually receives.
// Nothing else connects them, so a field added to ENTITY_SPECS would otherwise
// produce DDL that never reaches a deployed database. This asserts they agree.
//
// 0003 is the generated baseline. Later migrations are incremental by design and
// must not be folded back into 0003, which has already been applied.
describe('business schema', () => {
  it('matches the checked-in business baseline migration exactly', async () => {
    const migration = await readFile('migrations/0003_business.sql', 'utf8');
    expect(businessSchema()).toBe(migration);
  });

  it('keeps the revision guard unreachable from tenant SQL', () => {
    // business_write_guards carries the CHECK(matched=1) revision guard, and
    // business_versions holds the per-tenant revision. The guard is fail-closed:
    // if tenant SQL could read or write either, the mechanism would be defeated.
    expect(Object.keys(TABLES)).not.toContain('business_write_guards');
    expect(Object.keys(TABLES)).not.toContain('business_versions');
  });
});
