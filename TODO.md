# ShipTrack — TODO / deferred work

Tags: `[queue]` = cobalt-queue · `[track]` = cobalt_track_system.
Context: see `C:\Users\John\.claude\plans\typed-wondering-moler.md` (merge refactor plan) and the
`merge-refactor-progress` memory. Checkpoints 1–2 + Phase 6 + Iterator→OpenCode are shipped.

## Agents & OpenPAVE
- [x] `[queue]` **LLM refiner for the Iterator — BUILT 2026-06-16 (not yet live-proven).** Was:
  `heuristicRefiner` only memorises correction *pairs* (a brittle lookup; a PROMOTE just means "no
  regression"). Now: `opencodeRefiner` (`src/iterator/refine-opencode.ts`) runs the `cobalt-refiner`
  OpenCode agent (`.opencode/cobalt-refiner.md`) to **generalise corrections into reusable RULES** in
  the soul (e.g. "consignee = the Consignee box, never the Shipper"), behind the same `Refiner`
  contract; `ITERATOR_REFINER=opencode`. Strips the heuristic block first, keeps entity value-mappings
  OUT (→ masters), only *proposes* (gate still promotes), falls back to heuristic on failure. 98 tests
  green. ⚠ Live AI pass needs a warm `opencode serve` (`OPENCODE_ATTACH=…`) — same cold-start caveat as
  the opencode critic.
- [ ] `[queue]` **OpenPAVE swap-in.** parser / matcher / critic / refiner all sit behind contracts
  (`ParserAgent`, `MatcherAgent`, `CriticAgent`, `Refiner`) with OpenCode adapters. Drop OpenPAVE in
  at each seam when ready — no rewiring.
- [ ] `[queue]` **Iterator trigger.** `run-iterator.ts` is a manual dev pass (not scheduled) and reads
  a sample `corrections.json`. Decide the real corrections source (a corrections store fed by human
  edits / field-locks) and whether/when to schedule a gated pass.

## Masters & validation
- [ ] `[track]` **Seed the curated masters facts.** `MACAU FUNG TAI → MACFUN` (and other approved
  `master_resolution` rows) are live DB-only; add them to the track-system seed so they survive a DB
  reset. (Memory: "move master_resolution seed into backend/seed.ts".)
- [ ] **Keep party/shipper fixes deterministic.** The reliable consignee fix is the `validate.ts`
  "consignee-resolves-to-a-vendor → replace with the customer's real consignee" rule + a masters
  alias — NOT parser-prompt edits (the LLM ignored the explicit per-customer guidance). Route new
  party-confusion cases to validate + masters.

## Tracking & review
- [ ] `[both]` **JOB-2026-0006 (optional, not a bug).** Stays provisional on a *genuine* two-booking-ref
  ambiguity (`B1261611448` 中外运订仓号 vs `FEL-GZ-OSA-2842`; `GZOSA2600021` vs `SOKLPO023605A`).
  Correct to flag for a human. OPTIONAL: route `中外运订仓号` → `booking_no` (not `so_no`) to separate
  them, if that convention is confirmed.
- [ ] `[queue]` **Full corpus re-parse.** Only set5/set6 + 4 emails were re-parsed with the current
  soul; set1 (FEL-GZ-OSA) evidence is older. Run one `PARSER=opencode` full re-parse (~2.4h) to refresh
  everything when convenient; re-validate (`revalidate.ts`, seconds) for validator/master changes.

## Tests & infra
- [ ] `[track]` **Integration tests** for the new paths: committer `writeIdentifiers` (history persist +
  idempotency on re-POST), the reconcile review gate (`score.ts` end-to-end), and the masters
  curator/approve endpoints.
- [ ] `[queue]` **`AZURE_API_KEY` gap.** The direct-Azure parser and `benchmark.ts` (parser recall) still
  need the key; matcher + Iterator now run via OpenCode. Either set the key, or add OpenCode paths to
  the remaining azure-only dev tools.
- [ ] `[track]` **Merge de-dup (Phase 4 follow-up).** The two merge copies (`critic/merge.ts` +
  `reconcile/merge.ts`) are hand-kept-in-sync with a "keep in sync" header. If drift becomes a risk,
  do the generated-copy + CI diff-guard from the plan.

## Shipped this session (reference)
supersede ≠ conflict + honest capped confidence · `shipment_identifiers` history + detail-page card ·
legacy reconcile gate · gold→tracking `track-bench --assert` · OpenCode matcher (no Azure key) ·
Phase 6 parser field-discipline (hbl/mbl + deterministic consignee fix) · Iterator scores via OpenCode
(gate 4 runs without Azure key) + per-email parse guard · refiner-boundary docs.
Result: provisional 6/9 → 2/9, confirmed 3 → 7; hbl/mbl recall 100%; 0 IDs lost to review_reasons-only.
