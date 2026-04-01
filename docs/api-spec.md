# SentinelSafe EHS Platform — API Specification

Base URL: `http://localhost:3000` (development)  
Content-Type: `application/json` unless noted  
All state-changing endpoints require additional security headers (see §Security Headers).

---

## Authentication Headers

### JWT (all authenticated endpoints)

```
Authorization: Bearer <access_token>
```

The access token is obtained from `POST /auth/login`. Tokens expire after **15 minutes**.

### CSRF (state-changing requests only)

State-changing requests (`POST`, `PATCH`, `PUT`, `DELETE`) require four headers:

```
Authorization: Bearer <access_token>
x-csrf-token: <csrf_token>          # From the JWT claims (csrfToken field)
x-request-timestamp: <unix_ms>       # Milliseconds since epoch; must be within ±5 minutes of server time
x-request-nonce: <uuid>             # Must be unique per request; reuse returns 409
```

---

## Security Headers Summary

| Endpoint | Auth | RBAC | Security Headers |
|---------|------|------|-----------------|
| `POST /auth/login` | — | — | Rate limited (60/min) |
| `POST /auth/refresh` | JWT | All roles | CSRF + timestamp + nonce |
| `POST /auth/logout` | JWT | All roles | CSRF + timestamp + nonce |
| `GET /incidents` | JWT | All roles | — |
| `GET /incidents/:id` | JWT | All roles | — |
| `POST /incidents` | JWT | Reporter | CSRF + timestamp + nonce |
| `PATCH /incidents/:id/status` | JWT | Dispatcher | CSRF + timestamp + nonce |
| `GET /search/incidents` | JWT | All roles | — |
| `GET /settings/config` | JWT | SM / Auditor / Admin | — |
| `PATCH /settings/sla` | JWT | Safety Manager | CSRF + timestamp + nonce |
| `PATCH /settings/incident-types` | JWT | Safety Manager | CSRF + timestamp + nonce |
| `PATCH /settings/sla-rules` | JWT | Safety Manager | CSRF + timestamp + nonce |
| `GET /admin/metrics` | JWT | SM / Auditor / Admin | — |
| `GET /health` | — | — | — |

---

## Error Response Format

All errors follow this structure:

```json
{
  "error": "Human-readable error message"
}
```

Validation and moderation errors may include additional details:

```json
{
  "error": "Moderation check failed",
  "issues": [
    { "field": "description", "type": "pii", "detail": "Detected possible PII (email)" },
    { "field": "phone", "type": "blocked_term", "detail": "Contains blocked term: password" }
  ]
}
```

---

## HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200 | OK — request succeeded |
| 201 | Created — resource created |
| 400 | Bad Request — missing/invalid parameters |
| 401 | Unauthorized — missing or invalid token |
| 403 | Forbidden — insufficient role privileges |
| 404 | Not Found — resource does not exist |
| 409 | Conflict — nonce replay detected |
| 413 | Payload Too Large — file exceeds 10MB |
| 415 | Unsupported Media Type — invalid file type |
| 422 | Unprocessable Entity — moderation/policy failure |
| 423 | Locked — account locked due to failed login attempts |
| 429 | Too Many Requests — rate limit exceeded |
| 500 | Internal Server Error |

---

## Endpoints

### `POST /auth/login`

Authenticate and receive an access token.

**Auth:** None  
**Rate limit:** 60 requests per minute per username

**Request body:**
```json
{
  "username": "string (required)",
  "password": "string (required)"
}
```

**Success response (200):**
```json
{
  "token_type": "Bearer",
  "expires_in": 900,
  "access_token": "<jwt_string>",
  "csrf_token": "<csrf_string>",
  "user": {
    "id": 1,
    "username": "admin",
    "role": "Administrator"
  }
}
```

**Error responses:**
- `400` — Missing username or password
- `401` — Invalid credentials
- `423` — Account locked due to repeated failures
- `429` — Rate limit exceeded

---

### `POST /auth/refresh`

Exchange an expiring token for a new one. Token must be within **5 minutes** of expiry.

**Auth:** JWT required  
**Security headers:** CSRF + timestamp + nonce

**Request body:** Empty

**Success response (200):**
```json
{
  "token_type": "Bearer",
  "expires_in": 900,
  "access_token": "<new_jwt>",
  "csrf_token": "<new_csrf>",
  "user": {
    "id": 1,
    "username": "admin",
    "role": "Administrator"
  }
}
```

**Error responses:**
- `401` — Missing auth or token revoked
- `423` — Account is locked
- `429` — Token not yet within 5-minute refresh window (includes `seconds_remaining`)

---

### `POST /auth/logout`

Revoke the current token, preventing its further use.

**Auth:** JWT required  
**Security headers:** CSRF + timestamp + nonce

**Request body:** Empty

**Success response (200):**
```json
{
  "message": "Token revoked successfully"
}
```

---

### `GET /incidents`

List incidents with optional status filter and pagination.

**Auth:** JWT required (any role)

**Query parameters:**
| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `status` | string | — | Filter by: New, Acknowledged, In Progress, Escalated, Closed |
| `page` | integer | 1 | Page number (1-indexed) |
| `limit` | integer | 20 | Items per page (max: 100) |

**Success response (200):**
```json
{
  "incidents": [
    {
      "id": 1,
      "reporter_id": 2,
      "type": "Injury",
      "site": "Dock A",
      "status": "New",
      "rating": 3,
      "cost": 150.00,
      "created_at": "2024-03-15T10:30:00.000Z",
      "updated_at": "2024-03-15T10:30:00.000Z"
    }
  ],
  "total": 42,
  "page": 1,
  "limit": 20
}
```

---

### `GET /incidents/:id`

Get a single incident with its full action history, images, and PII fields masked.

**Auth:** JWT required (any role)

**Path parameters:**
| Param | Type | Notes |
|-------|------|-------|
| `id` | integer | Incident ID |

**Success response (200):**
```json
{
  "id": 1,
  "reporter_id": 2,
  "type": "Injury",
  "description": "Worker slipped near dock entrance",
  "site": "Dock A",
  "time": "2024-03-15T09:45:00.000Z",
  "status": "Acknowledged",
  "rating": 3,
  "cost": 150.00,
  "risk_tags": {
    "tags": ["chemical"],
    "sensitive": {
      "phone": "****1234",
      "medical_notes": "****5678"
    }
  },
  "created_at": "2024-03-15T10:30:00.000Z",
  "updated_at": "2024-03-15T11:00:00.000Z",
  "actions": [
    {
      "id": 1,
      "user_id": 5,
      "action": "STATUS_UPDATED",
      "evidence_log": {
        "previous_status": "New",
        "next_status": "Acknowledged",
        "triage_notes": "Acknowledged for review",
        "collaborators": []
      },
      "created_at": "2024-03-15T11:00:00.000Z"
    },
    {
      "id": 0,
      "user_id": 2,
      "action": "INCIDENT_CREATED",
      "evidence_log": { "uploaded_images": 2 },
      "created_at": "2024-03-15T10:30:00.000Z"
    }
  ],
  "images": [
    {
      "id": 1,
      "file_ref": "uploads/incidents/abc123.jpg",
      "uploaded_by": 2,
      "created_at": "2024-03-15T10:30:00.000Z"
    }
  ]
}
```

**Notes:**
- `risk_tags.sensitive.*` fields are masked (AES-256-GCM decrypted, then last 4 chars shown)
- `actions` are returned in ascending chronological order
- `evidence_log` is parsed JSON stored as TEXT in the database

**Error responses:**
- `400` — Invalid incident ID
- `404` — Incident not found

---

### `POST /incidents`

Create a new incident report. Reporter role required.

**Auth:** JWT required + Reporter role  
**Security headers:** CSRF + timestamp + nonce  
**Content-Type:** `multipart/form-data`

**Form fields:**
| Field | Type | Required | Notes |
|-------|------|---------|-------|
| `type` | string | Yes | Incident type (e.g., Injury, Fire) |
| `description` | string | Yes | Narrative description |
| `site` | string | Yes | Facility location |
| `time` | string | Yes | ISO 8601 datetime |
| `phone` | string | No | Encrypted at rest + masked in responses |
| `medical_notes` | string | No | Encrypted at rest + masked in responses |
| `images` | File[] | No | Up to 5 images, 10MB each |
| `rating` | number | No | 1–5 severity rating |
| `cost` | number | No | Estimated cost |
| `risk_tags` | string[] | No | Array of tag strings |
| `collaborators` | number[] | No | User IDs to assign |

**File validation (images):**
- Extensions allowed: `.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`
- Extensions blocked: `.exe`, `.bat`, `.cmd`, `.sh`, `.php`, `.js`, `.jar`, `.msi`
- MIME type must match extension
- Magic bytes (file signature) must match declared MIME type
- Max size: 10MB per file
- Max files: 5
- Filenames scanned for blocked terms and PII patterns

**Success response (201):**
```json
{
  "id": 42,
  "status": "New",
  "uploaded_images": ["uploads/incidents/abc123.jpg"],
  "processing_ms": 234,
  "submission_goal_ms": 120000,
  "within_goal": true
}
```

**Error responses:**
- `400` — Missing required fields or upload error
- `413` — File exceeds 10MB
- `415` — Unsupported or mismatched file type
- `422` — Content moderation failed (PII or blocked term detected)
- `423` — Account locked

---

### `PATCH /incidents/:id/status`

Update the status of an incident. Dispatcher role required.

**Auth:** JWT required + Dispatcher role  
**Security headers:** CSRF + timestamp + nonce

**Path parameters:**
| Param | Type | Notes |
|-------|------|-------|
| `id` | integer | Incident ID |

**Request body:**
```json
{
  "status": "Acknowledged",
  "triage_notes": "Escalating to safety team",
  "collaborators": [12, 41]
}
```

| Field | Type | Required | Notes |
|-------|------|---------|-------|
| `status` | string | Yes | Must be a valid transition from current status |
| `triage_notes` | string | No | Text scanned for PII/blocked terms |
| `collaborators` | number[] | No | User IDs to assign; one `COLLABORATOR_ASSIGNED` action per ID |

**Valid status transitions:**
```
New            → Acknowledged, Escalated
Acknowledged   → In Progress, Escalated, Closed
In Progress    → Escalated, Closed
Escalated      → In Progress, Closed
Closed         → (terminal — no transitions allowed)
```

**Success response (200):**
```json
{
  "id": 42,
  "status": "Acknowledged",
  "collaborators": [12, 41]
}
```

**Error responses:**
- `400` — Invalid incident ID, invalid status value, or invalid transition
- `404` — Incident not found
- `422` — Moderation check failed on triage_notes

---

### `GET /search/incidents`

Search incidents with keyword, filters, and multi-field sorting.

**Auth:** JWT required (any role)

**Query parameters:**
| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `q` | string | — | Keyword; matched against type, description, site, risk_tags fields with synonym expansion and pinyin normalization |
| `site` | string | — | Exact match on `site` field |
| `status` | string | — | Exact match on `status` |
| `date_from` | string | — | ISO date; incidents with `time >= date_from` |
| `date_to` | string | — | ISO date; incidents with `time <= date_to` |
| `risk_tags` | string | — | Comma-separated tag names (all must match) |
| `theme` | string | — | Matches `risk_tags.theme` field |
| `origin` | string | — | Substring match on `risk_tags.origin` |
| `destination` | string | — | Substring match on `risk_tags.destination` |
| `cost_min` | number | — | Minimum cost (inclusive) |
| `cost_max` | number | — | Maximum cost (inclusive) |
| `rating_min` | number | — | Minimum rating (inclusive) |
| `rating_max` | number | — | Maximum rating (inclusive) |
| `sort` | string | `popularity` | Sort key: `popularity`, `recent_activity`, `rating`, `cost` |
| `limit` | integer | 50 | Results to return (max: 100) |
| `offset` | integer | 0 | Pagination offset |

**Synonym expansion (q parameter):**
| Term | Expanded to |
|------|------------|
| fire | fire, blaze, flame, combustion |
| injury | injury, harm, wound, trauma |
| spill | spill, leak, discharge, overflow |
| outage | outage, downtime, blackout, failure |
| collision | collision, crash, impact |

**Pinyin matching:** Chinese pinyin (without tone marks) is generated from the keyword and matched against pinyin of all searchable fields.

**Relevance scoring:**
- Exact keyword match in any field: +5
- Pinyin keyword match: +4
- Synonym match in any field: +2
- Synonym + pinyin match: +1
- Results filtered to score > 0 when keyword is provided
- Sorted by relevance score descending, then by chosen `sort` key

**Success response (200):**
```json
{
  "count": 15,
  "filters": {
    "q": "slip",
    "site": "Dock A",
    "status": "New",
    "date_from": "2024-01-01",
    "date_to": "2024-12-31",
    "cost_min": 100,
    "cost_max": 1000,
    "risk_tags": [],
    "theme": null,
    "origin": null,
    "destination": null
  },
  "sort": "recent_activity",
  "results": [
    {
      "id": 7,
      "reporter_id": 3,
      "type": "Injury",
      "description": "Worker slipped near Dock A",
      "site": "Dock A",
      "time": "2024-03-10T14:00:00.000Z",
      "status": "New",
      "rating": 3,
      "cost": 150.00,
      "risk_tags": { "tags": ["chemical"], "sensitive": {} },
      "created_at": "2024-03-10T14:05:00.000Z",
      "popularity": 5,
      "recent_activity": "2024-03-10T14:05:00.000Z",
      "parsed_risk_tags": {},
      "relevance_score": 5
    }
  ]
}
```

---

### `GET /settings/config`

Fetch current SLA defaults, incident types, and SLA rules.

**Auth:** JWT required  
**Roles:** Safety Manager, Auditor, Administrator

**Query parameters:** None

**Success response (200):**
```json
{
  "sla_defaults": {
    "ack_minutes": 15,
    "close_hours": 72
  },
  "incident_types": ["Injury", "Fire", "Spill", "Equipment Failure", "Security", "Near Miss"],
  "sla_rules": []
}
```

---

### `PATCH /settings/sla`

Update SLA acknowledgement and closure targets.

**Auth:** JWT required + Safety Manager role  
**Security headers:** CSRF + timestamp + nonce

**Request body:**
```json
{
  "ack_minutes": 30,
  "close_hours": 48
}
```

| Field | Type | Constraints |
|-------|------|------------|
| `ack_minutes` | integer | 1–240 |
| `close_hours` | integer | 1–720 |

**Success response (200):**
```json
{
  "message": "SLA settings updated",
  "settings": {
    "ack_minutes": 30,
    "close_hours": 48
  }
}
```

---

### `PATCH /settings/incident-types`

Update the list of permitted incident types.

**Auth:** JWT required + Safety Manager role  
**Security headers:** CSRF + timestamp + nonce

**Request body:**
```json
{
  "incident_types": ["Injury", "Fire", "Spill", "Near Miss", "Equipment Failure"]
}
```

| Field | Type | Constraints |
|-------|------|------------|
| `incident_types` | string[] | At least 1, max 50; empty strings trimmed |

**Success response (200):**
```json
{
  "incident_types": ["Injury", "Fire", "Spill", "Near Miss", "Equipment Failure"]
}
```

---

### `PATCH /settings/sla-rules`

Update custom SLA routing rules.

**Auth:** JWT required + Safety Manager role  
**Security headers:** CSRF + timestamp + nonce

**Request body:**
```json
{
  "rules": [
    { "type": "Fire", "ack_minutes": 5 },
    { "type": "Injury", "ack_minutes": 15 }
  ]
}
```

| Field | Type | Constraints |
|-------|------|------------|
| `rules` | array | Max 100 entries; must be valid JSON |

**Success response (200):**
```json
{
  "rules": [
    { "type": "Fire", "ack_minutes": 5 },
    { "type": "Injury", "ack_minutes": 15 }
  ]
}
```

---

### `GET /admin/metrics`

Fetch aggregated operational metrics for dashboards.

**Auth:** JWT required  
**Roles:** Safety Manager, Auditor, Administrator

**Query parameters:**
| Param | Type | Notes |
|-------|------|-------|
| `date_from` | string | ISO date; filter incidents and actions to this start |
| `date_to` | string | ISO date; filter incidents and actions to this end |

**Note:** `user_activity_logs` always covers the last **7 days** regardless of date filters.

**Success response (200):**
```json
{
  "incidents_by_status": [
    { "status": "New", "count": 5 },
    { "status": "Acknowledged", "count": 3 },
    { "status": "Closed", "count": 2 }
  ],
  "moderation_actions": [
    { "action": "STATUS_UPDATED", "count": 10 },
    { "action": "INCIDENT_CREATED", "count": 8 }
  ],
  "user_activity_logs": [
    { "user_id": 1, "count": 20 },
    { "user_id": 3, "count": 15 }
  ]
}
```

---

### `GET /health`

Lightweight health check for load balancers and orchestrators.

**Auth:** None

**Success response (200):**
```json
{
  "status": "ok"
}
```

---

## Appendix: Content Moderation

Every text field submitted to `POST /incidents` and `PATCH /incidents/:id/status` is scanned by `moderateTextInputs()` in `src/utils/moderator.ts`.

**Blocked terms (case-insensitive):**
```
password, credit card, ssn, social security number, api key, secret
```

**PII patterns detected:**
| Pattern | Regex | Example |
|---------|-------|---------|
| Email | RFC 5322 basic | `user@domain.com` |
| Phone | International + US formats | `+1 (555) 123-4567` |
| SSN | `XXX-XX-XXXX` | `123-45-6789` |
| Card-like | 13–19 digits with optional separators | `4111 1111 1111 1111` |

Detection returns `{field, type: "blocked_term" | "pii", detail}` objects. The request is rejected with `422` if any issues are found.

## Appendix: File Upload Validation

Images uploaded via `POST /incidents` are validated in layers:

1. **Extension allowlist:** `.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`
2. **Extension blocklist:** `.exe`, `.bat`, `.cmd`, `.sh`, `.php`, `.js`, `.jar`, `.msi`
3. **MIME type consistency:** Declared MIME must match extension
4. **Magic bytes (file signature):**
   - JPEG: `FF D8 FF`
   - PNG: `89 50 4E 47 0D 0A 1A 0A`
   - GIF: `47 49 46 38 39|37 61`
   - WebP: `52 49 46 46 ... 57 45 42 50`
5. **Size:** Max 10MB per file
6. **Count:** Max 5 files per request
7. **Filename moderation:** Parsed filename (without extension) scanned for blocked terms and PII patterns

Files are stored with UUID filenames: `uploads/incidents/<uuid>.<ext>`. The original filename is not stored on disk; only the relative path reference is kept in the `images` table.
