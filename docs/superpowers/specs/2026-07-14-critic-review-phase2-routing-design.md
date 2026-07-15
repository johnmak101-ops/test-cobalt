# Critic Review — Phase 2: Band-driven routing (shadow-first) · Design + Plan

> **Status:** design draft for build. Follows Phase 1-UI (merged: queue #102, ShipTrack #137).
> **Scope:** Let the critic **band** drive queue membership — but **shadow-first**: compute band-routing alongside today's gate-routing, log every leg where they'd differ, review on real volume, then flip via a setting. **No production behavior change until the flip.**
> **Repos:** ShipTrack (`D:\cobalt_track_system`, most of it) + a small additive field in cobalt-queue.

---

## 0. Implementer handoff (read FIRST)

**Product goal:** keep the Review Queue small by auto-confirming clean, high-confidence volume — without ceding safety. Do it in two steps: **2a** ships everything in *shadow* (zero behavior change), **2b** is a config flip after you've reviewed the shadow diff on real data.

**Load-bearing fact you can rely on:** the queue's deterministic critic **clamps `band` to `low` whenever a §2 hard stop fires** (multi-strong-id, ambiguous match, backend conflict, PO reassign, portal echo). Therefore **`band === 'high'` already guarantees "no hard stop."** Band-routing `high → auto-confirm` is inherently hard-stop-safe; still enforce it server-side as belt-and-suspenders.

**Current routing (baseline — do not break it):**
- Queue `runMatcher` (`D:\cobalt-queue\src\matcher\runner.ts`) POSTs `{…, disposition, autoApply, confidence, criticReview}`.
- ShipTrack routes `confirmed`/`provisional`/`skip` on the gate's `disposition`/`autoApply` in `backend/src/decisions/decisions.service.ts` (the `reviewStatus` ternary, ~`:58-65`). The band is currently **advisory only** (renders the card + sorts `confidence ASC`).
- Settings pattern to copy for the flip flag: `backend/src/settings/settings.service.ts` (`THRESHOLD_KEY` / `confidenceThreshold`) + `settings.controller.ts`.
- Migrations: `backend/src/db/kysely-migrations/` — **must be registered in the static `backend/src/db/migrate-cli.ts` `MIGRATIONS` map** (last was `0012`; this adds `0013`).
- Gates: `pnpm lint` (CI fails on eslint errors), typecheck, `pnpm --filter backend test` / `--filter frontend test`. **Worktrees lack the untracked `backend/.env`** → export a dummy `JWT_SECRET` (≥32 chars) when running backend tests in a worktree.

---

## 1. The routing rule

For an actionable decision that carries a `criticReview`:

```
bandRouting =
  'skip'    if the gate disposition is 'skip'         // not actionable — band never overrides this
  'auto'    if band === 'high' AND no hard-stop flag   // clean + high confidence → auto-confirm (out of queue)
  'review'  otherwise                                  // low / medium → provisional (in queue)
```

- `gateRouting` = today's outcome (`confirmed`/`provisional`/`skip` from `autoApply`/`disposition`).
- `bandRouting → confirmed` for `'auto'`, `provisional` for `'review'`, `skip` for `'skip'`.
- Legacy legs with **no** `criticReview` → fall back to `gateRouting` (band-routing not applicable).

---

## 2. Design

### Part A — cobalt-queue: emit `recommendedRouting` (small, additive)
The gate's `disposition`/`autoApply` already come from the queue; the band routing recommendation should too (one source of truth). Add an optional field to the decision:

- `Decision.recommendedRouting?: 'auto' | 'review' | 'skip'` (`src/matcher/types.ts`).
- Compute in `runMatcher` (`src/matcher/runner.ts`) from the rule in §1: `skip` if `disposition==='skip'`; else `'auto'` if `review.confidence.band === 'high' && !hardStops(riskSignals(draft))`; else `'review'`.
- Additive; legacy consumers ignore it. Add to the contract test + golden fixture.

*(Alternative if we want ShipTrack-only: derive `bandRouting` from `criticReview.confidence.band` + absence of hard-stop-code risk flags. The queue-emit is cleaner — routing logic stays where the gate + critic live. Recommend queue-emit.)*

### Part B — ShipTrack: shadow + flip
1. **Compute both routings at ingest** (`decisions.service.ts`, at the existing `reviewStatus` block): keep `gateRouting` as-is; compute `bandRouting` from `dto.recommendedRouting` (fallback: derive from `criticReview.band`).
2. **Record the shadow diff** — migration `0013` adds a `routing_shadow` table (registered in `migrate-cli`): `{ id, shipment_id, ingested_at, gate_routing, band_routing, band, differs, reasons_json }`. Write a row on **every** ingest that carries a `criticReview` (or at least when `gateRouting !== bandRouting`). Cheap, append-only, queryable.
3. **Shadow-diff report** — `GET /api/settings/routing-shadow` (or an admin page): counts over a window — total, would-flip, split `auto→review` vs `review→auto`, plus a sample list of legs. **This is the "review on real volume" surface** an admin looks at before flipping.
4. **Flip flag** — a setting `critic_routing_mode: 'gate' (default) | 'band'` (copy the `confidenceThreshold` settings pattern; admin-only setter). When `'band'`, `reviewStatus` uses `bandRouting`; when `'gate'` (default), unchanged. **Hard stops enforced server-side** even under `'band'` (never `confirmed` if a hard-stop-code risk flag is present).
5. **Audit** — under `'band'` mode, record on the leg *why* it routed (band auto-confirmed / band held for review) for the change history.

---

## 3. Safety / guardrails
- **Default `'gate'` → zero behavior change.** 2a is invisible to ops.
- Hard stops enforced server-side under `'band'` mode (defence in depth over the queue's clamp).
- `skip` stays `skip`; legacy (no `criticReview`) → gate routing.
- **Instantly reversible:** flip the setting back to `'gate'`.
- The shadow record is written in **both** modes, so you always see how the *other* model would route (ongoing insight + reversibility confidence).

---

## 4. Phased delivery
- **Phase 2a (this build):** Part A (queue `recommendedRouting`) + Part B steps 1–3 + the flag plumbing (step 4) **defaulting to `'gate'`**. Ships in **shadow** — no routing change. Acceptance below.
- **Phase 2b (config, later):** after reviewing the shadow-diff report on real volume, flip `critic_routing_mode` to `'band'` (a setting change, not a deploy). Optionally stage it (e.g. auto-confirm only for a subset of senders/customers first).

---

## 5. Testing
- **Queue:** `recommendedRouting` derivation — `high & no hard-stop → 'auto'`; any hard stop → `'review'`; `disposition:'skip' → 'skip'`; medium/low → `'review'`. Contract test + regenerate the golden fixture.
- **ShipTrack backend:** shadow row written on ingest (int test, incl. a would-flip case); report aggregation (unit); `critic_routing_mode='band'` routes on `bandRouting` while `'gate'` is unchanged (unit, both modes); hard-stop-code present under `'band'` still → `provisional` (safety test); legacy leg (no criticReview) → gate routing.
- **Shadow proof:** with default `'gate'`, `reviewStatus` for a fixture batch is **identical** to pre-change (the no-behavior-change guarantee).

---

## 6. Acceptance
- In shadow (default `'gate'`): routing outcomes **unchanged** vs today; the `routing_shadow` table + report populate with real diffs.
- A clean high-band lifecycle leg would show `bandRouting='auto'` (would leave the queue); every hard-stop leg shows `'review'`; `skip` stays `skip`.
- Flipping `critic_routing_mode` is a single, reversible setting; hard stops still hold under `'band'`.

---

## 7. Open items (decide during build)
- Shadow storage: dedicated `routing_shadow` table (recommended — queryable report) vs columns on the leg vs structured logs.
- Report window/retention for shadow rows (e.g. keep 30 days; the decision is data-gathering, not permanent).
- Whether 2b's flip should be global or staged (per sender/customer) — a 2b-time call informed by the shadow diff.
