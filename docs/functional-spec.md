# CMMess — Functional Specification (v1 / MVP)

> **The product-behavior authority.** This doc says *what CMMess does* — features,
> roles, lifecycles, and what's explicitly out of v1. It sits between
> `docs/user_story.md` (why) and the contract docs (`data-model.md`,
> `api-contract.md`, `uns-contract.md`), which are *derivations* of it. Where this
> doc and `docs/architecture-facts.md` touch the same ground, architecture-facts
> holds the constraint and this doc holds the behavior — they must agree; if they
> don't, that's drift to reconcile, not a license to pick one.
>
> **All v1 behavior below is decided** — Senior Architect pass completed
> 2026-07-22 (see § 9 Decision record). Changes from here are new decisions, not
> open questions.

## 1. Product overview

CMMess is a reactive CMMS for facility maintenance teams: a single shared
multi-user instance with two roles — **Users** (technicians/engineers who execute
work) and **Planners** (managers who plan and schedule it).

The core primitive is the **event-driven work order**: a downtime event on an
asset seeds a work order. There are **two event producers** feeding one pipeline —
the **UNS** (automatic detection via MQTT) and the **front end** (a User or
Planner reports downtime from the UI). In addition, work orders can be **created
directly** (no downtime event at all — e.g., "guard rail loose"). CMMess is
**fully usable with zero UNS connection**: manual asset registration, manual
downtime reporting, and manual work-order creation form a complete standalone
loop (DEC-008). This is a key MVP requirement, not a degraded mode.

```
UNS broker ──┐
             ├─→ downtime event ─→ WO seeded     (origins: uns_downtime, manual_downtime)
Front end ───┤
             └──────────────────→ WO created     (origin: manual)
```

v1 is reactive-only, but nothing may preclude a later preventive/scheduled origin
(e.g., `pm_schedule`) — the origin field is the extension point.

## 2. Roles & permissions

Authorization is enforced server-side per endpoint (DEC-005); the renderer only
shows/hides UI for UX. **Planner is a strict superset of User (FS-Q3):** every
User capability is also a Planner capability. The matrix below is the behavioral
contract every endpoint's role check implements.

| Capability | User | Planner |
|---|---|---|
| Log in / view own profile | ✓ | ✓ |
| Browse assets, asset detail (status, downtime + WO history) | ✓ | ✓ |
| Register a manual asset | ✓ | ✓ |
| Report a downtime event (asset down) | ✓ | ✓ |
| End a downtime event (asset back up) — manual events | ✓ | ✓ |
| Create a work order directly (origin `manual`) | ✓ | ✓ |
| View all work orders | ✓ | ✓ |
| Plan / schedule / assign a work order | ✗ | ✓ |
| Start work on an **Open** (unplanned) WO — self-serve | ✓ | ✓ |
| Start work on a **Planned** WO | assignee only | assignee only |
| Complete a WO (completion notes required) | executor | executor |
| Abandon an In Progress WO (moves back, note required) | executor | ✓ |
| Cancel a WO | ✗ | ✓ |
| Edit WO description/details before work starts | creator | ✓ |

Decided explicitly: planning/scheduling is Planner-gated but is **not** a gate on
execution — anyone can pick up any Open WO and start it (the 3am-breakdown case).

## 3. Assets & the registry

- An **asset** is a generic, configurable entity — never a plant-specific
  equipment table. **Asset identity is its UNS-style path** (e.g.
  `site/area/line/cell/asset`), for every asset regardless of how it was
  registered. One namespace. The path is immutable.
- Each asset has a typed **provenance**: `uns_discovered` or `manual`.
  - `uns_discovered`: the UNS is authoritative; the local registry row is a cache
    rebuilt from UNS discovery (DEC-007). Not locally editable.
  - `manual`: registered from the front end by a User or Planner; the registry is
    authoritative (DEC-008). Registration captures path, display name, and
    description; display name and description stay editable (FS-Q7).
- **No deletes — retire instead (FS-Q7):** retiring a manual asset hides it from
  the browser but keeps it and all attached history reachable.
- **Merge rule (DEC-008):** if UNS discovery later finds an asset at the same
  path as a manual asset, they are the same asset — provenance flips to
  `uns_discovered` and all attached history (downtime events, work orders) stays,
  because identity is the path.
- Asset detail shows: current up/down status, downtime history with derived
  durations, and work-order history. Status and duration are always **derived
  from the timestamped event log**, never stored as totals (architecture-facts
  § Derived vs. authoritative).

## 4. Downtime events

- A downtime event is a pair of timestamped transitions: **down** at t₁, **up**
  at t₂ (t₂ absent while ongoing). Duration is computed, never stored.
- **Producers:** UNS-detected (backend MQTT client observes the down signal) or
  front-end-reported (either role, from the asset's detail view).
- **One ongoing event per asset (FS-Q1):** while an asset has an ongoing downtime
  event, any second down-report — from either producer — is rejected with a
  pointer to the ongoing event and its work order.
- **Seeding:** every downtime event seeds **one** work order automatically at the
  moment the down transition is recorded, with origin `uns_downtime` or
  `manual_downtime` matching the producer, linked to the event. This holds even
  when a prior WO on the same asset is still open — recurrence stays visible in
  the queue; smarter linking is post-MVP (FS-Q2).
- **Ending:** UNS-detected events end when the UNS up-signal arrives;
  front-end-reported events end when a person (either role) marks the asset back
  up. Completing the work order does **not** auto-end the downtime, and ending
  the downtime does not auto-complete the WO — the event log records what the
  asset did; the WO records what people did.

## 5. Work orders

**Fields (behavioral level — schema lands in `data-model.md`):** id · asset
(required, any provenance) · origin (`uns_downtime` | `manual_downtime` |
`manual`; typed, extensible) · linked downtime event (present for the two
downtime origins, absent for `manual`) · title + description · priority
(`low`/`medium`/`high`, default `medium` — settable at creation by either role,
adjustable by Planners; FS-Q6) · `created_by` (the actual person, or system for
UNS-seeded) · `assigned_to` · scheduled window · status · completion notes ·
timestamps per transition.

**State machine (decided):**

```
Open → Planned → In Progress → Completed
  ↑───────↑──────────┘  (abandon: moves back, note required)
  └──────────────────────→ Cancelled (from any non-terminal state, Planner only)
```

| Transition | Who |
|---|---|
| (seed/create) → Open | system (event pipeline) or either role (manual) |
| Open → Planned | Planner (assign + schedule) |
| Open → In Progress | any User or Planner, self-serve |
| Planned → In Progress | the assignee |
| In Progress → Completed | the executor; completion notes required |
| In Progress → Planned (if it was assigned) / Open | executor or Planner; note required (abandon — work returns to the queue, it doesn't die; FS-Q4) |
| any non-terminal → Cancelled | Planner only (FS-Q4) |

- **Open** = seeded/created, unplanned. **Planned** = a Planner has assigned a
  User and/or set a scheduled window. **In Progress** = someone is executing.
  **Completed/Cancelled** = terminal.
- Skipping Planned is normal, not an exception path — reactive work often goes
  Open → In Progress directly.
- **UNS publishing (FS-Q8 — in scope for v1):** work-order lifecycle transitions
  are published to a **CMMess-owned UNS topic branch** by the backend (which
  remains the system's sole MQTT client, DEC-007). Publishing is fire-and-forget
  state reflection — CMMess never consumes its own published topics, and a
  missing broker degrades publishing silently, never blocking the WO lifecycle
  (zero-UNS operation stays intact). Topic design lands in `docs/uns-contract.md`.

## 6. Planning & scheduling (Planner)

- The Planner's working view is the queue of **Open** work orders (filter/sort by
  priority, asset, age).
- Planning an order = assigning a User, setting a scheduled window (start
  datetime + expected duration), and adjusting priority.
- MVP scheduling is **fields on the work order + list views** — no calendar or
  capacity visualization in v1.

## 7. MVP screen inventory

What exists, not how it looks — `docs/design-guide.md` governs visuals.

1. **Login** — role comes from the account, not a picker.
2. **Asset browser** — the registry as a UNS-path hierarchy; up/down status at a
   glance; entry point for manual asset registration; retired assets hidden.
3. **Asset detail** — status, downtime history (derived durations), WO history;
   actions: report downtime / mark back up / create WO / edit-retire (manual
   assets only).
4. **Work-order list** — all WOs, filterable by status/assignee/asset/origin;
   "my work" filter for Users.
5. **Work-order detail** — full record + the role-legal state transitions as
   actions; Planner sees assign/schedule controls here.
6. **Work-order create** — direct manual creation (asset, title, description,
   priority).
7. **Planner queue** — a canned filter on the WO list (Open, sorted for
   planning), not a separate screen.

## 8. Out of scope for v1

Recorded so their absence reads as decided, not forgotten:

- **Preventive/scheduled maintenance** — excluded, but the origin field, state
  machine, and scheduling fields must not preclude it (the stated extension
  path).
- Notifications (email/push/in-app alerting).
- Reporting/analytics dashboards (MTTR/MTBF etc.) — the derived-from-events model
  is designed to make these computable later.
- Parts/inventory management.
- Attachments/photos on work orders.
- Multi-site/multi-tenant separation — one shared instance.
- Calendar/capacity scheduling views (see § 6).
- User-administration UI — accounts are **seeded from backend config** (FS-Q5):
  username, password hash, role; loaded at startup; no self-signup. Adding a
  teammate = edit config, restart.
- Cross-WO downtime linking/dedup beyond the one-ongoing-event rule (FS-Q1/Q2).

## 9. Decision record — Architect pass, 2026-07-22

The open questions this spec shipped with, and the rulings now baked into the
sections above:

- **FS-Q1** One ongoing downtime event per asset; second down-reports rejected → § 4
- **FS-Q2** Each downtime event seeds its own WO, even with a prior WO open → § 4
- **FS-Q3** Planner is a strict superset of User → § 2
- **FS-Q4** Cancel is Planner-only; executors abandon (move back + note) → §§ 2, 5
- **FS-Q5** Seeded config accounts; no admin UI or self-signup in v1 → § 8
- **FS-Q6** Priority: low/medium/high, default medium → § 5
- **FS-Q7** Manual assets: edit name/description, immutable path, retire-not-delete → § 3
- **FS-Q8** **v1 publishes WO lifecycle state to a CMMess-owned UNS topic branch** (Architect override of the subscribe-only default) → § 5
- Nine minor defaults accepted wholesale (manual-downtime ending, assignee-start,
  required completion notes, pre-start editability, registration fields,
  event/WO independence, window shape, queue-as-filter, no calendar) → in place
  throughout.
