# Controller Testing Lab — Implementation Blueprint v1

## 1) Scope and objective

This blueprint standardizes development and QA for the **Controller Testing Lab** feature so that:

- API behavior is deterministic across Vercel and Cloudflare routes.
- Booking/queue race conditions are handled consistently.
- Manual and automated test coverage protects production stability.

Feature anchors:

- UI surface in `public/support_studio.html` (Controller Testing Lab card and modals).
- Frontend orchestration in `public/js/support_studio/core_ui.js`.
- Shared state/config endpoints in `server/routes/studio/ctl_lab_config.js` and `server/routes/studio/ctl_lab_state.js`.
- Dual-platform API adapters in `api/handler.js` and `functions/api/[[path]].js`.

---

## 2) API Contract Catalog (exact payload contracts)

> Base path used by frontend: `/api/*`
>
> Authentication: `Authorization: Bearer <access_token>` required for both endpoints.

### 2.1 GET `/api/studio/ctl_lab_config`

**Purpose:** Load shared controller catalog/config for all authenticated users.

**Request**

- Method: `GET`
- Headers:
  - `Authorization: Bearer <token>`
  - `Cache-Control: no-store` (recommended)

**Success Response (200)**

```json
{
  "ok": true,
  "items": [
    {
      "id": "ctl_1710000000000_0",
      "type": "E2",
      "ip": "192.168.1.100",
      "status": "Online"
    }
  ],
  "updatedAt": "2026-04-10T11:30:00.000Z"
}
```

**Error Responses**

- `401`

```json
{ "ok": false, "error": "unauthorized" }
```

- `500`

```json
{ "ok": false, "error": "db_read_failed" }
```

**Normalization Rules (server-side)**

- `type` allowed values only: `E2`, `E3`, `Site Supervisor`; fallback to `E2`.
- `items` is array, max 20 entries.
- Each item normalized to: `{ id, type, ip, status }`.

---

### 2.2 POST `/api/studio/ctl_lab_config`

**Purpose:** Save shared controller config list.

**Request**

- Method: `POST`
- Headers:
  - `Authorization: Bearer <token>`
  - `Content-Type: application/json`
- Body:

```json
{
  "items": [
    {
      "id": "ctl_1710000000000_0",
      "type": "E3",
      "ip": "10.10.10.1",
      "status": "Maintenance"
    }
  ]
}
```

**Success Response (200)**

```json
{
  "ok": true,
  "saved": 1,
  "items": [
    {
      "id": "ctl_1710000000000_0",
      "type": "E3",
      "ip": "10.10.10.1",
      "status": "Maintenance"
    }
  ],
  "updatedAt": "2026-04-10T11:34:00.000Z"
}
```

**Error Responses**

- `401`

```json
{ "ok": false, "error": "unauthorized" }
```

- `500`

```json
{
  "ok": false,
  "error": "db_write_failed",
  "detail": "<truncated db response>"
}
```

---

### 2.3 GET `/api/studio/ctl_lab_state`

**Purpose:** Load shared booking and queue state.

**Request**

- Method: `GET`
- Headers:
  - `Authorization: Bearer <token>`
  - `Cache-Control: no-store`

**Success Response (200)**

```json
{
  "ok": true,
  "bookings": {
    "ctl_1710000000000_0": {
      "user": "user@example.com",
      "avatarUrl": "https://...",
      "task": "Firmware validation",
      "duration": "30 minutes",
      "backupFile": "https://sharepoint/...",
      "startMs": 1775814000000,
      "endMs": 1775815800000
    }
  },
  "queues": {
    "ctl_1710000000000_0": [
      {
        "user": "next.user@example.com",
        "avatarUrl": "https://...",
        "task": "Protocol verification",
        "duration": "15 minutes",
        "urgent": false,
        "wantsAlarm": true,
        "joinedAt": 1775814100000
      }
    ]
  },
  "participants": ["user@example.com", "next.user@example.com"],
  "updatedAt": "2026-04-10T11:36:00.000Z"
}
```

**Error Responses**

- `401`

```json
{ "ok": false, "error": "unauthorized" }
```

- `500`

```json
{ "ok": false, "error": "db_read_failed" }
```

---

### 2.4 POST `/api/studio/ctl_lab_state`

**Purpose:** Patch shared state (`booking`, `queue`) or replace full state (`state`).

#### 2.4.a Booking patch payload

```json
{
  "booking": {
    "id": "ctl_1710000000000_0",
    "data": {
      "user": "owner@example.com",
      "avatarUrl": "https://...",
      "task": "E2 backup",
      "duration": "10 minutes",
      "backupFile": "https://sharepoint/...",
      "startMs": 1775814200000,
      "endMs": 1775814800000
    }
  }
}
```

#### 2.4.b Queue patch payload

```json
{
  "queue": {
    "id": "ctl_1710000000000_0",
    "items": [
      {
        "user": "queue.user@example.com",
        "avatarUrl": "https://...",
        "task": "Config check",
        "duration": "30 minutes",
        "urgent": true,
        "wantsAlarm": true,
        "joinedAt": 1775814300000
      }
    ]
  }
}
```

#### 2.4.c Full state payload

```json
{
  "state": {
    "bookings": {},
    "queues": {},
    "participants": []
  }
}
```

**Success Response (200)**

```json
{
  "ok": true,
  "bookings": {},
  "queues": {},
  "participants": [],
  "updatedAt": "2026-04-10T11:40:00.000Z"
}
```

**Server Rules**

- Expired booking (`endMs <= now`) is dropped.
- Queue per controller capped to 30 entries.
- Participants are merged from existing + derived + acting user.

---

## 3) Edge-case Matrix (queue/booking race conditions)

| ID | Scenario | Trigger | Expected Behavior | Mitigation / Assertion |
|---|---|---|---|---|
| EC-01 | Simultaneous booking same controller | Two users click Book within same second | Last valid write persists; UI refresh shows final owner | Poll `/ctl_lab_state` after write; ensure one active booking only |
| EC-02 | Queue duplicate user | Same user joins queue in two tabs | Only one effective queue entry | Frontend `alreadyIn` check + server normalize |
| EC-03 | Expired booking stale in cache | Browser tab left open long time | Server drops expired booking on normalize | GET state after expiry should not include booking |
| EC-04 | Missing auth token | Token expired/cleared | API returns 401, UI should not crash | Guard token retrieval and retry strategy |
| EC-05 | Config type invalid | Client sends unknown `type` | Server coerces to `E2` | Assert response normalized `type` |
| EC-06 | Payload flooding | More than 20 controllers in config | Stored items max 20 | Assert `saved <= 20` |
| EC-07 | Queue flooding | More than 30 queue entries | Queue clipped to 30 | Assert queue length 30 max |
| EC-08 | Full-state overwrite conflict | One client posts full state while others patch | Latest state consistent; no invalid shapes | Normalize state on every write |
| EC-09 | Network fail on sheet logging | Sheets endpoint down | Booking still saved; pending logs retained | Check pending log modal count increments |
| EC-10 | Cloudflare/Vercel route mismatch | Endpoint added in one router only | One platform fails with 404 | Route parity checklist mandatory |
| EC-11 | Malformed JSON body | Broken client body | Server resolves empty object, safe error path | Should return method-compatible response, no crash |
| EC-12 | Delete booking via null | Booking patch with invalid/expired data | Server removes booking key | GET confirms booking key absent |
| EC-13 | Queue notify repeated | Timer triggers repeatedly | Notify action idempotent by `notifiedAt` logic | Verify no repeated spam behavior |
| EC-14 | Browser localStorage corrupt | Invalid JSON in local cache | Fallback to empty array/object | UI loads with safe defaults |
| EC-15 | Participants list growth | Heavy usage users | Participants deduped and capped | Max participants = 500 |

---

## 4) Recommended test cases

## 4.1 Manual test pack (high priority)

1. **MT-01: Add controller + persistence**
   - Add E2 controller in config modal.
   - Refresh page and verify item persists.
   - Open second browser account, verify same controller visible.

2. **MT-02: Book controller path**
   - Fill task + duration + backup link.
   - Submit booking.
   - Confirm card becomes in-use with user/time metadata.

3. **MT-03: Queue join/leave path**
   - Second user joins queue with task/duration.
   - Verify queue position badge and queue modal list.
   - Leave queue and verify removal.

4. **MT-04: Urgent queue notice**
   - Queue user marks urgent.
   - Active booking user sees urgent notice banner.

5. **MT-05: Override path**
   - Open override modal.
   - Submit reason.
   - Verify booking ownership transitions and entry logged flow remains stable.

6. **MT-06: Unauthorized API behavior**
   - Remove token/session manually.
   - Trigger config/state fetch.
   - Confirm no blank-screen crash and API returns 401 path.

7. **MT-07: Expiry handoff behavior**
   - Book short duration (5 min).
   - Wait expiry and verify queue notify/availability flow.

8. **MT-08: Route parity smoke**
   - Verify behavior on UAT (Vercel) and PROD-like (Cloudflare) deployment.

## 4.2 Automated tests (recommended)

### A) Contract tests (API level)

- `GET /ctl_lab_config` requires auth.
- `POST /ctl_lab_config` normalizes invalid types and max items.
- `GET /ctl_lab_state` returns sanitized shape.
- `POST /ctl_lab_state` patch booking, patch queue, and full-state modes.
- Expired booking is dropped automatically.

### B) Integration tests (UI + API mocked)

- Config save debounced write triggers one final POST.
- Booking submit writes state patch and updates UI state.
- Queue join prevents duplicate user insertion.
- Leave queue removes entry and rerenders.

### C) Regression tests (cross-platform)

- Route registry includes both endpoints in:
  - `api/handler.js`
  - `functions/api/[[path]].js`

---

## 5) SQL verification pack (read-only integrity checks)

> Run in Supabase SQL editor or psql with read-only privilege.

```sql
-- Verify docs exist
select key, updated_at, updated_by_name
from mums_documents
where key in ('ss_ctl_lab_config_v1', 'ss_ctl_lab_state_v1')
order by updated_at desc;
```

```sql
-- Inspect current config payload
select
  key,
  jsonb_typeof(value->'items') as items_type,
  jsonb_array_length(coalesce(value->'items', '[]'::jsonb)) as item_count
from mums_documents
where key = 'ss_ctl_lab_config_v1';
```

```sql
-- Inspect current state payload shape
select
  key,
  jsonb_typeof(value->'bookings') as bookings_type,
  jsonb_typeof(value->'queues') as queues_type,
  jsonb_typeof(value->'participants') as participants_type
from mums_documents
where key = 'ss_ctl_lab_state_v1';
```

---

## 6) Launch Protocol (strict deployment checklist)

1. **Code parity check (mandatory)**
   - Confirm endpoint mapping exists in both:
     - `api/handler.js`
     - `functions/api/[[path]].js`

2. **UI smoke check in Support Studio**
   - Open Controller Testing Lab card.
   - Click config cog (`hp-ctl-config-btn`) and add controller.
   - Click **Book this Controller** from booking modal.
   - Click **Join Queue** in queue modal.
   - Trigger and validate override flow.

3. **Auth behavior check**
   - With valid token: GET/POST must pass.
   - Without token: must return 401 and UI remains stable.

4. **Database integrity check**
   - Run SQL verification pack.
   - Confirm both doc keys are present and JSON shapes are valid.

5. **Concurrency sanity check**
   - Two users, same controller, same minute booking attempts.
   - Ensure final state is deterministic and visible to both users after refresh.

6. **No-regression gate**
   - If any critical path fails (config save, booking, queue, override), stop release.

---

## 7) Non-negotiable constraints for future changes

- Do not change auth logic/JWT verification path.
- Do not change realtime channel/topic naming if introduced elsewhere.
- Do not alter existing UI structure IDs/classes used by the feature.
- Do not remove existing flows; use additive hardening only.
- Keep Vercel and Cloudflare route registrations synchronized.
