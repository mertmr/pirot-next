# Pirot Next

This is the standalone TanStack Start / Cloudflare version of Pirot, a Turkish consumer-cooperative management application. Tenant isolation and financial correctness are mandatory. More specific frontend guidance is in `src/client/AGENTS.md`.

## Invariants

- Resolve authenticated user and tenant on the server. Never trust browser tenant, ownership, prices, totals, discounts, stock effects, or paid state.
- Scope every business lookup, update, and delete to the authenticated tenant. Composite D1 keys are `(tenant_id,id)`. Global account/tenant administration is an explicit exception.
- Validate before mutating. Financial commands must commit primary records, stock, cash, debt, audit, outbox, and idempotency in one revision-guarded D1 batch. Retry conflicts from fresh reads. Discard every buffered write on failure.
- On edit/delete, reverse the old effect before applying its replacement. Preserve cash/card/deferred payment behavior, closed-shift corrections, retries, read-back, and reports.
- Use exact decimal arithmetic and explicit rounding. Persist and transmit decimal values as strings. Never lose cents through JavaScript numbers.
- D1 is the sole persistent application store, including report metadata/BLOBs and queued job payloads. Compute objects remain stateless; queue messages contain references. Runtime secrets belong in secret management.
- Business services own invariants, HTTP handlers own transport, and client screens express intent. Preserve Turkish names for established entities.
- User-visible strings and errors require Turkish and English translations.

## Development and verification

Use the locked graph: `bun install --frozen-lockfile`. Node.js 24.18+ and Bun 1.4.2 are the current toolchain. Run `bun run local:setup`, `bun run dev`, then `bun run local:seed` in a second terminal. Never use production data as a writable fixture.

Run the smallest focused proof appropriate to the change. Financial, tenant, security, and concurrency changes require actual Workerd/D1 persistence or HTTP integration tests; mocks alone are insufficient. Meaningful UI workflows require browser coverage.

- `bun run test -- tests/financial.test.ts -t 'focused case'`
- `bun run typecheck`
- `bun run lint`
- `bun run format:check`
- `bun run build`
- `bun run test:migration` uses Docker and a bundled schema-only fixture with synthetic records.
- `bun run test:browser` uses Playwright and synthetic local data.

Ordered schema changes belong in `migrations/`. `src/server/d1-schema.ts` generates the business DDL from `ENTITY_SPECS`; `tests/schema.test.ts` asserts that generated DDL still matches `migrations/0003_business.sql`, so regenerate and update the migration together or that test fails. Do not weaken assertions, timeouts, checks, or security rules to make unrelated work pass. State exactly what was and was not verified. Record the PID of any background server you start and stop only that owned process.

## Repository hygiene

Keep credentials, database exports, staging data, generated reports, plans, and temporary diagnostics out of Git. See `docs/security-secrets.md`. Public resource IDs are not credentials, but runtime secret values must never be pasted or committed.

Durable architecture and operational guidance belongs in `docs/`. Keep `.github/workflows/ci.yml`, `package.json`, and `bun.lock` aligned when changing the toolchain. CI never deploys automatically. The default target remains Cloudflare Free with outbound email disabled.

Never create, push, merge, or modify a pull request unless explicitly asked. Preserve licensing and attribution. Keep changes focused and prefer small, reviewable commits.
