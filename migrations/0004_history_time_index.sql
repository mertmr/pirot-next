-- History is the financial audit trail and is never pruned. This index supports
-- time-bounded export and reporting over it without a table scan.
CREATE INDEX IF NOT EXISTS business_history_at ON business_history(tenant_id, at);
