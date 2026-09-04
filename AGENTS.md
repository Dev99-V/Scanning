# AGENTS.md — PDA Scan & Reconciliation

> Mono repo (`/backend` + `/frontend`, Phase 1+). Full spec in `Plan.md`, tech constraints in `Skills.md`, process in `Rules.md`, QC loop protocol in `QC_LOOP.md`. This file is the index — details stay in those files.

## QC loop (active — see QC_LOOP.md + state.json:qc_loop)

- Builder codes phase → Task subagent (`general`) runs that phase's gate script independently → FAIL: fix + log Learning.md + re-QC (attempts+1) → PASS: close phase, auto-advance. No user prompts mid-loop; circuit breaker = 5 attempts/gate → hand over with evidence.
- Every phase needs one deterministic gate script printing `RESULT: QC_PHASEn PASS/FAIL` (exit 0 only on PASS). Backend gates: `backend/supabase/tests/qc_phaseN.sh`; frontend: `frontend/tests/qc_phaseN.sh`.

## Session start (mandatory order)

1. Read `state.json` first (phase, locked decisions, `pending_contract_changes`).
2. Then `Plan.md` → `Skills.md` → `Rules.md`. Map task to a `Plan.md` §9 milestone + a `Skills.md` A/B/C/D branch before writing code.
3. Check `Learning.md` before fixing any bug; append a verified entry after fixing.
4. After each unit of work, update `state.json` progress before ending the session.
5. Business prose/commits in Vietnamese (or bilingual); code identifiers in English.

## Hard constraints (from Rules.md — violations stop work)

- No invented APIs/schema/features beyond `Plan.md` + sample data + official docs. If unsure, stop and ask — never placeholder-and-continue.
- Never report Done without evidence: test log, real command/query output, or row-count match (e.g. import == 2721 data rows). "Logic looks right" is not evidence.
- Schema changes only via versioned `supabase/migrations/*.sql`; never direct dashboard edits on prod.
- Never disable RLS for tests; never put `SUPABASE_SERVICE_ROLE_KEY` in frontend bundle (Edge Functions/CI only).
- Schema/contract change affecting the other side (backend ↔ frontend) → record in `state.json:pending_contract_changes` before implementing.

## Undecided — confirm before scaffolding (see state.json)

`repo_split_strategy` (A: two repos vs B: mono `/backend`+`/frontend`), `concurrency_strategy` (`db_row_lock_rpc` vs `explicit_queue_table`), `frontend_hosting_target`, and the 2721-row import count are all still `null`/pending. Record the choice in `state.json` first; for concurrency also log the rationale in `Learning.md`. Never half-mix both concurrency approaches.

## Data quirks (`Stock Balance With Batch.xlsx`, sheet `Stock Balance With Batch`)

- Real header is row 5; skip rows 1–4 (metadata/junk — do not interpret C3).
- `BATCH` (col D, 12-char text) = Tag ID = sole lookup key. Do not synthesize UUIDs.
- `TRIM()` `Stock Code` (A) and `BIN` (E) on import (trailing padding) but keep a raw column for audit; `BATCH`/`BIN`/codes stay `text`, never numeric.
- One `Stock Code` → many `BATCH` across `Warehouse`/`BIN`; upsert on `batch_id` conflict.

## Backend / DB rules

- Tables: `reference_stock` (PK `batch_id`), `scanned_data` (no hard unique on `batch_id` — duplicates are business logic, not a constraint), `scan_audit_log` (`insert|append|relocate|edit|delete`). Full DDL + indexes in `Plan.md` §3; B-tree on `batch_id` is enough.
- All compare + `SELECT … FOR UPDATE` lock logic lives in ONE `plpgsql` RPC called via `supabase.rpc()` inside a single transaction. Edge Functions (`import-reference`, `scan-submit`, `resolve-duplicate`, Deno/TS) must not split comparison into JS.
- Statuses: `pending|ok|qty_mismatch|bin_mismatch|not_in_reference|duplicate`; `resolution`: `appended|relocated|null`. Missing reference still saves as `not_in_reference` (manual adds allowed).
- Duplicate flow: non-blocking toast/modal with exactly `Ghi thêm` (new row, `appended`, warning persists) vs `Đổi vị trí` (overwrite old `bin`, `relocated`) + inline row warning. Both write `scan_audit_log`.
- Realtime: frontend subscribes `postgres_changes` on `scanned_data` (enable via `alter publication supabase_realtime add table scanned_data`); no business-data caching in client, no `localStorage` for scan data (UI state only).
- Edge Function contract: `{ ok, data?, error?: { code, message } }` — frontend branches on `error.code`. Breaking changes via versioned path (`/scan-submit-v2`), never silent behavior change.

## Frontend / PDA quirks

- `scantag.html` is UX reference only (2 modes: Bin → Tag ID, auto-switch to Tag after Bin scan, `WAITING...` guard). Rewrite as typed React components (`PdaScanPanel`, `ManualEntryForm`, `ReconciliationTable`, `ReferenceDataTable`, `DuplicateAlertToast`) — do not copy the vanilla-DOM script.
- Stack: React 18+ `strict:true`, Vite, Tailwind, Supabase JS SDK. No Redux/global cache for scan data.
- PDA wedge = fast typing + Enter: handle `onKeyDown/Enter`, keep input auto-focused, no debounce.
- Reconciliation table (Table 1) shows scanned qty/bin vs system qty/bin but NEVER re-displays source Tag IDs; Table 2 is read-only reference with warehouse/bin filter. Toast only for duplicates; qty/bin warnings are inline.
- Excel export (SheetJS `xlsx`): force text (`z='@'` + leading `'`) so leading zeros survive — same as prototype.

## Toolchain (no scaffold yet — don't assume)

- No `package.json`, `supabase/`, or workflows exist. Once scaffolded: frontend verify = `tsc --noEmit` → lint → `vitest` → `vite build`; backend verify = migration/RPC tests incl. 2-concurrent-same-`batch_id` race test.
- CI (to be created): only `main` deploys prod; backend `supabase db push` + `functions deploy` via `SUPABASE_ACCESS_TOKEN`/`SUPABASE_PROJECT_ID` secrets; frontend deploy target must be confirmed first. No secrets committed; `VITE_*` via GitHub Secrets per env.
