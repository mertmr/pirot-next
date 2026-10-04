# Pirot Next

Pirot Next is a Turkish consumer-cooperative management application built with TanStack Start, React, and Cloudflare Workers. It supports sales, stock, cash, debts, producer payments, shifts, corrections, and reports, with Turkish and English interfaces.

All persistent application data lives in Cloudflare D1, including accounts, business records, history, request idempotency, background jobs, and report files. Financial effects commit together in a tenant-scoped D1 batch. Private stateless Durable Objects handle business computation, BCrypt, and report compression. Cloudflare Queues transport job references.

The default deployment targets Cloudflare Free. Outbound email is disabled; administrators set initial passwords, and report files remain available for authenticated download. Existing email jobs stay paused until sending is enabled. Runtime secrets are managed separately from application data.

## Local development

Requires Node.js 24.18+ and Bun 1.4.2.

```bash
bun install --frozen-lockfile
bun run local:setup
bun run dev
```

In another terminal:

```bash
bun run local:seed
```

Open <http://127.0.0.1:9070>. The synthetic local user is `developer`; its documented development-only password is `Synthetic-local-password-42`. Set `PIROT_DEV_PASSWORD` to change it; the browser suite honours the same variable. Local setup generates ignored secrets and initializes local D1 without contacting remote resources.

## Verification

```bash
bun run lint
bun run format:check
bun run typecheck
bun run test
bun run build
bun run test:migration  # Docker; isolated PostgreSQL with synthetic records
bunx --no-install playwright install --with-deps chromium
bun run test:browser
bun audit --audit-level=high
```

CI runs these checks without production secrets or deployment permissions. Persistence tests use actual Workerd/D1 behavior; browser journeys exercise the UI and API together. Playwright starts its own server on port 9071 and resets only `.wrangler/e2e`, a disposable local database separate from normal development. The browser workflow suite covers sales, debt collection, stock, expenses, transfers, and shift corrections using per-test synthetic tenants and disposable products. The Spring metrics regression now checks Cloudflare operations diagnostics. The bundled legacy schema fixture keeps PostgreSQL export verification independent of the original Spring repository.

## Deployment and recovery

The checked-in staging resource identifiers refer to the existing Pirot staging deployment. They are resource identifiers, not credentials. Forks should configure their own environment names, databases, queues, and URL in `wrangler.jsonc` before provisioning. Production configuration uses placeholders and cannot deploy until configured.

```bash
bunx --no-install wrangler login
bun run provision staging https://your-staging-url.example
bunx --no-install wrangler secret put AUTH_SECRET --env staging
bun run deploy:staging
```

Create a fresh signing secret using a password manager or secret generator. Keep credentials, exports, and operational data outside the repository. Deployment is an explicit local command; CI never deploys automatically.

One D1 SQL export includes identities, business data, history, jobs, and report BLOBs, and can be restored into independent SQLite. Preserve runtime secrets separately. See [architecture, provisioning, migration, and recovery](docs/cloudflare.md) and [security guidance](docs/security-secrets.md).

## Origin and license

This standalone application was extracted from the Pirot Cloudflare rewrite. It contains application source and synthetic tests with a fresh Git history. The existing Spring application remains a separate project.

[MIT license](LICENSE), copyright Mert Meral.
