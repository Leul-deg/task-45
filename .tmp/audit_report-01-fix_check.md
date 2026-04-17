# Audit report 01 — Fix check

Each row is a **resolved** finding: what changed in the repository and where to verify it. This file does not track open gaps.

| # | Severity | Issue (summary) | Resolution |
|---|----------|-------------------|------------|
| 1 | High | Severity auto-escalation configurable but not enforced | Implemented `repo/backend/src/cron/escalation.ts` and registered it from `repo/backend/src/cron/index.ts`. Cron reads `severity_rules`, evaluates open incidents, updates status to `Escalated` with `incident_actions` inside a transaction. Tests: `repo/backend/tests/unit/escalation.test.ts`, scheduler hook in `repo/backend/tests/unit/cron.test.ts`. |
| 2 | High | Safety resources lacked `price` / `rating` and richer sorts in schema/API | Added columns and seed data in `repo/backend/src/db/schema.sql` and `repo/backend/src/db/seed.sql`; optional `repo/backend/src/db/migrations/001_safety_resources_price_rating.sql`. Extended `repo/backend/src/controllers/search.ts` (filters, `popularity`, sorts). Tests: `repo/backend/tests/api/resources.test.ts`, `repo/backend/tests/db/frontend-contracts.test.ts`. |
| 3 | High | CSV incident export emitted full `description` | `repo/backend/src/controllers/exports.ts` applies `truncateExportDescription()` (80 characters, normalized whitespace) and uses header `Description (truncated)`. `repo/backend/tests/api/exports.test.ts` asserts the new header. |
| 4 | Medium | `GET /settings/config` exposed full manager JSON to every authenticated role | `repo/backend/src/controllers/settings.ts` introduces `filterSettingsConfigForRole()` so reporters receive types and sites only; dispatchers additionally receive SLA defaults and empty rule arrays; privileged roles receive the full payload. Tests: `repo/backend/tests/api/settings.test.ts`, `repo/backend/tests/db/frontend-contracts.test.ts`. |
| 5 | Medium | README security table vs code for `PATCH /settings/facility-sites` | `repo/README.md` security table lists `GET /settings/config` and splits `PATCH` rows so facility sites explicitly allow Safety Manager and Administrator. |
| 6 | Medium | Audit middleware skipped persistence on HTTP ≥ 500 | `repo/backend/src/middleware/audit.ts` always inserts a row; for status ≥ 500, `after_val` includes `outcome: "server_error"`, `status_code`, and sanitized `request_body`. |
| 7 | Low | Unused `authenticateJwt` import in `admin.ts` | Removed from `repo/backend/src/controllers/admin.ts`. |
| 8 | Low | No workspace-root `README.md` | Added workspace `README.md` pointing to `repo/README.md` and the application layout. |
