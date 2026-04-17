# SentinelSafe EHS — Static Delivery & Architecture Audit (Report 2)

**Audit date:** 2026-04-17  
**Scope:** `/home/leul/Documents/task-45` (primary implementation under `repo/`).  
**Method:** Static review of source, schema, tests, and documentation only. **No** project start, Docker, test execution, or runtime claims.

---

## 1. Verdict

**Overall conclusion: Partial Pass**

The implementation under `repo/` aligns with the Prompt on JWT-based access, incident and triage APIs, search, exports, scheduled jobs, and role-aware configuration. **Cannot Confirm Statistically** that end-to-end behavior matches intent without running the application. **Open findings** for this pass are limited to authentication mode, time semantics for escalation versus triage display, safety-resource UI parity with the API, and automated test coverage for HTTPS middleware (see §5).

---

## 2. Scope and Static Verification Boundary

**Reviewed**

- Workspace layout; workspace `README.md`, `repo/README.md`, `repo/docker-compose.yml`, `repo/run_tests.sh`, `repo/backend/.env.example`
- Backend: `repo/backend/src/app.ts`, controllers (`auth`, `incidents`, `search`, `settings`, `exports`, `admin`, `reports`), `middleware/security.ts`, `middleware/audit.ts`, `middleware/rateLimit.ts`, `services/upload.ts`, `utils/crypto.ts`, `utils/moderator.ts`, `db/schema.sql`, `cron/backup.ts`, `cron/alerts.ts`, `cron/escalation.ts`, `utils/businessHours.ts`, `index.ts`
- Frontend: `repo/frontend/src/router/index.ts`, `repo/frontend/src/utils/http.ts`, `repo/frontend/src/views/Triage.vue`, `repo/frontend/src/views/Resources.vue`, `package.json` scripts
- Tests: `repo/backend/jest.config.js`, `repo/backend/tests/**`, `repo/frontend/src/**/__tests__/**`

**Not reviewed (no evidence gathered)**

- `node_modules/` contents except path awareness; large unrelated binaries at workspace root

**Intentionally not executed**

- Application servers, Docker Compose, databases, Jest/Vitest, linters, or network calls.

**Manual verification required**

- Browser flows, TLS in real deployments, `mysqldump` availability, backup restore, migration scripts on existing databases, live cron timing, and concurrency.

---

## 3. Repository / Requirement Mapping Summary

**Prompt core:** EHS scenario: incidents, triage, configuration, synonym and pinyin search for incidents and resources, dashboards, export, RBAC, **sessions or JWT**, replay controls, audit, backups, alerts.

**Implementation mapping:** JWT and anti-replay on mutating HTTP calls (`repo/frontend/src/utils/http.ts:63-88`, `repo/backend/src/middleware/security.ts`); severity rules persisted in settings (`repo/backend/src/controllers/settings.ts`); auto-escalation cron compares elapsed time from `created_at` (`repo/backend/src/cron/escalation.ts:56-100`); triage view computes SLA styling with business-day helpers locally (`repo/frontend/src/views/Triage.vue:44-111`); `GET /search/resources` supports price, rating, popularity, and extended sort keys (`repo/backend/src/controllers/search.ts`); `Resources.vue` submits a narrower parameter set (`repo/frontend/src/views/Resources.vue:18-52`, `repo/frontend/src/views/Resources.vue:132-138`).

---

## 4. Section-by-section Review

### 4.1 Hard Gates — Documentation and static verifiability

**Conclusion: Partial Pass**

**Rationale:** Primary documentation lives in `repo/README.md`; workspace `README.md` links the tree. `repo/docker-compose.yml` and `repo/backend/.env.example` use different defaults for `REQUIRE_HTTPS`; readers must reconcile them for local versus production use.

**Evidence:** `README.md:1-6`, `repo/README.md:41-137`, `repo/docker-compose.yml:33-44`, `repo/backend/.env.example:1-14`.

---

### 4.2 Hard Gates — Material deviation from Prompt

**Conclusion: Partial Pass**

**Rationale:** Only JWT-based authentication paths are present in the reviewed backend (`repo/backend/src/app.ts:40-47`, `repo/backend/src/controllers/auth.ts:309-317`). Calendar-hour escalation logic in the cron job can diverge from business-time SLA presentation in the triage view (`repo/backend/src/cron/escalation.ts:56-100`, `repo/frontend/src/views/Triage.vue:44-111`). Resource economics filters exist on the API but not in the default resource search form in the SPA (`repo/backend/src/controllers/search.ts`, `repo/frontend/src/views/Resources.vue:18-138`).

**Evidence:** `repo/backend/src/controllers/auth.ts:309-317`, `repo/backend/src/cron/escalation.ts:56-100`, `repo/frontend/src/views/Triage.vue:44-111`, `repo/frontend/src/views/Resources.vue:18-138`.

---

### 4.3 Delivery Completeness — Core requirements & end-to-end deliverable

**Conclusion: Partial Pass**

**Rationale:** Backend exposes resource filters and sorts that the Prompt associates with analytics-style discovery; the Vue resources screen does not yet bind those parameters or display those fields.

**Evidence:** `repo/backend/src/controllers/search.ts` (resource branch), `repo/frontend/src/views/Resources.vue:18-138`.

---

### 4.4 Engineering and Architecture Quality

**Conclusion: Partial Pass**

**Rationale:** Cron, controllers, and middleware remain modular. Escalation is isolated in `repo/backend/src/cron/escalation.ts` and started from `repo/backend/src/cron/index.ts:3-16`.

**Evidence:** `repo/backend/src/cron/index.ts:3-16`, `repo/backend/src/cron/escalation.ts:1-165`.

---

### 4.5 Engineering Details and Professionalism

**Conclusion: Partial Pass**

**Rationale:** Audit middleware records failures with HTTP status ≥ 500 using a compact payload shape (`repo/backend/src/middleware/audit.ts:38-58`). Rich “before” snapshots on every error remain optional.

**Evidence:** `repo/backend/src/middleware/audit.ts:38-58`.

---

### 4.6 Prompt Understanding and Requirement Fit

**Conclusion: Partial Pass**

**Rationale:** Fit is strong for incident workflows and backend resource search. Gaps are concentrated in session optionality, hour semantics consistency, and SPA coverage for resource economics (§5).

**Evidence:** §5 evidence citations.

---

### 4.7 Aesthetics (frontend / full-stack)

**Conclusion: Cannot Confirm Statistically**

**Rationale:** Layout and visual quality require a browser. Router and view files exist under `repo/frontend/src/`.

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

1. **Authentication: no server-side session implementation**  
   - **Conclusion:** The Prompt allows server-side sessions or JWTs; reviewed backend code exposes JWT login, refresh, and logout only (`repo/backend/src/controllers/auth.ts:309-317`, `repo/backend/src/app.ts:40-47`).  
   - **Evidence:** `repo/backend/src/app.ts:40-47`, `repo/backend/src/controllers/auth.ts:309-317`.  
   - **Impact:** Deployments that require cookie-bound sessions need additional design.  
   - **Minimum fix:** Add optional session transport and storage, or document JWT-only operation as the supported configuration.

2. **Severity auto-escalation uses calendar hours; triage SLA indicators use business-time helpers**  
   - **Conclusion:** Escalation compares elapsed wall-clock time from `created_at` to `escalate_after_hours` (`repo/backend/src/cron/escalation.ts:56-100`). Triage uses local business-day logic for elapsed minutes and hours (`repo/frontend/src/views/Triage.vue:44-111`).  
   - **Evidence:** `repo/backend/src/cron/escalation.ts:56-100`, `repo/frontend/src/views/Triage.vue:44-111`.  
   - **Impact:** Automation timing and on-screen SLA risk colors can disagree.  
   - **Minimum fix:** Align cron with `repo/backend/src/utils/businessHours.ts`, or document calendar-hour semantics for rules.

3. **Safety resources: API supports price, rating, and extended sorts; Vue form does not**  
   - **Conclusion:** `GET /search/resources` accepts price and rating filters and additional `sort` values (`repo/backend/src/controllers/search.ts`). `Resources.vue` does not pass those query parameters and limits sort options in the template (`repo/frontend/src/views/Resources.vue:18-52`, `repo/frontend/src/views/Resources.vue:132-138`).  
   - **Evidence:** `repo/backend/src/controllers/search.ts`, `repo/frontend/src/views/Resources.vue:18-138`.  
   - **Impact:** Users relying on the SPA do not obtain the full search surface the API offers.  
   - **Minimum fix:** Extend filters, request params, types, and results table in `Resources.vue`.

---

### Low

4. **HTTPS enforcement not covered by automated tests in the reviewed mapping**  
   - **Conclusion:** `requireHttps` is implemented in `repo/backend/src/middleware/security.ts:71-86`; no Supertest matrix toggling `REQUIRE_HTTPS` and `x-forwarded-proto` appears in the §8.2 table for this pass.  
   - **Evidence:** `repo/backend/src/middleware/security.ts:71-86`.  
   - **Minimum fix:** Add Jest cases that flip environment variables and assert status codes.

---

## 6. Security Review Summary

| Area | Conclusion | Evidence & reasoning |
|------|------------|----------------------|
| Authentication entry points | **Partial Pass** | JWT flows only in reviewed code paths; see §5 Medium item 1 (`repo/backend/src/controllers/auth.ts:309-317`). |
| Route-level authorization | **Partial Pass** | `requireRole` on sensitive routes; settings `GET` response filtered by role (`repo/backend/src/controllers/settings.ts:18-40`, `repo/backend/src/controllers/incidents.ts:561-581`). |
| Object-level authorization | **Partial Pass** | Incident and search scoping (`repo/backend/src/controllers/incidents.ts:399-498`, `repo/backend/src/controllers/search.ts:149-152`). |
| Function-level authorization | **Partial Pass** | Settings and reports controllers (`repo/backend/src/controllers/settings.ts:285-320`, `repo/backend/src/controllers/reports.ts:266-289`). |

---

## 7. Tests and Logging Review

| Dimension | Conclusion | Evidence |
|-----------|------------|----------|
| Unit tests | **Pass (existence)** | `repo/backend/jest.config.js:1-9`, `repo/backend/tests/unit/escalation.test.ts`, `repo/backend/tests/unit/cron.test.ts`. |
| API / integration tests | **Pass (existence)** | `repo/backend/tests/api/`, `repo/backend/tests/db/`. |
| Logging / observability | **Partial Pass** | `repo/backend/src/cron/alerts.ts:8-38`, `repo/backend/src/cron/escalation.ts:151-153`, controller `console.error` usage. |
| Sensitive data in logs / responses | **Partial Pass** | Audit sanitizer (`repo/backend/src/middleware/audit.ts:6-26`); CSV uses truncated description field (`repo/backend/src/controllers/exports.ts`). |

---

## 8. Test Coverage Assessment (Static Audit)

### 8.1 Test Overview

Frameworks and test entry points are documented in `repo/README.md:103-136` and `repo/backend/jest.config.js:1-9`.

---

### 8.2 Coverage Mapping Table

| Requirement / risk point | Mapped test case(s) | Key assertion / mock | Coverage assessment | Gap | Minimum test addition |
|--------------------------|----------------------|-------------------------|----------------------|-----|------------------------|
| Escalation cron | `repo/backend/tests/unit/escalation.test.ts` | Mocked transaction | **Basically covered** | Real database and wall clock | Optional integration job |
| Resource API filters | `repo/backend/tests/api/resources.test.ts` | Filter query params | **Basically covered** | SPA wiring | Frontend contract or E2E |
| HTTPS middleware | — | — | **Cannot confirm** | §5 Low item 4 | Env-toggled Supertest |
| JWT and anti-replay | `repo/backend/tests/api/auth.test.ts`, `repo/backend/tests/api/security.test.ts` | 401 / 400 / 403 / 409 | **Sufficient** | — | — |

---

### 8.3 Security Coverage Audit

- **Authentication:** **Basically covered** for JWT.  
- **Route authorization:** **Basically covered** for sampled routes.  
- **Object-level authorization:** **Basically covered** for incidents in existing suites.  

---

### 8.4 Final Coverage Judgment

**Partial Pass**

**Explanation:** Unit tests cover escalation logic with mocks, and API tests cover resource query parameters under mocks, but HTTPS behavior and real-database escalation runs remain weakly evidenced in static mapping alone.

---

## 9. Final Notes

- Static analysis does not substitute for running `repo/run_tests.sh` or opening the built UI.  
- Remaining work for this audit slice is concentrated in §5: sessions, hour semantics, resource SPA parity, and HTTPS test harnessing.
