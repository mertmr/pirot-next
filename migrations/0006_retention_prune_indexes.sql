-- Retention prunes by age: an idempotency key once it is past a client's retry window, an outbox
-- row once it has been delivered for long enough to confirm. Neither age column had an index, so
-- every pass scanned the whole table to find rows that are usually a small fraction of it, on every
-- cron tick, for every deployment.
--
-- Leading on the age column alone, because that is the only predicate the prune uses: it filters
-- across every cooperative at once, so a tenant prefix would buy nothing and would stop the index
-- from satisfying the ORDER BY the bounded delete needs.
CREATE INDEX IF NOT EXISTS business_idempotency_created_at ON business_idempotency(created_at);

-- The existing pending-work index leads on tenant_id, which cannot serve this scan either.
CREATE INDEX IF NOT EXISTS business_outbox_delivered_at ON business_outbox(delivered_at);