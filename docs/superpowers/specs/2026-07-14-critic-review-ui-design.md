# Critic Review UI — Phase 1-UI Design (ShipTrack side of issue #100)

> **Status:** **Phase 1-UI delivered** (land + render, advisory). Implementation: `docs/superpowers/plans/2026-07-14-critic-review-ui.md` (Tasks 1–10).
> **Scope:** Land + render (advisory). Does NOT change confirmed/provisional routing (that stays on the gate's `autoApply`/`disposition`).
> **Repos:** ShipTrack + cobalt-queue Part A (`criticReview.conflicts[]`).

---

## 0. Implementer handoff (read FIRST — you have no prior context)

**This spans two repos. Ship Part A first (§12).**

**Part A — cobalt-queue** (`D:\cobalt-queue`, the agent side; Phase-1 already merged to `main`). Before extending, READ these to learn the EXACT current `criticReview` shape:
- `src/critic-agent/review/types.ts` — `CriticReview`, `ProposedChange`, `RiskFlag`, `Band`, `validateCriticReview`, `RISK` codes.
- `src/critic-agent/review/deterministic.ts` — the deterministic agent (default). `openpave.ts` (LLM), `review-io.ts` (parse + hard-stop clamp), `src/matcher/risk-signals.ts` (shared signals).
- `test/fixtures/critic-review.sample.json` — the golden payload + `test/critic-review-contract.test.ts` (the contract; regenerate the fixture when you change the schema).
- Your job here = add `criticReview.conflicts[]` (§8), populate it in `deterministic.ts` + `openpave` soul, extend `validateCriticReview`, regenerate the fixture, add tests.

**Part B — ShipTrack** (`D:\cobalt_track_system`): NestJS backend (kysely + **MSSQL**, not Postgres) + React 19 / Vite / Tailwind v4 frontend. The exact files to touch are enumerated in §5–§7 (from a repo scan) — trust those paths.
- **DB:** the running `mssql-2022` docker container on `localhost:1433`; connection via `SQL_SERVER_URL` in `backend/.env`. cobalt-queue owns the `queue` schema, ShipTrack owns `dbo`.
- **Run/verify:** `pnpm dev` (frontend `:5173`, which proxies `/api` → backend `:3000`); log in with the admin account. Migrations live in `backend/src/db/kysely-migrations/` and **MUST be registered in the static `backend/src/db/migrate-cli.ts` `MIGRATIONS` map** or they are silently skipped; run `pnpm --filter backend db:migrate`.
- **Gates:** `pnpm lint` (CI fails on eslint errors — run it before committing, not just tsc/tests), typecheck, tests.

**Guardrails:** everything additive + null-safe (legacy legs with no payload render exactly as today); do **NOT** change confirmed/provisional routing; keep the queue's server-side `confidence ASC` sort.

---

## 1. Goal

The queue POSTs a rich `criticReview` per decision; ShipTrack currently **drops it** (`CreateDecisionDto` has no such field). Make it land, then render it as **advisory triage** on the Review Queue: a confidence **band** + a **conflict-only** review card that shows, per contested field, the two candidate values, the AI's recommendation, and an editable override — so an operator resolves conflicts fast without wading through clean/missing fields.

**Band routing recap (unchanged):** only `low` + `medium` reach the queue; `high` is the quiet path. Display is **band-only** (no raw number). The queue is already sorted `confidence ASC` server-side — the number drives sort but is not shown.

---

## 2. The review card (per leg)

### 2.1 Collapsed (default in the list)
One compact row per leg: **`[band] 🚢 Customer · Booking · Route · Status · Action`** — the existing queue columns kept as-is (Customer + forwarder subline · Booking = bookingNo/soNo + PO-count subline · Route · Status badge · Approve/Dismiss), with a **band badge** (`Low`/`Medium`) prepended at the leading edge as the at-a-glance urgency signal. **The "Why review?" reason-bullet column is REMOVED** — the band replaces it; the detailed "why" (the per-field conflicts) lives only in the expanded card. No AI text, conflicts, or notes when collapsed. Approve/Dismiss stay available directly on the collapsed row (quick-resolve a clean or junk row without expanding).

### 2.2 Expanded
1. **AI comment** — `<band> · <short precise conflict type>`. Examples:
   - `Low · Two Bill-of-Lading numbers in one email`
   - `Medium · ETA disagrees with what's stored`
   - `Low · PO appears to belong to another shipment`

   The short type is derived from the top `riskFlag` (mapped code → short human label) or, if none, the dominant conflict field.
2. **Conflicts — and ONLY conflicts.** One row per contested field. **Missing fields, un-extracted fields, and clean/agreeing fields are NOT shown.** Each row:

   | Field | Existing | Proposed | Recommended | Resolution |
   |-------|----------|----------|-------------|------------|
   | ETA | `2026-07-20` <sub>(system)</sub> | `2026-07-23` <sub>(SO)</sub> | **Proposed** ✓ | `[2026-07-23]` |
   | HBL | — | `SE26061400005` <sub>(Final B/L)</sub> · `SE26061400006` <sub>(Draft B/L)</sub> | — (no safe pick) | `[____]` |

   Column labels are **Existing · Proposed · Recommended · Resolution** (replacing the earlier "Choice A / Choice B / AI recommends / Your value").
   - **Existing** = the value already stored on the shipment (source `system`); empty when nothing is on file yet.
   - **Proposed** = the incoming value(s) from the email, each tagged with its document source (`SO`, `Final B/L`, `Draft B/L`, …). In a document-vs-document conflict (nothing stored), **Existing** is `—` and **Proposed** lists both candidates with source tags.
   - **Recommended** highlights `Existing` or `Proposed` (or "no safe pick" when the critic won't choose).
   - **Resolution** is the editable field, pre-filled with the recommended value; the operator keeps it, picks the other candidate, or types a different value.
3. **Notes** (textarea) — mandatory when any value is changed (existing rule). Flows to the correction/AI-review feed.
4. **"Save changes & Approve"** — one button: applies the operator's values (locking edited fields, human-wins) and confirms the leg.

### 2.3 Collapse/expand behaviour
Collapsing hides the AI comment, conflicts, notes, and approve button — leaving only the strong-identity line (§2.1). Default collapsed in the list; expand to act. State is per-card, client-side.

---

## 3. Queue views + retention (#6)

Three tabs, all retained (legs are never deleted):
- **Active** — `reviewStatus = provisional` (the live work).
- **Rejected** — dismissed/rejected legs (view-only).
- **Approved** — confirmed legs whose card carries a resolved `criticReview` (history; view-only).

The queue list stays sorted by score (`confidence ASC`, then recency) — already server-side.

---

## 4. Data-integrity model (#7) — keep history clean

**Principle:** the **leg** is the living state; a **review task** is an append-only historical record that freezes once resolved.

1. **Resolved cards are read-only snapshots.** After Approve/Reject a card shows what the AI said, the human decision, and actor/timestamp — but no inputs and no approve button. To change a confirmed leg later, use the normal Shipment Detail edit (separately audited), never the review card. *(Primary fix.)*
2. **One open review per leg; new evidence supersedes.** A leg has at most one active review task. When a new email re-triggers review, the prior open task closes as `superseded` and a fresh task opens against current state.
3. **Optimistic-concurrency guard.** The active card carries the leg's version (`updatedAt`/rowversion). `Save & Approve` is rejected if the leg changed since load → reload with current values. *(Prevents clobbering newer data.)*
4. **Field-locks (existing).** Human corrections lock those fields (human-wins) so later auto-updates don't overwrite them.
5. **Append-only audit.** Every approve/correct/reject writes an immutable audit row (actor, ts, before→after); the Rejected/Approved views read these. History is never mutated.

---

## 5. Backend — accept + persist (needs a migration)

- **DTO** (`backend/src/decisions/dto.ts`): add `@IsOptional() @IsObject() criticReview?: object`. Loose validation — the queue already schema-validates; ShipTrack trusts-and-stores. Legacy callers omit it → null (unchanged).
- **Persist path:** `decisions.service.ts` → `ReconGroup` → `committer.service.ts` (`insertLeg` + amend `metaPatch`) → `shipment.repository.ts` `jsonifyLegColumns` stringifies it (same as `review_reasons`).
- **Migration** `backend/src/db/kysely-migrations/0012_shipment_critic_review.ts`: `ALTER TABLE shipments ADD critic_review nvarchar(max) NULL`. **⚠️ Register it in the static `backend/src/db/migrate-cli.ts` `MIGRATIONS` map** (folder scan is vitest-only; the CLI/prod path is a static registry — an unregistered migration is silently skipped).
- **Kysely types:** add `criticReview` to `db.generated.ts` (`string | null`) + curated overlay `db.ts` (`Json<CriticReview | null>`) so it parses to an object on read.
- **Concurrency:** ensure the leg row exposes a version for §4.3 (an `updatedAt` or SQL Server `rowversion`); the correct/confirm endpoints take it and guard.

## 6. Backend — expose on the read model

- **Detail** (`presentation/mappers/shipment.mapper.ts`): add `criticReview` to `ShipmentLegRow` + `UiShipment` + `toUiShipment` (pass-through object).
- **Queue list** (`presentation.service.ts` reviewQueue DTO): project a **compact** `{ band, summary, topConflictType }` extracted from the stored JSON (enough for the collapsed row + AI comment). `confidence` already selected + sorted.
- Read-only enforcement: the confirm/correct endpoints reject when `reviewStatus !== 'provisional'` (backs §4.1).

## 7. Frontend — render (React 19, Tailwind v4, react-query)

- **`components/ui/Badge.tsx`**: add `variant="confidence"` — band→token (`high`→success/ n/a in queue, `medium`→warning, `low`→critical), text `Low`/`Medium`. Band-only, no number.
- **`components/review/ReviewCard.tsx`** (new): the collapsible card (§2) — collapsed row (§2.1: band + Customer/Booking/Route/Status/Action) ↔ expanded AI comment + conflicts table + notes + Save&Approve. Read-only variant for resolved legs.
- **`components/review/ConflictRow.tsx`** (new): one conflict row with columns **Existing · Proposed · Recommended · Resolution** — Existing/Proposed candidate(s) with source tags, the Recommended column highlighted, and an editable **Resolution** input pre-filled with the recommendation.
- **`pages/ReviewQueuePage.tsx`**: keep the existing table; **prepend a band-badge column** and **remove the "Why review?" column** (§2.1) — retain Customer / Booking / Route / Status / Action, the category filter chips, and the bulk-dismiss bar; add the Active/Rejected/Approved tabs (§3). A row **expands to the conflict card** (§2.2) — inline accordion, or navigate to `ReviewShipmentPage` (keep the current row-click-to-detail).
- **`pages/ReviewShipmentPage.tsx`**: the expanded card is the primary content; wire Save&Approve to the existing `correct`/`confirm` endpoints with the version guard.
- **Types/hooks:** add `criticReview?` (+ compact fields) to `Shipment`/`ShipmentDetail`/`ReviewShipment`. Null-safe → legacy legs with no payload render exactly as today.

---

## 8. Cross-repo: queue payload addition (small, additive)

To render **Existing / Proposed / Recommended** for every conflict (incl. no-winner intra-email cases the current payload nulls), add an optional field to `criticReview` in cobalt-queue:

```ts
interface CriticConflict {
  field: string
  label: string
  candidates: { value: string; source: string; confidence?: 'low'|'medium'|'high' }[] // ≥2
  recommended: string | null   // AI's pick; null = no safe pick (needs human)
  rationale: string
}
// criticReview.conflicts?: CriticConflict[]
```

Populated by the deterministic agent (`src/critic-agent/review/deterministic.ts`) + openpave, from:
- `backendMismatches` (verdict `conflict`/`update`) → `candidates: [{value: backendValue, source:'System'}, {value: emailValue, source: emailType}]`, `recommended = emailValue` for `update`, `null` for `conflict`.
- Intra-email multi-value (`identifiers` with ≥2 co-current of one type) → candidates from those, `recommended = null`.

Additive, schema-versioned, regenerate the golden fixture, contract test. ShipTrack renders `criticReview.conflicts[]` directly.

*(Alternative if we want ShipTrack-only: reverse-derive the candidate values from `identifiers` + `conflicts` strings — messier, rejected as the default.)*

---

## 9. Testing

**Queue (payload addition):** unit-test `conflicts[]` derivation (supersede → recommended=email; no-winner → recommended=null); regenerate + contract-test the golden fixture.
**ShipTrack backend:** POST with `criticReview` persists + round-trips (decisions/committer test); migration applies on a throwaway DB and is registered; mapper surfaces detail + compact queue projection; confirm/correct reject on a non-provisional leg (§4.1) and on a stale version (§4.3).
**ShipTrack frontend:** `Badge` confidence variant; `ReviewCard` collapsed shows only strong ids, expanded shows AI comment + conflict-only rows; editing requires a note; read-only variant hides inputs; Active/Rejected/Approved tabs filter correctly.

---

## 10. Not changing
Routing (confirmed/provisional via `autoApply`/`disposition`), the queue sort (`confidence ASC`), field-locks, the audit/correction feed. All additive + null-safe.

---

## 11. Resolved decisions
1. **Queue payload addition (§8): YES.** The critic emits a structured `criticReview.conflicts[]`; ShipTrack renders it directly. This phase spans two repos (small queue change + ShipTrack UI).
2. **Queue views (§3): Active + Rejected + Approved**, all retained, resolved/rejected frozen read-only.
3. **Concurrency token (§4.3):** resolve during planning — reuse the leg's existing `updatedAt` if present; otherwise add a SQL Server `rowversion` (folds into migration `0012`).

## 12. Implementation shape (two coordinated parts)
- **Part A — cobalt-queue (small):** add `criticReview.conflicts[]` to the schema + deterministic/openpave agents; regenerate the golden fixture; contract test. Ships first so the payload carries candidates.
- **Part B — ShipTrack:** land+persist (migration `0012` + register) → read model → the collapsible conflict-only card + band badge + Active/Rejected/Approved views + the §4 data-integrity model.
