# Tabular extraction — one-shot kill design ("table truth")

**Date:** 2026-07-18
**Status:** PR-T (track P4+P5) implemented on `feat/table-truth-one-shot`; queue PR-Q1/Q2 + soul promote still pending
**Repos:** cobalt-queue (P1, P2, P3, P6) + cobalt-shiptrack (P4, P5)
**Trigger case:** IZAC booking SOKLPO024608A — POs 12199/12201/12204/12206/12208 all showing the same 5-item style list; `PO 12204: item_style_no conflict …(5-item list A) vs (5-item list B)… — verify`

## Problem

### The instance (fully evidenced)

Source docs pair each PO with exactly ONE item (`PO NO.: 12204` ⏎ `ITEM NO.: PUH26BHALE - 4,035 PCS`), but the UI shows all 5 styles on every PO, and PO 12206 (brand LE FIL D'OR) shows IZAC's styles. Causal chain, each link verified against the local DB / repos:

1. **Origin (queue):** the live parser soul (`queue.prompt_version` id=1002) has **no anti-broadcast rule** for `item_style_no` — its field row says just "comma-separated pairs", and the soul's general instruction "booking-level fields are repeated identically on every PO record" invites stamping the aggregate. The rule already exists **only in the qwen variant** (`prompts/cobalt-parser-qwen.md` rule 3: "NO BROADCASTING… NEVER copy one row's style list onto every record"). Result: for the SHIPPING ORDER layout (all 5 `PO NO./ITEM NO.` pairs inside ONE merged "Description of Goods" cell), 2 of 5 messages parsed as per-PO broadcasts of the full list; the other 3 parsed correct singles. Both correct and broadcast records coexist in `parsed_record`.
2. **Amplifier (track):** `resolvePoEnrichment` picks `item_style_no` newest-first with **no specificity preference** — a broadcast 5-list can beat the PO's own correct single on the tiebreak (and did, at the 03:07:14 commit). `conflictingValues`' subset-drop then **hides the correct single** from the conflict flag (it is a subset of the 5-list), so the flag shows broadcast-vs-broadcast (the `B0NNIE`/`BONNIE` variants — the `0` is genuinely in the source doc) and never the truth.
3. **Staleness (track):** the correct `PUH26BHALE` later became the newest record (03:39:25), but nothing re-commits — `purchase_orders` row frozen at 03:07:14 with the broadcast.

### The class (archaeology)

12+ queue commits have each fixed one tabular-extraction symptom: #92 deterministic per-PO xlsx AoA extraction (`table-extract.ts`), #115 packing-list expand, #197/#198 html body row-truth + tableFastPath, #199 qty invariant + observability, #200 template bleed, #201 golden packing fixture, #204/#211 packing identity, #207 empty-cell realign, plus track-side qty-broadcast/brand-leak guards. The machinery is good but **shape-scoped**: `table-extract.ts` requires a columnar grid (≥2 cells/row, ≥3 rows, LLM-mapped `po_col`/`item_style_col`). Input shapes with no grid fall through to free-form LLM parse — unguarded, variance-prone.

### Input-shape inventory (what "one shot" must cover)

| Shape | Example | Today | This spec |
|---|---|---|---|
| Columnar grid (xlsx/docx/OCR-PDF/body table) | packing list with PO column | `table-extract.ts` — handled, iterated | lock with corpus (P3) |
| **Labeled pair-runs** (label:value repetitions, incl. inside ONE merged cell) | `PO NO.: X / ITEM NO.: Y - N PCS` ×5 | **falls through to LLM → broadcast variance** | **P1 expander + P2 soul** |
| Email inline images (HTML body) | pasted screenshot in reply | `per-image-extract` — handled | corpus (P3) |
| **Images embedded in office files** (`xl/media/*`, `word/media/*`) | booking form pasted as picture into xlsx | **silently dropped by `convertXlsx`** (cell grid only) → null/mispaired fields, empty-cargo class | **P6 routing** |
| Text in drawing shapes/textboxes | (checked: IZAC files have none carrying data) | dropped | out of scope, noted |

Scan evidence (the real files): IZAC Booking Form xlsx = 1 embedded image → the IZAC **logo** (10 KB, header anchor, no data). SHIPPING ORDER xlsx = 0 images; drawing XML is empty checkbox anchors. So the trigger case involved no images — but the P6 hole is real for other senders.

## Goals

1. Deterministically extract per-PO pairs from labeled pair-run layouts (kill the origin for this shape).
2. Keep the soul honest for whatever still reaches free-form parse (anti-broadcast rule in the LIVE soul, not just qwen).
3. Lock the whole class with a golden corpus that gates every future soul promote.
4. Make track tolerant of residual variance (specific-beats-superset; truthful conflict flags).
5. Repair the stored damage (backfill) and land the requested UI change (collapsed PO card).
6. Stop dropping images embedded in office attachments; OCR them with the existing qwen+tiling path at correct fidelity.

## Non-goals

- No queue `validate.ts`/`merge.ts` judgment guard for styles (user-declined; frozen-code shadow per the soul-iteration principle). P1 is an EXTRACTOR (structure recovery), the established `table-extract.ts` pattern — not a judgment guard.
- Shipment-LEVEL `item_style_no` (the leg's 5-style union) stays — genuinely correct.
- Drawing-textbox text extraction (no evidence of data-bearing textboxes yet; revisit if the corpus ever gains one).
- No `convertXlsx` grid-format changes (the AoA flatten already preserves what P1 needs) — avoids mass renormalize.

---

## P1 — Queue: deterministic pair-run expander (centerpiece)

New `src/parser/pair-extract.ts` beside `table-extract.ts`, same split of labor (code = structural expansion; LLM untouched):

- **Detection:** scan the flattened unit text for **repeated label pairs**: a PO label (`PO NO.` / `PO#` / `P0 NO` / `订单号` / `PO :`) each followed (within a bounded token window) by an item label (`ITEM NO.` / `ITEM#` / `款号` / `STYLE NO.`) — ≥2 repetitions of the pattern = a pair-run. Values: PO = the existing smart-strip PO token rules; item = token after the item label, optional trailing `- N,NNN PCS` captured as `pcs`.
- **Single-line tolerance (critical):** `convertXlsx` collapses intra-cell newlines to spaces (`sanitize`), so a merged cell arrives as ONE long line. The matcher must run over running text (global regex with ordered captures), not line-by-line.
- **Emission & precedence:** emit per-PO `{po_no, item_style_no, pcs}`; for POs covered by a pair-run, the expander's `item_style_no` **supersedes** the LLM record's style for that PO (same integration shape as packing-expand #115 / tableFastPath — deterministic wins where it fired; LLM keeps every other field). Never invent POs not present in the run.
- **Interleaved prose:** description lines between pairs (`MEN 60% COTTON…`) are skipped by the label-anchored pattern; they must not break run continuity (the IZAC run has descriptions between pair groups).
- **Ambiguity refusal:** if a candidate run yields duplicate POs with DIFFERENT items, or a PO label with no item within the window, the expander refuses that run entirely (falls back to LLM) — refusal is logged. Deterministic code must never guess.
- **Observability:** counter + per-message log line (`pair-extract: N pairs, M superseded`), mirroring #199's table-expand observability.

## P2 — Queue: soul rule (live soul, not just qwen)

- Edit the seed `prompts/cobalt-parser.md`: port qwen rule 3 — "**NO BROADCASTING.** Each record carries ONLY its own PO's `item_style_no` and per-line values; when a document interleaves `PO NO./ITEM NO.` pairs, pair by adjacency; NEVER copy one row's or the aggregate style list onto every record. (`qty` booking-total repetition stays the deliberate exception.)" Tighten the `item_style_no` field-table row from "comma-separated pairs" to say per-PO.
- Promote via the established ops flow (`_ops-promote-soul-file.ts`, as PR #109 did) → new `queue.prompt_version` row. **Promote only after P3's A/B gate passes.**

## P3 — Queue: golden table-truth corpus (the "never again" lock)

One fixture suite (extends the Phase-4 golden-fixture pattern, runs in vitest CI) + `compare-runs` A/B as the gate before ANY soul promote:

| Fixture | Asserts |
|---|---|
| IZAC shipping-order pair-block (real text) | per-PO singles; 12204→PUH26BHALE; no broadcast |
| IZAC booking-form xlsx (real file) | logo image skipped/harmless; per-PO cells win |
| 收仓数据 broadcast-total email | one total, not per-PO qty stamps |
| CVP 货号 item-list (#119) | item numbers refused as customer POs |
| Packing lists (#115/#204 cases) | row expansion + identity intact |
| Expeditors table (existing skill test) | unchanged behavior |
| Empty-cell POL/POD sheet (#207 case) | column alignment preserved |
| Mixed xlsx: cells + data-bearing screenshot (synthesized; lands with PR-Q2/P6) | P6: image OCR'd via tiled qwen; fields land; image-derived value loses fidelity tie to cell text |

Every future table bug adds its fixture here as part of its fix — the suite is the class's regression lock.

## P4 — Track: selection hardening + truthful flags

- **T1a specificity:** in `resolvePoEnrichment`, choose the PO's `item_style_no` by **fewest comma-tokens first, newest among ties** — a specific single beats a superset list regardless of arrival order. (Within a PO's evidence group the singles are that PO's own pairing; the OCR-family upgrade (#124) still applies among the specific values.) Known edge, accepted: records `A` vs genuine `A,B` → picks `A`; visible and human-editable, and `conflictingValues` already treats narrowing as non-conflict.
- **T1b broadcast flag (detection-only, de-correction compliant):** when a PO's ONLY stated styles are multi-token lists identical across ≥3 POs of the same message (per-message scope, mirroring the qty broadcast guard), keep the value and add review reason `PO <po>: item/style looks copied across all <N> POs of this email — verify per-PO`.
- **T2 conflict message:** replace the full-list dump with `summarizeStyleConflict(competing, kept)` — tokenize, show the **symmetric difference** only, cap 2 diffs + `+N more`, always name the kept value: `PO 12204: item/style "B0NNIE" vs "BONNIE" (kept PUH26BHALE) — verify`. Update `review-reasons.ts` / `needs-attention.ts` humanize+dedupe patterns in the same PR (they match on the current wording); `isRecomputedDataIssueReason` must recognize BOTH old and new formats so stale reasons still get pruned on recompute.

## P5 — Track: backfill + UI collapse

- **Backfill script** (`backend/scripts/`, manual, dry-run default → `--apply`): find shipments where ≥2 linked POs share an identical multi-token `item_style_no` (broadcast signature); re-run post-T1 enrichment over stored `parsed_record` evidence; update `purchase_orders.item_style_no`, refresh the leg's recomputed reason strings via the existing recompute path, write audit rows (`sourceType:'system'`, note names this spec). Deterministic re-derive — **no re-parse, no queue involvement**. Never against the demo DB. Acceptance: the 5 IZAC POs each end with their own single style; 12206 no longer shows IZAC styles.
- **UI collapse (user request):** Customer Purchase Orders card renders **collapsed by default** — header row (`Customer Purchase Orders · N POs · shipment total`) + chevron; click toggles the table. Row-click → PO page behavior unchanged when expanded. Pure frontend state; no persistence.

## P6 — Queue: embedded-media OCR routing

- **Extract:** in `convertXlsx` (and docx equivalent — same zip layout), lift `xl/media/*` / `word/media/*` into additional `NormalizedPart { kind:'image' }`. Filter: skip logo-like images (small byte size AND small anchor extent per the drawing XML AND header-row anchor — the real IZAC logo validates this); sha-dedupe repeats. When unsure, OCR anyway — cheap, and fidelity handles weight.
- **OCR:** parts flow through the EXISTING image path — `ocrOne` qwen-first + paddle glyph arbiter, **with the existing sliding-window tiling** (`planTiles`/`mergeTileTexts` #186; `cropAllTiles` qwen-side). No new OCR machinery; this is pure routing.
- **Provenance-true fidelity:** embedded-image parts carry `sourceKind:'image'` in evidence attachment meta so `style-source-reconcile` ranks them as image (2), never inheriting the office container's 4 — a screenshot inside an xlsx must not outrank clean cell text or a PDF.
- **Renormalize note:** converter change ⇒ already-ingested mixed-xlsx messages only benefit via re-normalize from `raw_bytes` (known gotcha: reparse ≠ renormalize). On-demand renormalize for flagged messages only; no bulk re-run. The IZAC backfill (P5) does not need it.
- **Hazard fix-along:** normalize unicode spaces (`\xa0` et al.) before any filename-based regex (fidelity ranking, attachment kind detection) — real IZAC filenames carry `\xa0` and dodge plain-space patterns.

## Testing

- **Queue:** `pair-extract.spec` (detection incl. single-line flatten, interleaved prose, pcs capture, ambiguity refusal, supersede semantics); P3 corpus in CI; P6 unit tests (zip extraction, logo filter, provenance kind) + the mixed-xlsx fixture; A/B `compare-runs` before soul promote.
- **Track:** `po-enrichment.spec` — single-beats-superset even when broadcast is newest; broadcast-only → T1b flag; genuine multi-style PO unchanged; narrowing edge pinned. Reconciler spec — T2 message format + old/new reason-format pruning. Frontend — updated pattern tests + collapsed-card render/toggle test.
- **e2e:** backfill dry-run then apply on the local DB; UI screenshot: each IZAC PO shows its own style; collapsed card on landing.

## Definition of done ("kill confirmed")

1. P3 corpus green in CI; A/B gate wired into the soul-promote runbook.
2. Re-parsing the IZAC shipping-order message yields per-PO singles **deterministically** (P1 fired — not LLM luck).
3. Live soul carries the anti-broadcast rule (new version promoted, note references this spec).
4. Track suite green; T1/T2 behavior pinned by tests.
5. Backfill applied: 12199→PUH26BAINE · 12201→PUH26BENJI · 12204→PUH26BHALE · 12206→its own single (BONNIE/B0NNIE per glyph consensus — the 0/O variant differs between the two source docs) · 12208→BOH26YACOTE; stale conflict reasons pruned.
6. PO card collapsed by default.
7. Embedded-image xlsx fixture passes end-to-end (extract → tiled qwen OCR → fields, at image fidelity).

## Delivery / sequencing

1. **PR-T (cobalt-shiptrack):** P4 (T1a/T1b/T2) + P5 script + UI collapse + tests. Independent; merge first — hardens against today's data.
2. **Backfill run** (after PR-T): dry-run → apply → e2e screenshot.
3. **PR-Q1 (cobalt-queue):** P1 expander + its spec + P3 corpus (fixtures + CI wiring; all except the mixed-xlsx fixture).
4. **PR-Q2 (cobalt-queue):** P6 embedded-media routing + the mixed-xlsx corpus fixture.
5. **Soul promote** (after PR-Q1's corpus + A/B gate green): P2 seed edit → ops promote.

TDD throughout (red → green per unit); CI note: GitHub Actions is billing-blocked, so merges verify on local suites + e2e, per current practice.
