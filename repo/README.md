# SentinelSafe EHS Platform

A full-stack enterprise health and safety incident management platform with strict security controls, real-time triage dashboards, and manager/auditor analytics.

> **Project type:** full-stack | **Frontend:** Vue 3 + TypeScript | **Backend:** Express + TypeScript | **Database:** MySQL 8

## Screenshots

| Page | Role | Screenshot |
|------|------|-----------|
| Login | — | `screenshots/screenshot_login.png` |
| Report Incident | Reporter | `screenshots/screenshot_reporter_report.png` |
| Live Triage Queue | Dispatcher | `screenshots/screenshot_dispatcher_triage.png` |
| Incident Search | Administrator | `screenshots/screenshot_admin_search.png` |

## Tech Stack

- **Frontend:** Vue 3 + Vite + TypeScript + Vue Router + Chart.js
- **Backend:** Node.js + Express + TypeScript + MySQL 8 + node-cron
- **Container:** Docker + Docker Compose

## Project Structure

```
.
├── backend/
│   ├── src/
│   │   ├── controllers/    # auth, incidents, search, settings, admin
│   │   ├── cron/            # encrypted backups, anomaly detection
│   │   ├── db/              # MySQL pool, schema
│   │   ├── middleware/       # security headers, audit logging
│   │   ├── services/         # file upload validation
│   │   ├── types/           # shared TypeScript types
│   │   ├── utils/           # crypto, PII moderation
│   │   └── index.ts         # Express app entry
│   ├── .env.example
│   ├── Dockerfile
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/      # reusable UI: MetricCard, SlaPill, FilterField, InlineTriageEdit
│   │   ├── router/          # role-aware navigation guards
│   │   ├── utils/           # Axios HTTP client, auth helpers, CSV export
│   │   └── views/           # Login, PrivacyConsent, ReportIncident, Triage, Search, Admin
│   ├── Dockerfile
│   └── package.json
└── docker-compose.yml
```

## Quick Start

### 1. Configure Environment

Copy the example environment file before running:

```bash
cp backend/.env.example backend/.env
```

Edit `backend/.env` and replace the placeholder values with your own secrets:

- `JWT_SECRET` — minimum 32-character random string
- `DATA_ENCRYPTION_KEY` — 32-byte hex string (64 hex chars). Generate one with:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```

### 2. Start Services

Build and start all containers (MySQL, backend, frontend):

```bash
docker compose up --build
```

Services will be available at:
- **Frontend:** http://localhost
- **Backend:** http://localhost:3000
- **MySQL:** localhost:3306

### 3. Log In

Users are seeded automatically by `backend/src/db/seed.sql` on first start. See [Default Users](#default-users) for credentials.

### 4. Local Development

Without Docker:

```bash
# Backend
cd backend
npm install
cp .env.example .env   # edit .env
npm run dev

# Frontend
cd frontend
npm install
npm run dev
```

## Testing

### Backend (unit, integration, and API tests)

```bash
cd backend
npm install
npm test
```

Or use the root runner (runs backend unit tests + API/integration tests):

```bash
./run_tests.sh
```

### Frontend (Vitest)

```bash
cd frontend
npm install
npm test
```

## Security Model

All protected routes require:

| Header | When Required | Purpose |
|---|---|---|
| `Authorization: Bearer <token>` | All authenticated requests | Short-lived JWT (15 min) |
| `x-request-timestamp` | State-changing (POST/PUT/PATCH/DELETE) | Replay prevention (±5 min) |
| `x-request-nonce` | State-changing | Per-request unique nonce |
| `x-csrf-token` | State-changing | CSRF defense |

Role-based access:

| Route | Allowed Roles |
|---|---|
| `POST /incidents` | Reporter |
| `PATCH /incidents/:id/status` | Dispatcher |
| `GET /search/incidents` | All authenticated roles |
| `GET /admin/metrics` | Safety Manager, Auditor, Administrator |
| `PATCH /settings/*` | Safety Manager |

## Feature Summary

- **Incident Reporting** — Form with site/type/description, auto-timestamp, up to 5 images (10MB each), PII masked in UI
- **Dispatcher Triage** — Real-time queue with color-coded SLA alerts for acknowledgement (15 min) and closure (72 hr) targets
- **Search** — Keyword with synonym/pinyin matching, multi-filter search, sortable results
- **Admin Dashboard** — Chart.js visualizations for incidents, moderation actions, and user activity
- **CSV Export** — Filtered metrics and search results exportable as UTF-8 CSV
- **Settings Management** — Configurable incident types and custom SLA rules (Safety Manager)
- **Audit Logging** — Immutable who/what/when logs for all state-changing requests
- **Encrypted Backups** — Nightly (30-day retention) and monthly archives (5-year), AES-256-GCM encrypted
- **Anomaly Alerts** — Detects mass CSV exports, repeated auth failures, and incident edit spikes

## Known Deployment Constraints

### Single-Instance Architecture

The following security mechanisms use in-memory stores and are designed for a single-server deployment (as specified by the "disconnected corporate network" requirement):

- **Anti-replay nonce store** (`middleware/security.ts`) — Uses an in-memory `Map` with 10-minute TTL-based purging. Nonces are not shared across instances and are lost on restart. The short TTL (10 minutes) limits exposure from restarts.
- **Login rate limiter** (`controllers/auth.ts`) — In-memory tracking of login attempts per username. The database-backed `locked_until` column on the `users` table provides persistence across restarts for account lockout.
- **General rate limiter** (`middleware/rateLimit.ts`) — In-memory request counters per user/IP with sliding window.

For multi-instance deployments behind a load balancer, these stores should be migrated to a shared backing store (Redis or MySQL) to ensure consistent enforcement across all instances.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Backend server port |
| `DB_HOST` | `mysql` | MySQL hostname |
| `DB_PORT` | `3306` | MySQL port |
| `DB_USER` | `app_user` | Database user |
| `DB_PASSWORD` | — | Database password |
| `DB_NAME` | `incident_db` | Database name |
| `JWT_SECRET` | — | JWT signing secret (change in production) |
| `DATA_ENCRYPTION_KEY` | — | AES-256 key (32-byte hex) |
| `ENABLE_CRON` | `true` | Start backup/alert cron jobs |
| `NODE_ENV` | `development` | Runtime environment |

## Default Users

The following users are created automatically by `backend/src/db/seed.sql` when the container first starts.

| Username | Password | Role | Typical Use |
|---|---|---|---|
| `admin` | `admin123` | Administrator | Full access including settings, all reports, search |
| `reporter1` | `reporter123` | Reporter | File incidents via the Report view |
| `dispatcher1` | `dispatcher123` | Dispatcher | Triage queue, update incident status |
| `safety_mgr` | `manager123` | Safety Manager | Configure SLA rules, incident types, dashboards |
| `auditor1` | `auditor123` | Auditor | Read-only access to search and metrics |

> **Important:** Change all default passwords before deploying to production.

## Known Deployment Constraints

### Single-Instance In-Memory Stores

The following security mechanisms use in-memory `Map` objects that do **not** persist across process restarts or replicate across multiple backend instances:

| Store | Location | Purpose | TTL |
|---|---|---|---|
| Nonce replay guard | `middleware/security.ts` | Prevents reuse of `x-request-nonce` values on state-changing requests | 10 minutes |
| Login rate limiter | `controllers/auth.ts` | Tracks per-username request counts and failure counts for lockout | 5 minutes |
| General rate limiter | `middleware/rateLimit.ts` | Per-user/IP request throttling (60 req/min) | 1 minute |
| Token blocklist | `utils/tokenBlocklist.ts` | Revoked JWT cache (backed by DB `revoked_tokens` table) | 15 minutes |

**Impact:** In a multi-instance (horizontally scaled) deployment behind a load balancer, a nonce accepted by instance A would not be rejected by instance B, and rate-limit counters would be split across instances. The token blocklist is partially mitigated by its DB backing — on cache miss the DB is checked.

**For the target deployment** (single-server disconnected corporate network), these in-memory stores are fully adequate. The short TTLs (5–15 minutes) limit exposure on process restart.

**For multi-instance production deployments**, replace the in-memory maps with a shared store such as Redis or MySQL-backed counters.

### JWT Storage in localStorage

JWT access tokens are stored in the browser's `localStorage`. This is a standard SPA tradeoff that makes tokens accessible to any JavaScript on the page. The following mitigations are in place:

- **Short TTL (15 minutes):** Limits the window of exposure if a token is extracted.
- **CSRF double-submit tokens:** Embedded in the JWT and validated on all state-changing requests.
- **Helmet CSP:** `script-src 'self'` blocks inline scripts and third-party script injection.
- **Anti-replay nonces and timestamps:** Prevent stolen tokens from being replayed.

For production deployments with stricter XSS threat models, consider migrating to `httpOnly` cookie-based session management.
