# Business Logic Questions Log

Incident Status Transitions — Which Transitions Are Valid?

Question: The platform enforces a strict state machine on incident statuses. Which transitions are valid, and what happens if an invalid transition is attempted?

My Understanding: The `validTransitions` map in `repo/backend/src/controllers/incidents.ts` defines the allowed transitions. Every `PATCH /incidents/:id/status` call queries the current status first, then validates the proposed transition before executing the update.

Solution: The valid state machine for **`PATCH /incidents/:id/status`** (Dispatcher) is:

```
New ──► Acknowledged ──► In Progress ──► Escalated ──► Closed
  │            │              │             ▲
  └────────────┴──────────────┴─────────────┘
        (each of New / Acknowledged / In Progress may go directly to Escalated)
```

Separately, the **severity auto-escalation cron** (`repo/backend/src/cron/escalation.ts`) can move `New` / `Acknowledged` / `In Progress` incidents to **`Escalated`** when `severity_rules` match — that is not a dispatcher transition.

**Valid transitions:**
| From | Allowed to |
|------|-----------|
| `New` | `Acknowledged`, `Escalated` |
| `Acknowledged` | `In Progress`, `Escalated`, `Closed` |
| `In Progress` | `Escalated`, `Closed` |
| `Escalated` | `In Progress`, `Closed` |
| `Closed` | *(none — terminal state)* |

**Invalid transition behavior:**
1. The handler queries `SELECT id, status FROM incidents WHERE id = ?`
2. Looks up `validTransitions[current.status]` — if the array does not contain the requested status, the transaction is rolled back
3. Returns HTTP `400` with: `"Cannot transition from ${current.status} to ${nextStatus}"`
4. No database row is modified; no action log entry is created

**Why this design:**
- Prevents dispatchers from accidentally closing incidents still under investigation
- `Escalated` is reachable from **`New`**, **`Acknowledged`**, or **`In Progress`** via the dispatcher API (not from **`Closed`**). The escalation cron can also set **`Escalated`** for eligible open rows per `severity_rules`.
- `Closed` is irreversible — no outgoing transitions in `validTransitions`, and no role is granted a separate bypass in code reviewed here

---

What Happens When SLA Targets Are Breached?

Question: The system tracks acknowledgement SLA (15 minutes by default) and closure SLA (72 hours). What happens when these targets are exceeded?

My Understanding: **Acknowledgement / closure SLAs** are not enforced as hard database constraints. Dispatchers see SLA risk in the UI. Separately, **severity rules** can drive **automatic status escalation** to `Escalated` on a time basis.

Solution: **Frontend SLA display (`repo/frontend/src/views/Triage.vue`):**

The triage view uses **business-day/time helpers** (`elapsedMinutes` / `elapsedHours` against configured targets) to color SLA pills for acknowledgement and closure risk.

| Condition (simplified) | Typical meaning |
|------------------------|-----------------|
| Approaching breach window | Warning styling |
| At or past SLA target | Danger styling |
| `Closed` | No active SLA styling |

**Admin dashboard SLA summary (`GET /admin/metrics` → `sla_at_risk`):**  
`repo/backend/src/controllers/admin.ts` recomputes open-incident counts at risk using the same **business-time** utilities (`repo/backend/src/utils/businessHours.ts`) and current `sla_defaults` from `settings`.

**Severity auto-escalation (backend cron):**  
`repo/backend/src/cron/escalation.ts` runs on a schedule (every **5 minutes** when cron is enabled). It reads `severity_rules` from `settings`; for each rule with `auto_escalate: true` and `escalate_after_hours`, incidents in `New` / `Acknowledged` / `In Progress` whose **calendar** age from `created_at` exceeds the threshold are moved to **`Escalated`**, with `incident_actions` attributed to `ESCALATION_SYSTEM_USER_ID` (env, default `1`). This is **not** the same clock as the triage pills unless product explicitly aligns them.

**Anomaly detection (backend cron, every 10 minutes):**  
`detectIncidentEditSpike()` in `repo/backend/src/cron/alerts.ts` still flags unusual volumes of `PATCH …/status` traffic (`max(12, baseline × 3)` in a 15-minute window).

**Settings:** `PATCH /settings/sla` updates acknowledgement/closure targets. `PATCH /settings/severity-rules` updates auto-escalation behaviour.

---

How Are File Uploads Validated — Extension vs. Content Signature?

Question: A malicious user might try to bypass file type restrictions by renaming a malicious executable (e.g., `malware.exe` → `malware.jpg`) or by setting a fake MIME type. How does the platform prevent this?

My Understanding: The upload validation in `repo/backend/src/services/upload.ts` applies **three independent checks** that must all pass:

Solution: **Layer 1: Extension check**
```typescript
const extension = path.extname(file.originalname).toLowerCase();
if (restrictedExtensions.has(extension)) throw ...  // .exe, .bat, .sh, .php, .js, .jar, .msi
if (!allowedExtensions.has(extension)) throw ...   // .jpg, .jpeg, .png, .webp, .gif
```
An extension blocklist stops known dangerous extensions. An allowlist stops all others.

**Layer 2: MIME type consistency**
```typescript
const acceptedMimes = extensionMimeMap[extension]; // e.g., {".jpg": ["image/jpeg"]}
if (!acceptedMimes.includes(file.mimetype)) throw ... // MIME must match extension
```
The server checks that the browser-declared MIME type matches the extension. Simply renaming a file doesn't change the MIME type a browser would declare, but this alone is not sufficient — a server cannot trust the client-declared MIME type.

**Layer 3: Magic bytes (file signature) — the critical layer**
```typescript
const signatureByMime: Record<string, (buffer: Buffer) => boolean> = {
  "image/jpeg": (buffer) => buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF,
  "image/png":  (buffer) => buffer[0] === 0x89 && buffer[1] === 0x50 && ...
  "image/gif":  (buffer) => buffer[0] === 0x47 && buffer[1] === 0x49 && ...
  "image/webp": (buffer) => buffer[0] === 0x52 && buffer[8] === 0x57 && ...
};
```
The **first bytes of the file** (in memory, before writing to disk) are inspected against known binary signatures. Renaming `.exe` to `.jpg` fails here because the JPEG magic bytes (`FF D8 FF`) will not be present in a Windows executable.

**Layer 4: Filename moderation**
```typescript
const filenameIssues = moderateTextInputs({ filename: path.parse(file.originalname).name });
if (filenameIssues.length > 0) throw ... // blocked terms and PII patterns in filename
```
Even if a file passes the binary check, its filename is scanned for blocked terms (password, api key, etc.) and PII patterns. This prevents exfiltration or social-engineering attacks via filenames.

**Storage:**
Approved files are written to `uploads/incidents/<uuid>.<ext>` — a randomly generated UUID replaces the original filename entirely, breaking any path traversal attempts and removing the original name from the filesystem.

---

How Is PII Handled — Encryption at Rest and Masking in API Responses?

Question: Sensitive data like phone numbers and medical notes must be protected. How does the platform ensure this data is never exposed in plaintext either in the database or in API responses?

My Understanding: The platform uses a two-layer PII protection strategy: **encryption at rest** and **masking in responses**. These are independent — data is encrypted when stored, and even if that encryption is bypassed, the response still masks the field.

Solution: **Encryption at rest (POST /incidents):**
```typescript
const encryptedSensitive: Record<string, string> = {};
if (req.body?.phone) {
  encryptedSensitive.phone = encryptAtRest(String(req.body.phone));
}
if (req.body?.medical_notes) {
  encryptedSensitive.medical_notes = encryptAtRest(String(req.body.medical_notes));
}
const riskPayload = {
  tags: riskTags,
  sensitive: encryptedSensitive,  // stored as JSON in risk_tags column
};
```
The `encryptAtRest()` function in `src/utils/crypto.ts` uses **AES-256-GCM** with a key derived from `DATA_ENCRYPTION_KEY`. The encrypted ciphertext (including IV and auth tag) is stored as a base64-like hex string in the `risk_tags` JSON column.

**Masking in API responses (GET /incidents/:id):**
```typescript
function maskSensitiveFields(riskTags) {
  const sensitive = riskTags["sensitive"]; // contains the encrypted strings
  const maskedSensitive: Record<string, string> = {};
  for (const [key, value] of Object.entries(sensitive)) {
    if (typeof value === "string" && value.length > 0) {
      maskedSensitive[key] = maskField(value); // e.g., "****1234"
    }
  }
  return { ...riskTags, sensitive: maskedSensitive };
}
```
`maskField()` shows only the last 4 characters of the decrypted value:
```typescript
export function maskField(value: string, visibleLast = 4): string {
  if (!value) return "";
  const tail = value.slice(-visibleLast);  // last 4 chars
  const head = "*".repeat(Math.max(0, value.length - visibleLast));
  return `${head}${tail}`;  // e.g., "****ABCD"
}
```

**The mask is applied to the already-decrypted value.** This means:
- An admin who has access to the database directly would see encrypted ciphertext
- An API consumer (even with admin role) sees masked values like `"****1234"`
- The masking key is the `maskField` function — not a secret key — so it cannot be reversed from the masked output alone

**Defense in depth:**
| Layer | Protects against |
|-------|----------------|
| AES-256-GCM encryption | DB read by unauthorized users, backup file analysis |
| Masking in response | API response interception, log exposure, frontend rendering |
| Content moderation | PII detection before storage — patterns like emails, phone numbers are rejected at 422 |

---

What Constitutes an "Anomaly" for Alerting?

Question: The anomaly detection system watches for unusual patterns. What exactly triggers each type of alert, and what is the rationale?

My Understanding: Three separate detectors run every 10 minutes via `node-cron` in `src/cron/alerts.ts`. Each targets a specific threat model.

Solution: **1. Mass CSV Exports — `detectMassCsvExports()`**

```sql
SELECT user_id, COUNT(*) AS export_count FROM audit_logs
WHERE created_at >= DATE_SUB(NOW(), INTERVAL 15 MINUTE)
  AND (route LIKE '%export%' OR JSON_UNQUOTE(...) = 'csv')
GROUP BY user_id HAVING COUNT(*) >= 3
```

**Trigger:** ≥3 CSV export actions by the same user within 15 minutes.

**Rationale:** A legitimate user might export a few reports, but mass exports in a short window is a common indicator of data exfiltration — either a compromised account or an insider threat. The audit log captures every export because `auditLogger` fires on all state-changing routes including the CSV download endpoint.

**Alert payload:** `{user_id, export_count: N, window_minutes: 15}`

---

**2. Repeated Authentication Failures — `detectRepeatedAuthFailures()`**

```sql
SELECT id, username, login_attempts, locked_until FROM users
WHERE login_attempts >= 10 OR (locked_until IS NOT NULL AND locked_until > NOW())
```

**Trigger:** Any user row with `login_attempts >= 10` **or** `locked_until` in the future (see `repo/backend/src/cron/alerts.ts`).

**Rationale:** While the login endpoint rate-limits and locks accounts, the cron detector surfaces accounts in a bad state for operators and log aggregation.

**Note:** Login throttling also uses in-memory structures in `repo/backend/src/controllers/auth.ts`; the SQL-based alert is a coarse dashboard signal, not a precise “last 5 minutes” window.

**Alert payload:** `{user_id, username, login_attempts: N, locked_until: timestamp|null}`

---

**3. Incident Edit Spike — `detectIncidentEditSpike()`**

```sql
SELECT
  SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 15 MINUTE) THEN 1 ELSE 0 END) AS edits_last_15m,
  (SUM(...) / 96) AS baseline_15m  -- 24h / 15min = 96 buckets
FROM audit_logs
WHERE route LIKE '/incidents/%' AND route LIKE '%/status%'
```

**Trigger:** `current_edits >= max(12, baseline × 3)`

**Rationale:** The baseline is computed as the average 15-minute edit rate over the last 24 hours (24h ÷ 15min = 96 data points). An edit spike ≥3× the baseline indicates either:
- An emergency situation being rapidly triaged (legitimate but worth tracking)
- Automated or script-driven manipulation of incidents
- A compromised dispatcher account being used at unusual volume

The floor of 12 edits ensures small baseline systems don't get noisy alerts on modest increases.

**Alert payload:** `{edits_last_15m: N, baseline_15m: X.XX, threshold: Y.YY}`

---

**Alert output:** All alerts are written as JSON Lines to `logs/anomaly-alerts.log` and also emitted via `console.warn`, making them visible in Docker logs and compatible with log aggregation pipelines (ELK, Datadog, etc.).

---

How Does Rate Limiting Work for Login vs. General API?

Question: The platform needs to protect against brute-force login attacks while not throttling normal API usage. How are these concerns separated?

My Understanding: The system implements two independent rate-limiting mechanisms targeting different threat models:

Solution: **Login rate limiter (application-level, in-memory)**

Location: `repo/backend/src/controllers/auth.ts`

```typescript
const LOGIN_WINDOW_MS = 60 * 1000;   // 1 minute
const MAX_LOGIN_REQUESTS = 60;        // 60 per minute

const loginRateStore = new Map<string, number[]>();  // keyed by username

function trackRateLimit(key: string): boolean {
  const now = Date.now();
  const recent = existing.filter(ts => now - ts < LOGIN_WINDOW_MS);
  recent.push(now);
  loginRateStore.set(key, recent);
  return recent.length <= MAX_LOGIN_REQUESTS;
}
```

- **Scope:** Per-username (not per IP). This is intentional — it allows multiple users to share an IP without punishing legitimate users behind the same NAT gateway.
- **Granularity:** 1-minute sliding window. Each login attempt is timestamped; old entries are evicted on each check.
- **Breach behavior:** Returns HTTP `429` with `"Too many login attempts. Try again in a minute."`
- **Storage:** In-memory `Map`. This is ephemeral — if the server restarts, the rate store clears. This is acceptable because the window is short (1 minute) and the security goal is real-time throttling, not persistent punishment.

**Account lockout (database-level)**

```typescript
const FAIL_WINDOW_MS = 5 * 60 * 1000;  // 5 minutes
const MAX_FAILURES = 10;
const LOCKOUT_MS = 5 * 60 * 1000;        // 5-minute lockout

// After 10 failed attempts in 5 minutes:
await dbPool.execute(
  "UPDATE users SET login_attempts = login_attempts + 1, locked_until = ? WHERE id = ?",
  [new Date(Date.now() + LOCKOUT_MS), userId]
);
```

- **Scope:** Per-account, persisted in `users.locked_until` column
- **Breach behavior:** `POST /auth/login` returns HTTP `423` with `"Account locked due to repeated failures"` — even if the correct password is supplied
- **Recovery:** `locked_until` is checked on each login; once the timestamp passes, the user can log in again
- **Difference from rate limiter:** The lockout survives server restarts because it is stored in MySQL, not in-memory

**Authenticated API traffic (`express-rate-limit`)**

`repo/backend/src/app.ts` mounts `preAuthRateLimiter` before `/auth` and `postAuthRateLimiter` on protected routers (`/incidents`, `/settings`, `/search`, `/export`, `/reports`, `/admin`). In production, post-auth limits default to **60 requests / minute / JWT user id**; pre-auth allows a higher burst for anonymous health checks and login. Both are **no-ops when `NODE_ENV=test`** so automated tests are not throttled.

---

How Does Offline/Disconnected Network Support Work?

Question: A reporter in a remote area with no network connectivity needs to file an incident. Does the platform support offline mode?

My Understanding: The current implementation does **not** include offline/disconnected operation support. The frontend is a SPA that requires a persistent HTTP connection to the backend API. All incident creation, status updates, and searches require round-trips to the server.

Solution: **Current limitations:**
- No service worker registration in `main.ts` or `vite.config.ts`
- No IndexedDB or localStorage buffering of incident drafts
- No offline queue in the Axios HTTP client
- `GET /incidents`, `POST /incidents`, and all other endpoints return errors when the backend is unreachable
- The `vue-tsc` build produces a static SPA that can be served by Nginx but does not function without the API

**What would be needed to add offline support:**

1. **Service Worker (Workbox):**
   - Register a service worker in `main.ts` that caches static assets (JS, CSS, fonts)
   - Cache-first strategy for static assets; network-first for API calls
   - Display a cached "offline" fallback page when API is unreachable

2. **Incident Draft Buffering (IndexedDB):**
   - In `ReportIncident.vue`, if the `POST /incidents` request fails due to network error (not an HTTP error), save the form data to IndexedDB
   - Store: `{id: uuid(), formData: {...}, timestamp: Date.now(), status: 'draft'}`
   - On `onMounted` or connectivity change, attempt to submit buffered drafts

3. **Axios Retry Logic:**
   - Add a request interceptor that retries failed requests (timeout, ECONNREFUSED) up to 3 times with exponential backoff
   - Mark requests as "pending sync" in IndexedDB if all retries fail

4. **Conflict Resolution:**
   - When syncing buffered incidents, the server should deduplicate by a client-generated `client_id` UUID
   - If the same incident was already submitted (e.g., the network was slow but the request succeeded), return the existing `id` rather than creating a duplicate

5. **Connectivity Indicator:**
   - Add a `navigator.onLine` listener in `App.vue` to show a persistent banner when offline
   - Disable form submission buttons and show "Queued for submission" state

**Priority recommendation:** Implement IndexedDB buffering first — it provides the most user-visible improvement at the lowest complexity. Service worker caching of assets can be added incrementally.

---

How Are Audit Logs Made Immutable?

Question: Audit logs are critical for compliance and forensics. How does the platform ensure they cannot be altered or deleted after the fact?

My Understanding: Immutability is enforced at the application layer only. A database administrator with write access could still modify audit records unless additional database-level controls are in place.

Solution: **Application-level immutability:**

1. **No UPDATE or DELETE routes exist for audit logs.** The `audit_logs` table has no corresponding controller in `src/controllers/`. There is no `PATCH /audit-logs/:id` or `DELETE /audit-logs/:id` endpoint.

2. **Insert-only pattern in the audit middleware (`repo/backend/src/middleware/audit.ts`):**
   ```typescript
   res.on("finish", () => {
     const afterVal =
       res.statusCode >= 500
         ? {
             action: res.locals.auditAction ?? req.method,
             status_code: res.statusCode,
             outcome: "server_error",
             request_body: sanitizeBody(req.body, route),
           }
         : (res.locals.auditAfter ?? {
             action: res.locals.auditAction ?? req.method,
             request_body: sanitizeBody(req.body, route),
             status_code: res.statusCode,
           });
     void dbPool.execute(
       "INSERT INTO audit_logs (route, user_id, before_val, after_val, created_at) VALUES (?, ?, ?, ?, ?)",
       [route, userId, JSON.stringify(beforeVal), JSON.stringify(afterVal), startedAt],
     );
   });
   ```
   Only `INSERT` is used. **HTTP ≥ 500** responses still produce a row: `after_val` records `outcome: "server_error"` plus a **sanitized** snapshot of the request body so operators can correlate failures without skipping the audit trail entirely.

3. **Audit data captured per request:**
   | Field | Source |
   |-------|--------|
   | `route` | `req.originalUrl` |
   | `user_id` | `req.auth?.sub` (null for unauthenticated) |
   | `before_val` | `res.locals.auditBefore` (set by controller before response) |
   | `after_val` | `res.locals.auditAfter` (set by controller) or request body |
   | `created_at` | Server timestamp at request start |

4. **Audit happens after the response is sent.** Using `res.on("finish", ...)`, the audit INSERT is fired asynchronously after the HTTP response has already been returned to the client. This means:
   - Audit failures do not affect the client's response (non-blocking)
   - The audit record captures the completed state of the transaction

**Gaps and production hardening recommendations:**

| Gap | Risk | Mitigation |
|-----|------|-----------|
| No DB-level constraint | DBA could UPDATE or DELETE records | Create a MySQL user `audit_reader` with `SELECT` only; application uses separate `audit_writer` with `INSERT, SELECT` only |
| No cryptographic chaining | Records could be deleted and re-inserted | Add a `prev_hash` column; each record stores SHA-256 of previous record's hash |
| No TTL deletion prevention | Old audit records could be bulk-deleted | Partition `audit_logs` by date; revoke DELETE permissions on partitions |
| In-memory `jti` blocklist | Revocation list lost on restart | Persist `revoked_tokens` to MySQL (already done) and consider write-ahead log |

**Current production readiness:** Adequate for single-server deployments with trusted DBAs. For multi-region or high-security environments, the database-level access controls and cryptographic chaining should be implemented before go-live.
