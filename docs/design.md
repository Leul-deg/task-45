# SentinelSafe EHS Platform — Design Document

## 1. Architecture Overview

SentinelSafe is a full-stack enterprise health and safety (EHS) incident management platform. The system enables organizations to report, triage, investigate, and analyze workplace incidents with full audit traceability and security controls.

### Technology Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Vue 3 + Vite + TypeScript, Vue Router 5, Axios, Chart.js + vue-chartjs |
| **Backend** | Node.js + Express + TypeScript |
| **Database** | MySQL 8.0 |
| **Containerization** | Docker Compose (frontend, backend, MySQL) |
| **Web Server** | Nginx (serves Vue SPA build) |
| **Scheduling** | node-cron (backups, anomaly detection) |

### Deployment Topology

```
Browser
  │
  ▼
Nginx (frontend)
  │  serves SPA static assets
  │  /api/* → backend:3000
  ▼
Express Backend (:3000)
  │
  ├─ JWT Auth / RBAC middleware
  ├─ Audit logger middleware
  ├─ Content moderation
  └─ Controllers (incidents, auth, settings, search, admin)
        │
        ▼
  MySQL 8.0 (:3306)
```

### Project Structure

```
repo/
├── backend/          # Express/TypeScript API server
│   ├── src/
│   │   ├── app.ts           # Express app instance
│   │   ├── index.ts         # Server entry point
│   │   ├── controllers/     # Route handlers
│   │   ├── middleware/      # Security + audit
│   │   ├── services/        # Upload validation
│   │   ├── utils/           # Crypto, moderator, token blocklist
│   │   ├── cron/            # Backup + anomaly detection
│   │   └── db/              # Pool + schema + seed
│   └── tests/               # Jest (unit, integration, API)
├── frontend/         # Vue 3 SPA
│   ├── src/
│   │   ├── views/           # Page components
│   │   ├── router/          # Vue Router + guards
│   │   └── utils/           # Auth, http, csv utilities
│   └── nginx.conf           # SPA routing config
├── docs/             # This directory
├── docker-compose.yml
└── run_tests.sh      # Full test suite runner
```

---

## 2. Component Diagram

### Frontend → Backend Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  Vue 3 SPA (Browser)                                             │
│                                                                  │
│  ┌──────────────┐  ┌─────────────┐  ┌──────────────────────┐  │
│  │ Vue Router   │  │ Axios HTTP  │  │ Chart.js             │  │
│  │ Role guards  │  │ Client      │  │ (Admin dashboards)    │  │
│  │ Privacy      │  │ Interceptors│  │                      │  │
│  │ consent      │  │ (auth,      │  │                      │  │
│  │ guard        │  │  security   │  │                      │  │
│  │              │  │  headers)   │  │                      │  │
│  └──────────────┘  └─────────────┘  └──────────────────────┘  │
│         │                 │                    │               │
└─────────┼─────────────────┼────────────────────┼───────────────┘
          │                 │                    │
          │ HTTP/REST       │ HTTP/REST          │
          ▼                 ▼                    ▼
┌─────────────────────────────────────────────────────────────────┐
│  Express Backend — Middleware Chain (per request)               │
│                                                                  │
│  Incoming Request                                                │
│       │                                                          │
│       ▼                                                          │
│  ┌────────────┐  ┌──────────┐  ┌────────────┐  ┌──────────┐   │
│  │ Helmet     │→ │ CORS     │→ │ JSON       │→ │ Audit    │   │
│  │ security   │  │ (origin  │  │ body       │  │ Logger   │   │
│  │ headers    │  │  check)  │  │ parser     │  │ (fires   │   │
│  │            │  │          │  │ (16KB max) │  │  async)  │   │
│  └────────────┘  └──────────┘  └────────────┘  └──────────┘   │
│       │                 │            │               │          │
│       │                 │            │               ▼          │
│       │                 │            │     ┌──────────────┐    │
│       │                 │            │     │ Token        │    │
│       │                 │            │     │ Blocklist    │    │
│       │                 │            │     │ check        │    │
│       │                 │            │     └──────────────┘    │
│       │                 │            │               │          │
│       │                 │            │               ▼          │
│       │                 │            │     ┌──────────────┐    │
│       │                 │            │     │ JWT Auth     │    │
│       │                 │            │     │ Verify +     │    │
│       │                 │            │     │ Claims       │    │
│       │                 │            │     └──────────────┘    │
│       │                 │            │               │          │
│       │                 │            │               ▼          │
│       │                 │            │     ┌──────────────┐    │
│       │                 │            │     │ CSRF         │    │
│       │                 │            │     │ Timestamp    │    │
│       │                 │            │     │ Nonce Replay │    │
│       │                 │            │     │ Guard        │    │
│       │                 │            │     └──────────────┘    │
│       │                 │            │               │          │
│       │                 │            │               ▼          │
│       │                 │            │     ┌──────────────┐    │
│       │                 │            │     │ RBAC         │    │
│       │                 │            │     │ Role Check   │    │
│       │                 │            │     └──────────────┘    │
│       │                 │            │               │          │
│       │                 │            │               ▼          │
│       │                 │            │     Controller Handler   │
│       │                 │            │               │          │
│       │                 │            │               ▼          │
│       │                 │            │     DB Pool (MySQL)      │
│       │                 │            │               │          │
│       │                 │            │               ▼          │
│       │                 │            │     Response (JSON)      │
│       │                 │            │               │          │
│       │                 │            │               ▼          │
│       │                 │            │     Audit Log INSERT     │
│       │                 │            │     (async, fires on     │
│       │                 │            │      res.finish event)   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Data Model

### 3.1 `users`

| Column | Type | Notes |
|--------|------|-------|
| `id` | BIGINT UNSIGNED PK | Auto-increment |
| `username` | VARCHAR(100) UNIQUE | Not null |
| `password_hash` | VARCHAR(255) | bcrypt |
| `role` | ENUM | Administrator, Reporter, Dispatcher, Safety Manager, Auditor |
| `login_attempts` | INT UNSIGNED | Default 0 |
| `locked_until` | DATETIME NULL | Set after repeated failures |
| `created_at` | TIMESTAMP | Default now |
| `updated_at` | TIMESTAMP | Auto-update |

**Roles:**
- **Reporter** — Can file incidents
- **Dispatcher** — Can triage and update incident status
- **Safety Manager** — Can triage, update status, manage settings
- **Auditor** — Read-only access to incidents, search, metrics
- **Administrator** — Full access including settings, metrics

### 3.2 `incidents`

| Column | Type | Notes |
|--------|------|-------|
| `id` | BIGINT UNSIGNED PK | Auto-increment |
| `reporter_id` | BIGINT UNSIGNED FK → users | Not null |
| `type` | VARCHAR(100) | e.g., Injury, Fire, Spill |
| `description` | TEXT | Incident narrative |
| `site` | VARCHAR(255) | Facility location |
| `time` | DATETIME | When the incident occurred |
| `status` | ENUM | New → Acknowledged → In Progress → Escalated → Closed |
| `rating` | TINYINT UNSIGNED NULL | Severity rating 1–5 |
| `cost` | DECIMAL(12,2) NULL | Estimated cost |
| `risk_tags` | JSON NULL | `{tags: [...], sensitive: {phone, medical_notes}}` |
| `created_at` | TIMESTAMP | Auto-set |
| `updated_at` | TIMESTAMP | Auto-update |

**Indexes:** `idx_incidents_status`, `idx_incidents_time`

### 3.3 `incident_actions`

Traceable evidence chain for every incident event.

| Column | Type | Notes |
|--------|------|-------|
| `id` | BIGINT UNSIGNED PK | |
| `incident_id` | BIGINT UNSIGNED FK → incidents | Not null |
| `user_id` | BIGINT UNSIGNED FK → users | Not null |
| `action` | VARCHAR(255) | INCIDENT_CREATED, STATUS_UPDATED, COLLABORATOR_ASSIGNED |
| `evidence_log` | TEXT NULL | JSON: `{previous_status, next_status, triage_notes, collaborators}` |
| `created_at` | TIMESTAMP | |

**Index:** `idx_actions_incident`

### 3.4 `audit_logs`

Immutable append-only log of every state-changing request.

| Column | Type | Notes |
|--------|------|-------|
| `id` | BIGINT UNSIGNED PK | |
| `route` | VARCHAR(255) | Request path |
| `user_id` | BIGINT UNSIGNED NULL FK → users | Null for unauthenticated |
| `before_val` | JSON NULL | State before the action |
| `after_val` | JSON NULL | State after the action (or request body) |
| `created_at` | TIMESTAMP | |

**Note:** No UPDATE or DELETE statements are ever issued against this table by application code. A database-level constraint (e.g., trigger or separate read-only user) is recommended for production hardening.

### 3.5 `settings`

| Column | Type | Notes |
|--------|------|-------|
| `config_key` | VARCHAR(100) PK | sla_defaults, incident_types, sla_rules |
| `config_value` | JSON | Configured value |
| `updated_at` | TIMESTAMP | Auto-update |

### 3.6 `images`

| Column | Type | Notes |
|--------|------|-------|
| `id` | BIGINT UNSIGNED PK | |
| `incident_id` | BIGINT UNSIGNED NULL FK → incidents | Nullable during partial upload |
| `file_ref` | VARCHAR(512) | Relative path: `uploads/incidents/<uuid>.ext` |
| `uploaded_by` | BIGINT UNSIGNED NULL FK → users | Nullable |
| `created_at` | TIMESTAMP | |

**Index:** `idx_images_incident`

### 3.7 `revoked_tokens`

| Column | Type | Notes |
|--------|------|-------|
| `token_id` | VARCHAR(255) PK | `jti` claim of revoked JWT |
| `expires_at` | DATETIME | Token expiry — used for cleanup |
| `created_at` | TIMESTAMP | |

**Index:** `idx_revoked_expires`

---

## 4. Security Design

### 4.1 Authentication — JWT

- **Algorithm:** HS256
- **TTL:** 15 minutes (`expiresIn: "15m"`)
- **Claims:** `sub` (user id), `username`, `role`, `csrfToken`, `jti` (unique token id), `iat`, `exp`
- **Refresh:** Tokens within 5 minutes of expiry can be refreshed via `POST /auth/refresh`
- **Logout:** `jti` is added to the in-memory `revoked_tokens` blocklist. Expired entries are purged periodically.

### 4.2 Anti-Replay Protection

| Mechanism | Detail |
|-----------|--------|
| **Request timestamp** | Header `x-request-timestamp` must be within ±5 minutes of server time |
| **Per-request nonce** | Header `x-request-nonce` must be unique per request; reused nonces return 409 Conflict |
| **JWT `jti`** | Each token has a unique ID; revoked tokens cannot be reused |

### 4.3 CSRF Protection

State-changing requests (`POST`, `PUT`, `PATCH`, `DELETE`) require:
- `Authorization: Bearer <token>`
- `x-csrf-token: <csrf_from_token>` — the `csrfToken` claim embedded in the JWT
- `x-request-timestamp: <unix_ms>`
- `x-request-nonce: <uuid>`

### 4.4 Data-at-Rest Encryption

Sensitive fields (phone numbers, medical notes) are encrypted with **AES-256-GCM** before being stored in `risk_tags` JSON. The key is read from `DATA_ENCRYPTION_KEY` environment variable.

### 4.5 PII Masking

When `GET /incidents/:id` returns a response, encrypted fields in `risk_tags.sensitive` are decrypted and then **masked** using a `maskField()` utility that shows only the last 4 characters. This prevents PII from leaking in API responses even if the DB is accessed directly.

### 4.6 Rate Limiting

| Endpoint | Limit | Window | On breach |
|----------|-------|--------|-----------|
| `POST /auth/login` | 60 requests | 1 minute | 429 Too Many Requests |
| Login failures | 10 failures | 5 minutes | Account locked for 5 minutes |

### 4.7 Content Moderation

Every text field is scanned before storage:
- **Blocked terms:** "password", "credit card", "ssn", "social security number", "api key", "secret"
- **PII patterns:** email addresses, phone numbers, SSN format (xxx-xx-xxxx), card-like numbers

Detected issues result in HTTP 422 with a list of `{field, type, detail}` objects.

### 4.8 Secure Headers (Helmet)

```
Content-Security-Policy: default-src 'self'
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
```

### 4.9 Role-Based Access Control (RBAC)

Every non-public route uses `requireRole(...)` middleware. Roles are checked against the JWT `role` claim.

| Route | Allowed Roles |
|-------|-------------|
| `POST /incidents` | Reporter |
| `PATCH /incidents/:id/status` | Dispatcher |
| `GET /incidents`, `GET /incidents/:id` | All authenticated |
| `GET /search/incidents` | All authenticated |
| `GET /settings/config` | Safety Manager, Auditor, Administrator |
| `PATCH /settings/*` | Safety Manager |
| `GET /admin/metrics` | Safety Manager, Auditor, Administrator |

---

## 5. Key Workflows

### 5.1 Incident Submission Flow

```
1. Reporter authenticates via POST /auth/login → receives JWT + CSRF token
2. Reporter loads ReportIncident.vue → GET /settings/config (incident types)
3. Reporter fills form (site, type, description, optional phone/notes/images)
4. Client submits POST /incidents with:
   - Authorization: Bearer <token>
   - x-csrf-token: <csrf>
   - x-request-timestamp: <ms>
   - x-request-nonce: <uuid>
   - Content-Type: multipart/form-data (images as "images" field)
5. Backend validates:
   a. JWT + CSRF + timestamp + nonce (middleware chain)
   b. Content moderation (blocked terms, PII patterns) → 422 if fail
   c. File validation (extension, MIME, magic bytes signature, size)
   d. AES-256-GCM encryption of phone + medical notes → stored in risk_tags
   e. INSERT into incidents (status = 'New')
   f. INSERT into incident_actions (INCIDENT_CREATED)
   g. INSERT into images (file_ref)
   h. COMMIT transaction
   i. Audit log INSERT (async, on res.finish)
6. Backend returns: {id, status: "New", uploaded_images, processing_ms, within_goal}
7. Audit log written asynchronously after response is sent
```

### 5.2 Dispatcher Triage Flow

```
1. Dispatcher authenticates → JWT with Dispatcher role
2. Triage.vue loads incidents via GET /search/incidents (sort: recent_activity)
3. Dispatcher reviews SLA timers (ack: 15min, close: 72h)
4. Dispatcher selects new status, enters triage notes + collaborator IDs
5. Client submits PATCH /incidents/:id/status with:
   - State machine validates: current status → new status is allowed?
   - INSERT into incident_actions (STATUS_UPDATED with evidence_log JSON)
   - INSERT for each collaborator (COLLABORATOR_ASSIGNED)
   - UPDATE incidents SET status
   - COMMIT transaction
6. Audit before/after states captured for audit log
```

### 5.3 Search with Synonym and Pinyin Matching

```
1. Search.vue submits GET /search/incidents?q=fire&site=Dock+A&sort=recent_activity
2. Backend builds SQL WHERE clause for filters (site, status, date range, cost, rating)
3. SQL: SELECT ... FROM incidents LEFT JOIN incident_actions GROUP BY id LIMIT/OFFSET
4. For keyword search:
   a. Expand terms using synonym map (fire → fire, blaze, flame, combustion)
   b. Convert keyword to pinyin (no tone marks) for phonetic matching
   c. Score each row: exact match (+5), pinyin match (+4), synonym (+2), synonym+pinyin (+1)
   d. Filter to rows with score > 0, sort by relevance score descending
   e. Then apply sort key (popularity, recent_activity, rating, cost)
5. Return: {count, filters, sort, results[]}
```

### 5.4 Backup and Recovery Strategy

**Nightly Encrypted Backup (retention: 30 days)**
- Runs at 02:00 daily via node-cron
- `mysqldump --single-transaction --quick` dumps the full database
- Plaintext `.sql` file is encrypted with **AES-256-GCM** using `DATA_ENCRYPTION_KEY`
- `.enc` file stored in `backups/nightly/`
- Files older than 30 days are automatically deleted

**Monthly Archive (retention: 5 years)**
- Runs at 03:00 on the 1st of each month via node-cron
- Same encryption process as nightly
- Stored in `backups/monthly/`
- Files older than 5 years are automatically deleted

**Recovery Process**
1. Decrypt `.enc` file with AES-256-GCM using `DATA_ENCRYPTION_KEY`
2. Apply `.sql` to MySQL: `mysql -u app_user -p incident_db < backup.sql`

### 5.5 Anomaly Detection

Runs every 10 minutes via node-cron. Three detectors:

**1. Mass CSV Exports**
- Query: count audit log entries with route like `%export%` or `after_val` containing "csv"
- Trigger: ≥3 exports by the same user in 15 minutes
- Action: Write to `logs/anomaly-alerts.log`, console.warn

**2. Repeated Authentication Failures**
- Query: users with `login_attempts >= 10` OR `locked_until > NOW()`
- Trigger: Any user meeting the threshold
- Action: Write alert with username, attempt count, lock status

**3. Incident Edit Spike**
- Query: count incident status updates in last 15 minutes vs 24-hour baseline
- Trigger: current edits >= max(12, baseline × 3)
- Action: Write alert with current count, baseline, and threshold

---

## 6. Environment Variables

| Variable | Description | Required |
|----------|-------------|---------|
| `JWT_SECRET` | Symmetric key for JWT signing | Yes |
| `DATA_ENCRYPTION_KEY` | Key for AES-256-GCM backup + PII encryption | Yes |
| `DB_HOST` | MySQL host | Default: 127.0.0.1 |
| `DB_PORT` | MySQL port | Default: 3306 |
| `DB_USER` | MySQL app user | Default: app_user |
| `DB_PASSWORD` | MySQL app password | Default: app_password |
| `DB_NAME` | Database name | Default: incident_db |
| `CORS_ORIGIN` | Allowed CORS origin | Default: http://localhost |
| `PORT` | Backend listen port | Default: 3000 |
| `UPLOAD_DIR` | File upload directory | Default: ./uploads |
| `REQUIRE_HTTPS` | Enforce HTTPS in production | Default: false |
| `ENABLE_CRON` | Run backup/alert cron jobs | Default: false (true in prod) |
| `NODE_ENV` | Environment | development / test / production |
