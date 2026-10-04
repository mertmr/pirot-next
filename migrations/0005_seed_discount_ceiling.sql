-- The maximum discount a sale may carry is now a cooperative setting, replacing a rule that keyed
-- the allowance to one hardcoded tenant id: every cooperative was refused any discount except that
-- one, which could take up to 100%.
--
-- Seeding that cooperative's ceiling keeps the behaviour a deployed instance already had, so the
-- change narrows nothing unless an administrator decides to narrow it. Every other tenant needs no
-- row: an absent key falls back to zero, which is exactly what they were already restricted to.
--
-- The tenant id appears here, once, as the historical fact it is. It is deliberately not repeated in
-- application logic, which is what made the original rule unreviewable. Both statements are keyed on
-- the ceiling being absent, so applying this again cannot overwrite a setting an administrator has
-- since changed.
UPDATE business_tenant_meta
   SET value = json_set(coalesce(value, '{}'), '$.maxDiscountPercent', '100')
 WHERE tenant_id = 2
   AND key = 'settings'
   AND (value IS NULL OR json_extract(value, '$.maxDiscountPercent') IS NULL);

-- Gives that cooperative a row to hold the ceiling in, only if it has none yet. Guarded on the
-- tenant existing so a deployment that never had it applies this cleanly rather than failing the
-- foreign key, and on the row being absent so the update above is the only writer.
INSERT INTO business_tenant_meta(tenant_id, key, value)
SELECT 2, 'settings', '{"maxDiscountPercent":"100"}'
 WHERE EXISTS(SELECT 1 FROM tenants WHERE id = 2)
   AND NOT EXISTS(SELECT 1 FROM business_tenant_meta WHERE tenant_id = 2 AND key = 'settings');