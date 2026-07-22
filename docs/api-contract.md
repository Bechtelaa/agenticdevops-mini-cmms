# API Contract — CMMess

> The authority for the renderer↔backend REST surface. Per `docs/contract-sync.md`,
> any endpoint/schema change moves its Pydantic model, its TypeScript type, and this
> doc **in the same commit** (Rule 12). No renderer exists yet, so the TypeScript leg
> is N/A until the renderer lands.

## Auth

**Scheme:** opaque bearer tokens. `POST /auth/login` returns a raw token;
every protected endpoint expects `Authorization: Bearer <token>`. Tokens are
stored server-side only as SHA-256; sessions expire after
`CMMESS_SESSION_TTL_HOURS` (default 24) and are treated as invalid on read.

**Enforcement pattern (DEC-005) — binding for every future protected
endpoint:** authorization is a server-side FastAPI dependency, never renderer
UI state. Use `require_user` (any valid session of an active account — both
roles) or `require_planner` (planner only) from `backend/app/auth.py`.
FS-Q3: Planner ⊇ User — a planner session passes both.

**Error semantics (uniform):**

- `401` — missing/malformed/unknown/expired token, or the session's user is
  inactive. One generic body for all of these; no distinguishing detail.
- `403` — valid session, insufficient role (e.g. `user` on a planner-only
  endpoint).
- Login failures (unknown username, wrong password, inactive account) all
  return the **same** 401 body — no username enumeration.

Accounts are seeded from a TOML config at startup (FS-Q5) — see
`docs/data-model.md`; there is no signup/registration endpoint.

TypeScript leg: N/A this task (backend-only, Architect 2026-07-22); the
renderer login task adds the TS types for these shapes.

### POST /auth/login

- **Auth:** none
- **Request model:** `LoginRequest` (`backend/app/auth.py`) — `username: str`, `password: str`
- **Response model:** `LoginResponse` — `token: str`, `user: UserOut` (`id: int`, `username: str`, `role: "user" | "planner"`)
- **Errors:** `401` generic on any failure
- **Example response (200):**

  ```json
  {"token": "…opaque…", "user": {"id": 1, "username": "planner1", "role": "planner"}}
  ```

### POST /auth/logout

- **Auth:** bearer (`require_user`-level)
- **Response:** `204 No Content`; the session is deleted — the token 401s afterwards
- **Errors:** `401` per the uniform semantics

### GET /auth/me

- **Auth:** bearer (`require_user`) — the protected-endpoint exemplar
- **Response model:** `UserOut` — `id: int`, `username: str`, `role: "user" | "planner"`
- **Errors:** `401` per the uniform semantics
- **Example response (200):**

  ```json
  {"id": 1, "username": "planner1", "role": "planner"}
  ```

## Assets

Registry browse + manual-asset lifecycle (`backend/app/assets.py`). All five
endpoints require a bearer session at the **`require_user`** level — both
roles can browse, register, edit, and retire. Uniform 401/403 semantics per
the Auth section.

**Derived, never stored:** an asset's `status` (`"up" | "down"`) and each
downtime `duration_seconds` are computed from `downtime_events` at read time.
`status="down"` iff an ongoing event (`up_at IS NULL`) exists.

**Provenance rules (DEC-008):** `uns_discovered` rows are a cache rebuilt
from UNS discovery — `PATCH` and retire on them return **409**. Paths share
one namespace: registering a duplicate path returns **409**.

**Shared models:**

- `AssetOut` — `id: int`, `path: str`, `display_name: str`,
  `description: str | null`, `provenance: "uns_discovered" | "manual"`,
  `retired: bool`, `status: "up" | "down"`, `created_at`, `updated_at`
- `DowntimeEventOut` — `id`, `producer: "uns" | "manual"`, `down_at`,
  `up_at: datetime | null`, `duration_seconds: float | null` (null while
  ongoing), `reported_by: int | null`, `ended_by: int | null`
- `WorkOrderSummaryOut` — `id`, `origin`, `title`, `priority`, `status`,
  `created_at` (summary only — T-007 owns the full WO surface)

TypeScript leg: N/A until the renderer client lands (T-008).

### GET /assets

- **Auth:** bearer (`require_user`)
- **Query:** `include_retired: bool = false` — retired assets are hidden by
  default (FS-Q7)
- **Response:** `list[AssetOut]`, ordered by `path`. Flat — the renderer
  builds the path hierarchy client-side.

### GET /assets/{asset_id}

- **Auth:** bearer (`require_user`)
- **Response:** `AssetDetailOut` = `AssetOut` + `downtime_history:
  list[DowntimeEventOut]` (newest first) + `work_orders:
  list[WorkOrderSummaryOut]` (newest first)
- Reachable even when retired (hidden, not gone). **Errors:** `404` unknown id.

### POST /assets

- **Auth:** bearer (`require_user`) — manual registration, either role
- **Request:** `AssetCreate` — `path: str`, `display_name: str`,
  `description: str | null = null`. Path is validated server-side: stripped,
  1–255 chars, no leading/trailing `/`, all `/`-segments non-empty and
  non-whitespace → else **422**.
- **Response:** `201` + `AssetOut` (`provenance="manual"`, `retired=false`)
- **Errors:** `409` duplicate path (any provenance, retired or not); `422`
  malformed path

### PATCH /assets/{asset_id}

- **Auth:** bearer (`require_user`)
- **Request:** `AssetUpdate` — `display_name: str | null`,
  `description: str | null`; omitted fields unchanged, explicit
  `description: null` clears it. **`path` is deliberately absent** (path
  immutability, FS §3) and unknown fields are rejected (`extra="forbid"`) →
  **422**.
- **Response:** `AssetOut`. Editing a retired manual asset is allowed.
- **Errors:** `404` unknown id; `409` on `uns_discovered`; `422` unknown/extra
  fields

### POST /assets/{asset_id}/retire

- **Auth:** bearer (`require_user`)
- **Response:** `AssetOut` with `retired=true`. Idempotent — retiring an
  already-retired asset is a `200` no-op. No un-retire endpoint in v1
  (decided absence).
- **Errors:** `404` unknown id; `409` on `uns_discovered`

## Downtime events

The event→WO pipeline (`backend/app/downtime.py`). Reporting downtime seeds a
work order **atomically** in the same transaction — both or neither. The
reusable service `record_downtime(db, asset, producer, reported_by)` is the
seeding core; the future UNS ingestion task calls it directly with
`producer="uns"` (origin `uns_downtime`, `created_by` null) — no parallel
seeding path may be written.

Response shapes reuse the Assets section's `DowntimeEventOut` and
`WorkOrderSummaryOut` — no duplicate models.

**Explicit independence (FS §4):** ending a downtime event never changes its
work order's status, and no work-order code path ends events.

TypeScript leg: N/A until T-008.

### POST /assets/{asset_id}/downtime-events

- **Auth:** bearer (`require_user`) — either role reports
- **Request:** no body fields in v1 — `down_at` is always server time (no
  backdating; decided absence)
- **Response:** `201` → `{"event": DowntimeEventOut, "work_order":
  WorkOrderSummaryOut}`. The seeded WO: origin `manual_downtime`, linked
  `downtime_event_id`, title `Downtime — {path}`, priority `medium`, status
  `open`, `created_by` = the reporter.
- **Errors:**
  - `404` unknown asset
  - `409` retired asset (no new activity on retired assets)
  - `409` **FS-Q1 rejection** with a structured pointer body:

    ```json
    {"detail": {"message": "asset already has an ongoing downtime event",
                "ongoing_event_id": 7, "work_order_id": 12}}
    ```

    `work_order_id` is null only in the theoretical case no WO row links to
    the ongoing event. The same body is returned on the insert race (the
    partial unique index is the backstop) — never a 500.

### POST /downtime-events/{event_id}/end

- **Auth:** bearer (`require_user`) — either role ends **manual** events
- **Response:** `200` → `DowntimeEventOut` with `up_at` = server time,
  `ended_by` = the current user, `duration_seconds` now set
- **Errors:**
  - `404` unknown event
  - `409` `uns`-producer event — people end manual events only; UNS events
    end via the UNS up-signal (later task)
  - `409` already ended — **not idempotent**, so `ended_by` attribution is
    never silently rewritten

## Work orders

FS §5's state machine over REST (`backend/app/work_orders.py`). Every status
change goes through one shared transition helper that updates the WO and
writes its `work_order_transitions` audit row **in the same transaction** —
the FS-Q8 UNS-publish hook point; no second write path may be added.
Creation/seeding is not a transition and writes no row.

**Executor rule:** there is no executor column — starting a WO sets
`assigned_to` to the starter, so while `in_progress` the executor *is*
`assigned_to`. Abandon back to `open` clears the assignment; back to
`planned` keeps it.

**Error semantics:** wrong person/role → `403`; wrong state → `409` whose
`detail` names the current status (e.g. `cannot start a work order in status
'completed'`); unknown id → `404`. Uniform 401s per the Auth section.

**Explicit independence (FS §4):** completing or cancelling a WO never ends
its downtime event.

**Models:**

- `WorkOrderOut` — `id`, `asset_id`, `origin`, `downtime_event_id: int | null`,
  `title`, `description: str | null`, `priority`, `status`,
  `created_by: int | null`, `assigned_to: int | null`,
  `scheduled_start: datetime | null`, `expected_duration_minutes: int | null`,
  `completion_notes: str | null`, `created_at`, `updated_at`
- `TransitionOut` — `from_status`, `to_status`, `at`, `by_user: int | null`,
  `note: str | null`
- `WorkOrderDetailOut` — `WorkOrderOut` + `downtime_event: DowntimeEventOut |
  null` (reused from Assets) + `transitions: list[TransitionOut]`
  (chronological)

All transition endpoints return the updated `WorkOrderDetailOut`.
TypeScript leg: N/A until T-008.

### GET /work-orders

- **Auth:** bearer (`require_user`)
- **Query (exact-match, ANDed):** `status`, `asset_id`, `assigned_to`,
  `origin`, `priority`
- **Response:** `list[WorkOrderOut]`, `created_at` desc. The Planner queue
  (FS §6) is `status=open`; "my work" is `assigned_to=<own id>` — canned
  filters, not endpoints.

### GET /work-orders/{id}

- **Auth:** bearer (`require_user`) → `WorkOrderDetailOut`; `404` unknown

### POST /work-orders

- **Auth:** bearer (`require_user`) — either role
- **Request:** `WorkOrderCreate` — `asset_id`, `title`,
  `description: str | null = null`, `priority = "medium"` (FS-Q6: settable at
  creation by either role)
- **Response:** `201` + `WorkOrderOut` — origin `manual`, no event, status
  `open`, `created_by` = current user
- **Errors:** `404` unknown asset; `409` retired asset

### PATCH /work-orders/{id}

- **Auth:** bearer (`require_user`) — **creator or any Planner**
- **Request:** `title?`, `description?` (explicit `description: null` clears;
  unknown fields → `422`). Priority is deliberately absent — post-creation
  priority changes live in `plan`.
- Allowed while `open`/`planned` only. **Errors:** `403` wrong person; `409`
  started/terminal; `404` unknown

### POST /work-orders/{id}/plan — `require_planner`

- **Request (all optional, ≥1 required → else `422`):** `assigned_to?`,
  `scheduled_start?`, `expected_duration_minutes?`, `priority?`.
  `assigned_to` must reference an existing **active** user → `422` otherwise.
- From `open`: sets fields, status → `planned` (audit row). On an
  already-`planned` WO: **re-plan** — fields update, status unchanged, **no**
  audit row (rows record status changes only). Any other status → `409`.

### POST /work-orders/{id}/start — `require_user`

- From `open`: anyone, self-serve (the 3am case) — sets `assigned_to` =
  starter. From `planned`: **assignee only** (`403` for anyone else,
  Planners included). Status → `in_progress`. Other states → `409`.

### POST /work-orders/{id}/complete — `require_user`

- **Request:** `completion_notes` — required, non-empty after strip (`422`)
- From `in_progress` only (`409` otherwise); **executor only**
  (`assigned_to` == caller; `403` otherwise, Planners included). Status →
  `completed`; notes stored on the WO.

### POST /work-orders/{id}/abandon — `require_user`

- **Request:** `note` — required, non-empty (`422`); the note lands on the
  transition row
- From `in_progress` only (`409`); **executor or any Planner** (FS-Q4;
  `403` otherwise). Target state: the `from_status` of the latest transition
  into `in_progress` — back to `planned` keeps `assigned_to`, back to `open`
  clears it. The WO is startable again.

### POST /work-orders/{id}/cancel — `require_planner`

- **Request:** `note?` (optional)
- From any non-terminal status → `cancelled`; terminal → `409`; `user` role →
  `403` (FS-Q4)

## Endpoints

### GET /health

- **Path:** `/health`
- **Method:** `GET`
- **Auth:** none
- **Response model:** `HealthResponse` (`backend/app/main.py`) — `status: Literal["ok"]`
- **Example response (200):**

  ```json
  {"status": "ok"}
  ```
