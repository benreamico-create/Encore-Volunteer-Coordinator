# Encore

An execution hub for small, recurring volunteer-run community events. Volunteers never need accounts.

## Product rules

- The supplied screen designs govern appearance; the supplied PRD governs behavior.
- Follow PRD Section 7's exact fonts, colors and Echo logo. Use the uploaded brand assets.
- Build P0 in phase order; P1 is gated by the complete P0 self-test. Never build P2 or the PRD's non-goals.
- Organizer authentication explicitly uses email/password, scrypt hashes and PostgreSQL-backed sessions. Do not replace it with a different auth system without asking.
- Paid AI is off unless `AI_ENABLED=true` and `LLM_API_KEY` is present. Do not spend API credits during development/tests.
- Email sending is not part of the current P0 build. Copy and mailto must always work.
- No real people, venues or prices in seeds. Real event data is entered by the organizer in the published app.

## Run and verify

- Managed workflows: `artifacts/api-server: API Server` and `artifacts/encore: web`.
- `pnpm run typecheck`
- `pnpm --filter @workspace/api-server run self-test` — API phase checks with isolated fictional fixtures; cleans up its test users.
- `pnpm --filter @workspace/api-server run db:setup:dev` — additive development-only schema setup.
- `pnpm --filter @workspace/api-spec run codegen` — regenerate after every OpenAPI change.

## Sources

- App: `artifacts/encore`; API: `artifacts/api-server`.
- API contracts: `lib/api-spec/openapi.yaml`.
- SQL schema sources: `lib/db/schema-phase0.sql` through `schema-phase3.sql`; access through the existing `@workspace/db` PostgreSQL pool with parameterized SQL.
- Design/behavior source: `attached_assets/Encore_PRD_v2_1794938236144.md` and uploaded screen HTML.
- Setup, decisions and scope: `README.md`.

## Security and operations

- Every organizer access goes through `ownedSeries`/`ownedEvent`; nested resources also constrain event IDs.
- Volunteers get 192-bit private tokens. Never log or put private links in shared reminder messages.
- CSRF token required on organizer writes; session cookies HttpOnly, SameSite=Lax and Secure in production.
- Sign-up capacity uses an event-row database lock; limits live in PostgreSQL for Autoscale.
- Publish applies managed production schema changes. Never add startup DDL or production migration scripts.
- Autoscale target is configured. Set Max machines to 1 in Publishing machine configuration before first publish.
