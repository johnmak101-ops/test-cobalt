# Critic Review — Phase 3: Calibration (is the band actually right?) · Design + Plan

> **Status:** design draft for build. Follows Phase 1 (queue #101), Phase 1-UI (#102/#137), Phase 2a shadow routing (#103/#138 — merged, `critic_routing_mode` defaults to `gate`).
> **Scope:** Capture **band vs human outcome** at review time and report it, so the Phase 2b flip is a data-driven decision instead of a guess.
> **Repos:** ShipTrack only (`D:\cobalt_track_system`). The queue is unchanged.

---

## 0. Implementer handoff (read FIRST)

**Why now (timing is the whole point):** today the **gate** routes, so **high-band legs still reach the Review Queue and still get a human verdict**. That verdict is the only ground truth for *"is `high` safe to auto-confirm?"* — the exact question Phase 2b turns on. **After 2b flips, high-band legs stop being reviewed and this label source disappears.** So Phase 3 must run *before* 2b, and should keep a sampled audit alive *after* it (§5).

**Key facts:**
- The leg carries the critic payload in `shipments.critic_review` (band at `confidence.band`) — added by migration `0012`.
- Human actions live in `backend/src/review/review.service.ts`: `confirm(...)` and `correct(...)` (both go through `loadLegForReview`, which enforces provisional + optimistic `expectedUpdatedAt`), plus the dismiss path.
- Migrations: `backend/src/db/kysely-migrations/` — **must be registered in the static `backend/src/db/migrate-cli.ts` `MIGRATIONS` map** (last is `0013_routing_shadow`; this adds `0014`).
- Precedents to copy: `routing-shadow.repository.ts` (append-only diagnostic log + `pruneOlderThan` retention), `routing-shadow-report.ts` (pure aggregate) + its `settings.controller` endpoint.
- Gates: `pnpm lint` (CI fails on eslint errors), typecheck, tests. **Worktrees lack the untracked `backend/.env`** → export a dummy `JWT_SECRET` (≥32 chars) for backend tests. Integration tests use the isolated `cobalt_test` DB (safe).

---

## 1. Goal

For every leg a human resolves, record **the band the critic gave it** and **what the human actually did**. Aggregate into a report that answers two questions:

1. **Is `high` safe to auto-confirm?** → of reviewed **high**-band legs, how many needed a correction? Near-zero ⇒ 2b is safe. This is *the* 2b gate number.
2. **Is the critic over-cautious?** → of **low/medium**-band legs, how many were approved with no edits? A high rate ⇒ the critic is manufacturing queue noise.

---

## 2. Why a snapshot (not a join)

`shipments.critic_review` holds the **latest** payload — a later email overwrites it. Joining "band on the leg now" to "a human decision from last week" would compare the wrong band. So **snapshot the band at the moment of the human action** into an append-only row. (Same shape as `routing_shadow`: diagnostic, append-only, pruned.)

## 3. Outcome taxonomy

| Outcome | Trigger | Means |
|---|---|---|
| `approved` | `confirm` (no field edits) | The leg was fine as-is — a low/medium band here was **over-cautious**. |
| `corrected` | `correct` with ≥1 changed field | There was a real problem — the band was **justified**; a `high` band here is a **miss** (the 2b risk). |
| `dismissed` | dismiss | Not a trackable shipment — portal echo / noise; low band **justified**. |

## 4. Design

### 4.1 Capture (migration `0014` + `critic_calibration`)
Table `critic_calibration` (append-only, mirrors `routing_shadow`'s conventions):
`{ id, shipment_id, decided_at, band nvarchar(10) NULL, outcome nvarchar(20) NOT NULL CHECK IN ('approved','corrected','dismissed'), corrected_field_count int NOT NULL DEFAULT 0, actor_id, reasons_json }`
Indexes on `decided_at`, `band`, `outcome`. **Register `0014` in `migrate-cli`.**

Write one row in `review.service.ts` at each human action:
- `confirm` → `outcome='approved'`, `corrected_field_count=0`
- `correct` → `outcome='corrected'`, `corrected_field_count = Object.keys(fields).length`
- dismiss → `outcome='dismissed'`
Read `band` from the leg's `critic_review.confidence.band` **at that moment** (null when the leg has no payload — legacy). **The write must never fail the human action** — wrap in try/catch + warn, exactly like the `routing_shadow` insert.

### 4.2 Retention
Reuse the `routing_shadow` pattern: `pruneOlderThan(days)` + opportunistic time-gated (≤1×/hour/process) fire-and-forget prune. **Window: 180 days** — longer than the shadow's 30, because calibration is a slow-accumulating statistical signal, not a transient diff.

### 4.3 Report
Pure aggregate (`critic-calibration-report.ts`, modelled on `routing-shadow-report.ts`) + an `EDITOR+` GET endpoint:
```
{ windowDays, total,
  byBand: { high|medium|low|unknown: { total, approved, corrected, dismissed, correctionRate } },
  /** THE 2b gate number: corrected / total among reviewed high-band legs */
  highBandCorrectionRate,
  /** over-caution signal: approved / total among low+medium */
  lowMediumApprovedRate,
  samples: [...]  // recent, incl. every high-band `corrected` (the misses worth eyeballing)
}
```

## 5. Keeping labels alive after 2b (design note, build in 2b)
Once band routing flips, high-band legs auto-confirm and stop producing verdicts. To avoid going blind, 2b should **sample** a small % of high-band auto-confirms into the queue anyway (an audit sample) so `highBandCorrectionRate` keeps updating. Out of scope here — but Phase 3's table is the sink it would feed.

## 6. Testing
- Capture: `confirm` → `approved`/0 fields; `correct` → `corrected` + field count; dismiss → `dismissed`; band snapshotted from the leg's payload; **null band for a legacy leg**; a calibration-write failure does **not** fail the human action (mock a throw).
- Snapshot correctness: change the leg's `critic_review` **after** the row is written → the row keeps the original band (proves §2).
- Report: per-band aggregation; `highBandCorrectionRate` maths; empty-window → zeros not NaN.
- Retention: `pruneOlderThan` drops rows outside the window.
- Integration (isolated `cobalt_test` DB), following `decisions.int.spec.ts`.

## 7. Acceptance
- Every confirm/correct/dismiss writes exactly one calibration row with the band the human actually saw.
- The report returns a **`highBandCorrectionRate`** — the single number that justifies or blocks the 2b flip — plus the over-caution rate for low/medium.
- No behavior change to review, routing, or the correction feed. Human actions never fail because of calibration.

## 8. Open items
- Does `dismiss` carry an actor + reach the same service path as confirm/correct? (Confirm during build; capture may need wiring in the dismiss handler.)
- Whether to also record *which* fields were corrected (field-level calibration) — richer critic tuning, but the queue's existing correction feed ([[correction-driven-learning]] / ADR-0002) may already cover it. Start with the count.
- Report window default (30d vs 90d) — the signal is slow; suggest 90d default, configurable via `?windowDays=`.
