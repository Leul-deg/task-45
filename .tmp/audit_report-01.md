# SentinelSafe EHS — Static Delivery & Architecture Audit

**Audit date:** 2026-04-18  
**Scope:** `/home/leul/Documents/task-45` (primary implementation under `repo/`).  
**Method:** Static review of source, schema, tests, and documentation only. **No** project start, Docker, test execution, or runtime claims.

---

## 1. Verdict

**Overall conclusion: Partial Pass**

The `repo/` tree is a coherent full-stack Express + Vue + MySQL product with role-based access, incident and triage flows, search, exports, scheduled backups, anomaly detection, severity auto-escalation cron, and encrypted sensitive fields. **Cannot Confirm Statistically** that the stack runs correctly in production without execution. **Remaining gaps** versus the Prompt and common hardening expectations are summarized in §5 (operational scaling, tenancy, collaborator handling, diagnostics, browser verification, and test depth).

---

## 2. Scope and Static Verification Boundary

**Reviewed**

- Workspace layout; workspace `README.md`, `repo/README.md`, `repo/docker-compose.yml`, `repo/run_tests.sh`, `repo/backend/.env.example`
- Backend: `repo/backend/src/app.ts`, controllers (`auth`, `incidents`, `search`, `settings`, `exports`, `admin`, `reports`), `middleware/security.ts`, `middleware/audit.ts`, `middleware/rateLimit.ts`, `services/upload.ts`, `utils/crypto.ts`, `utils/moderator.ts`, `db/schema.sql`, `cron/backup.ts`, `cron/alerts.ts`, `cron/escalation.ts`, `index.ts`
- Frontend: `repo/frontend/src/router/index.ts`, `repo/frontend/src/utils/http.ts`, `package.json` scripts

**Not reviewed (no evidence gathered)**

- `node_modules/` contents (except path awareness), large binary archives under the workspace root unrelated to application source

**Intentionally not executed**

- Application servers, Docker Compose, databases, Jest/Vitest, linters, or network calls.

**Manual verification required**

- End-to-end browser flows, TLS termination in real deployments, `mysqldump` in production images, backup restore drills, applying `repo/backend/src/db/migrations/001_safety_resources_price_rating.sql` on existing databases where the schema predates new columns, and concurrency or timing-dependent behavior.

---

## 3. Repository / Requirement Mapping Summary

**Prompt core:** Disconnected-capable EHS platform; incident reporting and triage; configuration of types, severity, SLAs, and sites; keyword search with synonym and pinyin support; dashboards and CSV export; Express + MySQL; RBAC; sessions or JWT; short JWT TTL, replay controls; encryption and masking; uploads; rate limits; audit trail; backups; anomaly alerts.

**Implementation mapping:** Vue SPA with role-aware routing (`repo/frontend/src/router/index.ts:12-74`); Axios adds anti-replay headers on mutating calls (`repo/frontend/src/utils/http.ts:63-88`); Express mounts routers behind JWT and post-auth rate limiting (`repo/backend/src/app.ts:42-47`); incidents, search, settings, exports, reports, admin metrics; MySQL (`repo/backend/src/db/schema.sql`); backups and alerts (`repo/backend/src/cron/backup.ts`, `repo/backend/src/cron/alerts.ts`); severity auto-escalation job (`repo/backend/src/cron/escalation.ts`, `repo/backend/src/cron/index.ts`); resource pricing and rating in schema and `GET /search/resources` (`repo/backend/src/controllers/search.ts`); role-filtered settings responses (`repo/backend/src/controllers/settings.ts`); CSV export uses description truncation (`repo/backend/src/controllers/exports.ts`); audit rows written for failed requests with HTTP ≥ 500 (`repo/backend/src/middleware/audit.ts`).

---

## 4. Section-by-section Review

### 4.1 Hard Gates — Documentation and static verifiability

**Conclusion: Partial Pass**

**Rationale:** `repo/README.md` documents stack, structure, environment variables, Docker usage, health checks, and test entry. A workspace-root `README.md` points into `repo/`. `repo/docker-compose.yml` sets `REQUIRE_HTTPS` to `false` for the backend service while `repo/backend/.env.example` defaults it to `true`; operators must align compose, `.env`, and deployment expectations.

**Evidence:** `README.md:1-6`, `repo/README.md:13-137`, `repo/docker-compose.yml:33-44`, `repo/backend/.env.example:1-14`.

---

### 4.2 Hard Gates — Material deviation from Prompt

**Conclusion: Partial Pass**

**Rationale:** The implementation matches the EHS incident and safety-management domain described in the Prompt; remaining product-level deviations for this audit slice are listed in §5 where they affect operations or tenancy rather than core domain misalignment.

**Evidence:** `repo/backend/src/app.ts:40-47`, `repo/README.md:165-176`.

---

### 4.3 Delivery Completeness — Core requirements & end-to-end deliverable

**Conclusion: Partial Pass**

**Rationale:** Backend routes, schema, seeds, and Vue views support an end-to-end incident lifecycle, triage, search, exports, and administration. Browser-based verification of layout and role-specific views is outside static proof.

**Evidence:** `repo/README.md:34-35`, `repo/backend/src/app.ts:40-47`, `repo/frontend/src/router/index.ts:12-74`.

---

### 4.4 Engineering and Architecture Quality

**Conclusion: Partial Pass**

**Rationale:** Controllers, middleware, services, cron jobs, and database access are separated. In-memory nonce, rate-limit, and related stores do not span processes or instances; the README documents that constraint (`repo/README.md:208-225`).

**Evidence:** `repo/README.md:208-225`, `repo/backend/src/middleware/security.ts:8-10`, `repo/backend/src/middleware/rateLimit.ts:1-33`.

---

### 4.5 Engineering Details and Professionalism

**Conclusion: Partial Pass**

**Rationale:** Controllers use structured HTTP status codes and `console.error` for failures. The audit middleware persists rows for state-changing methods, including minimal payloads when the response status is HTTP ≥ 500 (`repo/backend/src/middleware/audit.ts:38-58`). Full “before/after” semantics on every failure path are not guaranteed at the same detail level as successful mutations.

**Evidence:** `repo/backend/src/middleware/audit.ts:29-58`, representative `console.error` usage in `repo/backend/src/controllers/incidents.ts`.

---

### 4.6 Prompt Understanding and Requirement Fit

**Conclusion: Partial Pass**

**Rationale:** Incident lifecycle, SLAs, search, exports, backups, and anomaly detection align with the scenario. Multi-tenant isolation beyond site strings and per-role row filtering is not modeled in schema (`repo/backend/src/db/schema.sql`).

**Evidence:** `repo/backend/src/db/schema.sql:12-28`, `repo/backend/src/controllers/incidents.ts:418-421`.

---

### 4.7 Aesthetics (frontend / full-stack)

**Conclusion: Cannot Confirm Statistically**

**Rationale:** Visual hierarchy, spacing, and interaction polish require a running browser. Statically, routes and role metadata exist on the Vue router (`repo/frontend/src/router/index.ts:12-104`); component tests exist under `repo/frontend/src/views/__tests__/`.

**Evidence:** `repo/frontend/src/router/index.ts:12-104`.

---

## 5. Issues / Suggestions (Severity-Rated)

### Blocker

*None identified with static certainty.*

---

### High

*None identified with static certainty.*

---

### Medium

1. **Single-process in-memory security and rate-limit state**  
   - **Conclusion:** Nonces, login attempt windows, post-auth rate limits, and related structures use in-memory stores that do not replicate across horizontal instances (`repo/README.md:208-225`, `repo/backend/src/middleware/security.ts:8-10`, `repo/backend/src/middleware/rateLimit.ts:7-33`, `repo/backend/src/controllers/auth.ts:19-20`).  
   - **Impact:** Load-balanced multi-instance deployments can weaken replay and rate-limit guarantees unless replaced with shared storage.  
   - **Minimum fix:** Document single-instance assumption clearly for operations, or back stores with Redis or database.

2. **No `tenant_id` / organization partition in schema**  
   - **Conclusion:** Data isolation relies on roles and columns such as `reporter_id` and site strings, not a tenant key (`repo/backend/src/db/schema.sql:12-28`).  
   - **Impact:** Multi-organization hosting on one database is not statically proven.  
   - **Minimum fix:** Add tenant model and enforce it in queries if multi-tenant deployment is required.

3. **Collaborator assignment not validated in application logic beyond database constraints**  
   - **Conclusion:** Status updates accept collaborator user IDs and insert into `incident_collaborators` (`repo/backend/src/controllers/incidents.ts:280-288`); foreign keys exist (`repo/backend/src/db/schema.sql:77-86`). Role or existence checks in the controller are limited.  
   - **Impact:** Mis-typed IDs may still be rejected by FKs; policy such as “dispatchers may only assign certain roles” is not expressed in code reviewed here.  
   - **Minimum fix:** Validate collaborator IDs and roles before insert if policy demands it.

---

### Low

4. **Diagnostic administrator POST remains registered**  
   - **Conclusion:** `POST /protected/admin-check` is mounted for role verification (`repo/backend/src/app.ts:53-59`).  
   - **Impact:** Extra surface area in production unless gated by environment.  
   - **Minimum fix:** Disable or guard behind `NODE_ENV` or feature flags in hardened deployments.

5. **Many API tests mock the database pool**  
   - **Conclusion:** Jest suites replace `dbPool` with mocks in several API tests (for example `repo/backend/tests/api/security.test.ts:7-21`, `repo/backend/tests/api/incidents.get.test.ts:44-52`).  
   - **Impact:** SQL or transaction defects may only surface in real-database suites.  
   - **Minimum fix:** Expand real-DB integration coverage for critical mutations.

---

## 6. Security Review Summary

| Area | Conclusion | Evidence & reasoning |
|------|------------|----------------------|
| Authentication entry points | **Partial Pass** | JWT login, refresh, logout, and consent flows (`repo/backend/src/controllers/auth.ts:309-317`); routers mounted under `repo/backend/src/app.ts:40-47`. |
| Route-level authorization | **Partial Pass** | `requireRole` on sensitive routes (for example `repo/backend/src/controllers/incidents.ts:561-581`, `repo/backend/src/controllers/exports.ts:152-161`). `GET /settings/config` returns a body filtered by role (`repo/backend/src/controllers/settings.ts:18-40`). |
| Object-level authorization | **Partial Pass** | Incident list and detail scoped by role (`repo/backend/src/controllers/incidents.ts:399-498`). Search scopes non-privileged users (`repo/backend/src/controllers/search.ts:149-152`). Collaborator assignment: see §5 Medium item 3. |
| Function-level authorization | **Partial Pass** | Settings mutations restricted by role (`repo/backend/src/controllers/settings.ts:285-320`). Reports routes split by verb and role (`repo/backend/src/controllers/reports.ts:266-289`). |
| Tenant / user data isolation | **Cannot Confirm Statistically** | No tenant column; see §5 Medium item 2. |
| Admin / internal / debug protection | **Partial Pass** | `/protected/admin-check` exists (`repo/backend/src/app.ts:53-59`). Production hardening not proven statically. |

---

## 7. Tests and Logging Review

| Dimension | Conclusion | Evidence |
|-----------|------------|----------|
| Unit tests | **Pass (existence)** | `repo/backend/package.json:6-7`, `repo/backend/jest.config.js:1-9`, `repo/backend/tests/unit/` including `escalation.test.ts` and `cron.test.ts`. |
| API / integration tests | **Pass (existence)** | `repo/backend/tests/api/`, `repo/backend/tests/integration/`, `repo/backend/tests/db/`. |
| Logging / observability | **Partial Pass** | `console.error` patterns; anomaly log path in `repo/backend/src/cron/alerts.ts:8-38`. |
| Sensitive data in logs / responses | **Partial Pass** | Audit sanitizer (`repo/backend/src/middleware/audit.ts:6-26`); CSV export truncates description text (`repo/backend/src/controllers/exports.ts`). |

---

## 8. Test Coverage Assessment (Static Audit)

### 8.1 Test Overview

- **Unit tests:** Jest, `repo/backend/jest.config.js:1-9`, `repo/backend/tests/unit/`.  
- **API / integration tests:** Supertest and real-DB suites under `repo/backend/tests/api/`, `integration/`, `db/`.  
- **Frontend tests:** Vitest, `repo/frontend/package.json:6-11`, `repo/frontend/src/views/__tests__/`.  
- **Documented commands:** `repo/README.md:103-136`, `repo/run_tests.sh:1-67`.

---

### 8.2 Coverage Mapping Table

| Requirement / risk point | Mapped test case(s) | Key assertion / mock | Coverage assessment | Gap | Minimum test addition |
|--------------------------|----------------------|-------------------------|----------------------|-----|------------------------|
| JWT login and lockout | `repo/backend/tests/api/auth.test.ts`, `repo/backend/tests/db/integration.test.ts` | 401 / 423 / 200 | **Basically covered** | Multi-instance lockout | Integration under multiple processes if required |
| Anti-replay | `repo/backend/tests/api/security.test.ts:24-113` | 400 / 403 / 409 | **Sufficient** for middleware | Per-route header gaps | Spot checks on additional mutating routes |
| Incident object-level GET | `repo/backend/tests/api/incidents.get.test.ts:152-163` | 403 for other user’s row | **Sufficient** | — | — |
| Escalation cron | `repo/backend/tests/unit/escalation.test.ts` | Mocked DB transaction | **Basically covered** | Real DB and clock | Optional `TEST_REAL_DB` scenario |
| HTTPS middleware | — | — | **Cannot confirm** | `repo/backend/src/middleware/security.ts:71-86` | Supertest with `REQUIRE_HTTPS` and forwarded proto |
| Anomaly cron | `repo/backend/tests/unit/cron.test.ts:76-216` | Alert append | **Sufficient** at unit level | Live SQL | Optional real-DB job test |

---

### 8.3 Security Coverage Audit

- **Authentication:** **Basically covered** for JWT.  
- **Route authorization:** **Basically covered** for sampled protected routes.  
- **Object-level authorization:** **Basically covered** for incident read paths; collaborator policy under-mapped (§5).  
- **Tenant isolation:** **Cannot confirm** (§5).  
- **Admin / internal:** **Partial** (`repo/backend/src/app.ts:53-59`).

---

### 8.4 Final Coverage Judgment

**Partial Pass**

**Explanation:** Solid unit and API coverage exists for auth, replay controls, incidents, and cron helpers, but mock-heavy suites, missing HTTPS matrix tests, and limited real-database coverage for escalation and anomaly jobs leave room for undetected integration defects.

---

## 9. Final Notes

- Static review does not validate Docker builds, migrations on legacy volumes, or Vue rendering.  
- The codebase presents as a structured product rather than a fragment, with explicit security middleware and broad automated tests under `repo/backend/tests/`.
