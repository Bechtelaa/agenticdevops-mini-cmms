# Task T-002 — Renderer scaffold (Electron + Vite + React + TS) and green CI

## 1. Background

Second code task. T-001 stood up the backend half (FastAPI `/health`, tooling clean); T-002 stands up the other half: the Electron/Vite/TypeScript/React renderer skeleton with a working test harness, plus `.github/workflows/ci.yml` so both toolchains are checked on every push/PR. This is the task that makes `docs/devops_pipeline.md`'s runbook true and resumes branch→PR→merge discipline (the workflow's step 10 — CI green, squash-merge — happens for real for the first time).

The renderer here is a **shell, not a product surface**: a window that opens and renders a placeholder. No backend calls, no auth, no domain UI — those come with their own tasks against `docs/functional-spec.md`.

Authority docs consulted: `docs/architecture-facts.md` (all specs; § Process/layer boundaries and § Security baseline apply), `docs/devops_pipeline.md` (the CI runbook `ci.yml` must implement exactly), `docs/development_workflow.md` (the loop this task completes). `docs/design-guide.md` governs UI work but a placeholder string has no design surface; it binds from the first real UI task. Rule 12: this task adds **no** endpoint and **no** cross-boundary types — `docs/api-contract.md` does not change.

## 2. What Already Exists (Do Not Rewrite)

- **`backend/`** — the complete T-001 backend (FastAPI app, tests, `requirements.txt`, `pyproject.toml`). **Do not modify anything under `backend/`.** CI *runs* its existing checks; it does not change them.
- **`docs/`, `checklists/`, `CLAUDE.md`, `.cursor/`, `README.md`** — workflow docs and agent configs. Do not modify, except the optional `README.md` dev-commands note listed in Files to Modify.
- **`.gitignore`** (root) — exists with Python + Node ignores. Extend it if the toolchain adds new artifact dirs (e.g. `.vite/`); don't rewrite it.
- There is no `package.json`, no renderer code, and no CI workflow — this task creates them.

## 3. What to Build

### 3a. Renderer/Electron scaffold (repo root)

An Electron + Vite + TypeScript + React skeleton, scaffolded on **electron-forge with its Vite template** as the base (forge is the recorded packaging path — `npm run make` later; packaging itself is out of scope here):

1. **`package.json`** (root) with at minimum these scripts: `dev` (or forge's `start`) launching Electron with Vite HMR; `build` — typecheck + bundle renderer and main (this is the project's standing build gate: `npm run build`); `lint` (eslint); `test` (vitest run); `typecheck` (`tsc --noEmit`).
2. **Electron main process** — window creation and app lifecycle **only** (DEC-004: main is never a data proxy; no IPC data channels, no domain logic). Security baseline from `docs/architecture-facts.md`: **context isolation ON, node integration OFF** in the BrowserWindow web preferences.
3. **Preload** — the template's minimal preload; expose nothing beyond what the template ships. No API bridges yet.
4. **Renderer** — React root rendering a single placeholder `App` component (e.g. the product name and a "renderer scaffold" line). No backend calls, no router, no state library, no domain UI.
5. **Test harness** — vitest + jsdom + React Testing Library, with **one passing test** that renders `App` and asserts its visible text. This establishes the renderer test pattern, not just a math-check.
6. **Lint/typecheck config** — eslint (flat config, typescript-eslint) and `tsconfig` such that bare `npm run lint` and `npm run typecheck` exit 0 over all shipped TS/TSX.

Target: Node 22 (LTS) — the human lead's local toolchain; CI pins it (below).

### 3b. CI workflow

**`.github/workflows/ci.yml`** implementing `docs/devops_pipeline.md`'s runbook **exactly** — that doc is the authority; if anything below seems to conflict with it, the runbook wins and flag the conflict to the PM:

- Triggers: every push to `main` and every pull request.
- **Permissions: read-only** (`contents: read`); never request a write token.
- Pinned runtimes: **Node 22, Python 3.12**.
- Backend job (working dir `backend/`): `pip install -r requirements.txt` (hard fail) → `ruff check .` (**soft** — advisory, does not fail the build) → `mypy .` (**soft**) → `pytest` (hard).
- Renderer job (repo root): `npm ci` (hard) → `tsc --noEmit` (hard) → `eslint` (hard) → `vitest run` (hard).
- Soft = the step visibly warns but the build stays green (e.g. `continue-on-error` with a clear step name). Do not silently skip them.
- No extra steps beyond the runbook's table (no build/package step in CI yet, no caching cleverness required).

## 4. Acceptance Criteria

Verifiable properties, from a clean checkout at repo root:

- [ ] `npm ci` succeeds.
- [ ] `npm run build` succeeds (typecheck + main/preload/renderer bundles produced).
- [ ] `npm run typecheck`, `npm run lint` both exit 0.
- [ ] `npm run test` passes with at least one test that renders the `App` component and asserts its visible content (jsdom).
- [ ] `npm run dev` (or `npm start`) opens an Electron window showing the placeholder — human verifies at runtime.
- [ ] The BrowserWindow is created with context isolation on and node integration off (readable in the main-process source).
- [ ] The Electron main process contains no IPC data channels, no HTTP calls, and no domain logic — lifecycle only.
- [ ] The renderer contains no backend calls, business logic, DB, or MQTT access (trivially true — keep it true).
- [ ] `ci.yml` matches the runbook: push-to-main + PR triggers, read-only permissions, Node 22 + Python 3.12 pinned, backend ruff/mypy soft, all other steps hard.
- [ ] Nothing under `backend/` changed; no doc changed except those listed below.
- [ ] **The PR for this branch goes green in actual GitHub CI** — the real acceptance gate for 3b.

## 5. Files to Modify

New unless noted:

- `package.json`, `package-lock.json` (root)
- Forge + Vite config: `forge.config.*`, `vite.main.config.*`, `vite.preload.config.*`, `vite.renderer.config.*` (names per template)
- `tsconfig.json` (and template-standard variants if the template splits them)
- eslint flat config (e.g. `eslint.config.mjs`)
- `index.html` + `src/` — Electron main, preload, renderer entry, `App` component, `App` test (template-standard layout; vitest config may live in a vite config or its own file)
- `.github/workflows/ci.yml`
- `.gitignore` (edit — only if new artifact dirs need ignoring)
- `README.md` (edit — optional: correct/add the dev + build commands if the scaffold's real commands differ from what it currently states)

## 6. Coding-Agent Instructions

Read this spec file (`docs/tasks/task_T-002_renderer-scaffold-ci.md`) in full before writing any code. Work on branch `T-002-renderer-scaffold-ci`.

Scaffold the Electron + Vite + TypeScript + React renderer at the repo root from electron-forge's Vite template: main process lifecycle-only with context isolation on / node integration off, a React placeholder `App`, and a vitest + jsdom + Testing Library harness with one passing render test; wire `npm run build|dev|lint|test|typecheck`. Then add `.github/workflows/ci.yml` implementing `docs/devops_pipeline.md`'s table exactly — push-to-main + PR, read-only permissions, Node 22 + Python 3.12, backend ruff/mypy soft, everything else hard. Do not touch `backend/`, do not add backend calls, IPC data channels, routing, or any domain UI, and do not add CI steps beyond the runbook's table.

Hard constraints decided by this spec:

- **Silencer decision:** no kept-but-unused symbols are expected. If the template ships one (e.g. an empty preload export) that trips lint, **stop and flag it to the PM** — do not choose a silencer or delete it on your own.
- **Rule 12:** N/A — no endpoint or cross-boundary type changes; `docs/api-contract.md` must not change.
- **User-facing impact:** None — no end users exist; the only doc allowed to reflect the new commands is `README.md` as listed.
- **CI authority:** `docs/devops_pipeline.md` wins over this spec's summary of it; flag any conflict rather than improvising.

Standing invariants: honor docs/architecture-facts.md and CLAUDE.md; the renderer holds no business logic, DB, or MQTT/UNS access; authorization is enforced server-side; keep contract docs (Rule 12) and user-docs (Rule 18) in the same commit; migrations run on both SQLite and Postgres; never read/write/delete data outside the app's own store; build with npm run build when done.
