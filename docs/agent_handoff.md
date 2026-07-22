# CMMess — Agent Handoff

> **Format: always-current. Updated every turn, not end-of-session.** This is the first thing every agent reads. It answers "where are we right now?" — keep it true.

## Read me first in any new session

Mandatory before responding to the human:

1. This file — state of play.
2. `docs/completed_development.md` *most-recent entries only* — what just shipped.
3. `docs/project_management.md` task table — live task status.
4. `docs/bug_log.md` — active bugs.
5. `docs/backlog.md` — prioritized "what's next" *(created when the first backlog item is queued; until then see `project_management.md` § Queued)*.

Then read what's relevant per the Tier-1/Tier-2 list in the project instructions, and the one authority doc for the area you're touching (`docs/authority-docs-by-area.md`).

## Current state

**Project bootstrap in progress — no product code yet.** The repo currently holds the workflow scaffolding (Layer A templates, Layer B2 scaffolds, checklists, agent-config templates) plus the CMMess instructions and user story. We are standing the workflow up, not building features.

**Landed this bootstrap:** all Layer B2 docs (`architecture-facts.md`, `authority-docs-by-area.md`, `contract-sync.md`) and all seven Layer A living docs; `CLAUDE.md` (root) and `.cursor/rules/qa-role.mdc`; the three checklists filled (spec-authoring, close-out, and packaging-preflight resolved as defer-TBD); a fresh CMMess `README.md`. The instructions mirror received three edits — add `api-contract.md` to Tier 2, repoint Rule 12 at `docs/contract-sync.md`, and repoint §3's review-agent config at `.cursor/rules/qa-role.mdc`. All kept docs were de-referenced from the soon-to-be-deleted scaffolds so nothing dangles.

**Scaffolding deleted; slot gate clean.** The template `layer-a/`, `layer-b2/`, `layer-b1-example/`, `agent-config/*.template.md`, `teaching/`, `diagrams/`, `INSTANTIATE.md`, and `SETUP.md` are removed. The slot gate returns only the three intentional ADOPT-IF markers (in `contract-sync.md`, `sub-agents.md`, `skills.md`) — the written-down "revisit when X" triggers, which stay.

**T-001 shipped and closed out (2026-07-22) — first full loop trip complete.** The backend skeleton is live: FastAPI `GET /health` through a typed Pydantic model, one passing pytest, ruff+mypy strict clean, `docs/api-contract.md` seeded in the same commit (Rule 12), root `.gitignore`. Commit `0a3e2a2` on `main` (direct commit — tolerated once; branch→PR resumes at T-002 when CI exists). Dev → Cursor QA → PM read-verify → human runtime test all exercised for real. Full record: `docs/completed_development.md` § T-001. Backend venv lives at `backend/.venv` (`source .venv/bin/activate` before `uvicorn app.main:app`). Note: the PM is temporarily running as a Claude Code instance (Desktop MCP bug anthropics/claude-code#79971).

**Functional spec drafted + DEC-008 landed (2026-07-22).** `docs/functional-spec.md` is live as the product-behavior authority (announced in `authority-docs-by-area.md`): three WO origins (`uns_downtime`/`manual_downtime`/`manual` — Architect decision), manual asset registration with provenance + path-merge rule (DEC-008, narrows DEC-007 — the product is fully usable with zero UNS), standard WO state machine (Open→Planned→In Progress→Completed, +Cancelled), User self-serve execution on Open WOs. `architecture-facts.md` and `CLAUDE.md` were synced to DEC-008 in the same pass. **Awaiting the Architect's pass on the FS's [default] markers and § 9 open questions (FS-Q1–Q8)** — defaults are workable, so this doesn't block T-002. The three earlier constitution edits are synced into the Project instructions field (done 2026-07-22). Temp file `docs/architecture-diagram-temp.md` exists for the human to pull out — not a living doc; delete on request (its "UNS authoritative" label predates DEC-008).

**T-002 shipped, merged, fully closed (2026-07-22).** Renderer shell (Electron+Vite+React, main lifecycle-only, ctx isolation on) + `ci.yml` merged to `main` via PR #1 (squash `84761ff`); branch deleted local+remote. First complete branch→PR→CI-green→merge trip. The full loop ran with two real arbitrations: Cursor's doc-allowlist FAIL (PM branch bookkeeping, not agent drift — future ACs now say "the *coding agent* changes no files outside this list") and a first-run CI failure that produced **TRAP-001** (npm-major skew: lock written by npm 11, rejected by npm 10; fixed by repinning CI Node 22→26 to match the lead's machine and regenerating the lock from scratch — plain `npm install` was a no-op on the bad lock). Full record: `docs/completed_development.md` § T-002.

**FS settled (2026-07-22).** The Architect's pass on `docs/functional-spec.md` is complete: FS-Q1–Q8 ruled, all [default] markers accepted, decisions baked into the doc (§ 9 is the decision record). Headline rulings: one ongoing downtime event per asset; each event seeds its own WO; Planner ⊇ User; cancel Planner-only with an executor abandon path; seeded config accounts; 3-level priority; retire-not-delete assets; and **FS-Q8 override — v1 publishes WO lifecycle state to a CMMess-owned UNS topic branch** (backend stays sole MQTT client; fire-and-forget, never blocks the WO lifecycle; expands `docs/uns-contract.md` scope to a publish surface when authored).

## Immediate next steps

1. PM: spec **T-003 — data model + persistence base** (SQLAlchemy/Alembic dual-engine; asset/downtime-event/WO schema per the settled FS; authors `docs/data-model.md`).
2. Then **T-004 — auth/roles** (seeded config accounts per FS-Q5; server-side enforcement per DEC-005).

## Architecture authorities by area (read the one you're touching)

The full index is in `docs/authority-docs-by-area.md`. Short version: architecture constraints → `architecture-facts.md` (every spec) · persistence → `data-model.md` *(to author)* · REST boundary → `api-contract.md` *(to author)* · UNS/MQTT → `uns-contract.md` *(to author)* · boundary-change sync → `contract-sync.md` · auth/roles → `architecture-facts.md` § Security · UI → `design-guide.md` · packaging → `packaging.md` *(to author)*.

## Standing notes

- **Keep the instructions mirror in sync.** Canonical project instructions live in the Claude Project field; the git-tracked mirror is `docs/claude_project_instructions.md`. When the instructions change, rewrite the mirror in the same turn. If the two diverge, the Project copy wins. *(As of this bootstrap, two edits — the `api-contract.md` Tier-2 addition and the Rule 12 repoint — were made to the mirror and need mirroring into the Project field.)*
- **No repo doc is attached to the Claude Project.** Every living doc is read on demand from the repo so it can't go stale.
- **The four foundational architecture choices** (separate-service topology, server-side role enforcement, SQLAlchemy+Alembic dual-engine persistence, live-broker UNS) are recorded in `decision-log.md` as DEC-004–007 and enforced via `architecture-facts.md`. Don't relitigate from memory.
