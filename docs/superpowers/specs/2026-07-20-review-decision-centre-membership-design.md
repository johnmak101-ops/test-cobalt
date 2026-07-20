# Review as a decision centre — queue membership + admin Mesh report

**Date:** 2026-07-20  
**Status:** Approved (brainstorm) — Approach 1 (source classification) + shadow rollout  
**Surface:** cobalt-queue `review-gate.ts` (membership) · ShipTrack Review Queue rows / shadow lane · NEW `/admin/mesh-misses`  
**Related:** `2026-07-17-review-needs-attention-ux-design.md`, `2026-07-19-review-decision-desk-design.md`, `2026-07-20-review-desk-decision-vs-fyi-design.md` (rule A; this spec supersedes its "presentation filter only" non-goal), `D:\cobalt-queue\docs\designs\document-parse-flow-enhancement.md` (GATE_CODES/desk registry — this spec generalizes it)

---

## 1. Problem

Rule A hides FYI *lines* on Review, but the **legs still queue**. A leg whose only reasons are FYI-class (soft merge notes force review at `review-gate.ts:71-74`; mesh-party notes) occupies the queue, the operator opens it, and there is nothing to decide. Separately, Mesh master misses (vendors / forwarders seen in mail but absent from Mesh) have **no destination**: they nag per-shipment in Review, where the operator cannot fix them, instead of reaching the admin who can fix them once.

### Product principle (locked, this session)

**The Review queue is an operator decision centre.** Anything with no decision to make does not enter the queue. FYI stays on shipment detail. Master misses flow to an **admin worklist** whose end state is "entered in Mesh" — fixing the master once removes the noise class at its source.

## 2. Decisions taken (brainstorm 2026-07-20)

| # | Question | Decision |
|---|----------|----------|
| Q1 | Core failure | Review = decision centre; no-decision items out; FYI on detail |
| Q2 | Depth | **A — membership changes**: FYI-only + clean legs auto-commit, never queue |
| Q3 | band = low + FYI-only | **Stays queued** as a decision item `ai_confidence_low` ("AI 信心低 — 驗證拆解"); only band ≥ medium auto-commits under the new rule |
| Q4 | Admin report | Track admin page + ack-to-clear + 30-day window + xlsx/csv export (no Mesh write-back v1) |
| Approach | Where classification lives | **Source (queue gate)** — track never second-guesses the gate (#144 lesson); shadow mode before enabling |

## 3. Architecture (queue side)

Classification happens at reason **push sites**, not by string matching. Every review-forcing reason in `review-gate.ts` step 2 comes from a named predicate; each push carries `desk` metadata. The only mixed source is `mergeNotes`: a small queue-side classifier tags the few FYI families (brand-across-buyer-families, vendor-not-stated, soft port notes), pinned to track's `review-reasons.ts` categories by the cross-repo fixture (same pattern as the `g-*` gate binding).

```
reviewGate(draft)                       flag OPENPAVE_DESK_MEMBERSHIP = off | shadow | on
  reasons = [{ text, desk: 'decision'|'fyi', code? }]
  ├─ any DECISION reason              → disposition = review  (unchanged)
  ├─ only FYI reasons:
  │    ├─ band = low                  → review + decision reason  ai_confidence_low
  │    ├─ band ≥ medium, flag = on    → disposition = auto · FYI reasons ride the payload → detail "Also noted"
  │    └─ band ≥ medium, flag = shadow→ review (as today) + criticReview.wouldBeAuto = true
  └─ master misses → structured criticReview.masterMisses[] { type: 'vendor'|'forwarder'|'customer', rawName, field }
```

- `masterMisses[]` nests under `criticReview` (survives ValidationPipe `whitelist:true`; no migration). Today misses are prose; structure is what makes aggregation possible.
- Untouched: `hardStops`, 2b routing, portal-echo skip (不需處理), field locks, all parse-flow gate work. This **generalizes** the GATE_CODES registry — build on it, after parse-flow PR-1.
- Acknowledged asymmetry (deliberate): a band=low leg with **zero** reasons already auto-commits today under the gate's strict corroboration rules; the new rule only keeps band=low legs queued when FYI noise is present. Widening auto for bare band=low legs is the full 2b flip — out of scope here.
- No backfill: a master still missing re-surfaces on the next email by itself (self-healing), so the report needs no legacy-prose parsing.

## 4. Operator UX (track side)

**Queue rows become decision phrases.** Lead text derives from the highest-priority decision reason, fixed order:

1. 揀邊票貨 — which shipment (N candidates)
2. 真貨定通知 — is this a real shipment
3. 補關鍵欄位 — N critical blanks (Booking/SO/CRD/ETD/ATD, per 07-19)
4. 解欄位衝突 — resolve field conflict (named field)
5. 驗證 gate — check digit / TOTAL (g-* codes)
6. 驗證拆解 — AI confidence low

Count badges + the AI-Confidence `Badge` stay; ordering stays confidence-ASC; the existing filter pills (categories + gate codes) are unchanged.

**Shadow lane.** Under `flag=shadow`, would-be-auto legs show one muted chip `auto-eligible (shadow)` and a one-click **Confirm as-is** row action. Confirm-as-is = agreement data point; any field edit before confirm = **false-skip** data point. The lane is the measurement instrument for turning the flag on.

**ReviewCard**: 07-19 A1 regions unchanged; the card headline shows the same decision phrase. FYI remains on shipment detail "Also noted" (07-20). Legs that stop queueing keep their full story on detail.

## 5. Admin Mesh report

Route `/admin/mesh-misses`, guarded by the existing admin role.

- Table grouped by `(type, normalized rawName)` (normalizer: casefold + trim + collapse internal whitespace; SAME function contract in both repos, pinned by the fixture) over stored `criticReview.masterMisses[]`: **Name · Type (vendor/forwarder; customer behind a filter) · Shipments (count → leg list) · First seen · Last seen · Status · 已入 Mesh (ack)**
- Default: last 30 days, open only; toggle shows acked; export xlsx/csv.
- Ack persists to additive table `dbo.mesh_miss_ack (type, normalizedName, ackedBy, ackedAt)` (Kysely, additive-only). A name recurring **> 7 days after ack** resurfaces flagged `recurred after ack` (the "entered but still not matching" alarm).
- v1 scope: vendors + forwarders front-and-centre (John); customers included in data, behind a filter; ports later; brands/factories stay ignored (existing Mesh decision). No Mesh write-back v1 (API scope is lookup; write is a later decision).

## 6. Guardrails

- **Regression snapshot:** with flag `off` or `shadow`, every existing disposition is byte-identical (same pattern as the parse-flow lift-filter snapshot).
- Gate stays deterministic and auditable; track never reclassifies (single-brain rule; #144 precedent).
- **False-skip metric definition:** a `wouldBeAuto` leg where the operator edited any field before confirming.
- Legacy payloads (no desk metadata / no masterMisses): membership is queue-side, so track renders old payloads exactly as today; the admin report simply has no rows from them.
- Critical blanks (07-19 Booking/SO/CRD/ETD/ATD): these never forced queue membership — they are computed track-side over live values and surfaced whenever a leg IS queued. `flag=on` does not change that; blanks on auto-committed legs remain visible on shipment detail, same as today's bare gate-auto legs. Promoting critical blanks to a membership reason is a separate product decision, deliberately not taken here.
- Cross-repo fixture extends with: desk classes on reasons, `masterMisses[]`, `wouldBeAuto`.

## 7. Testing

- Unit (queue): mergeNote FYI-family classifier; membership matrix (decision/fyi × band low/med/high × flag off/shadow/on); `ai_confidence_low` emission; `masterMisses[]` structure; disposition regression snapshot.
- Unit (track): shadow chip + Confirm-as-is; decision-phrase priority selection; admin aggregation, ack, recurred-after-ack, export, role guard; detail "Also noted" unchanged.
- Contract: extended cross-repo fixture (both suites).
- E2E (booted dist): shadow leg one-click confirm end-to-end; admin ack flow; a `flag=on` FYI-only leg auto-commits with reasons visible on detail.

## 8. Rollout

```
1. Ship desk registry + masterMisses[] + admin page   (flag off; admin page is read-only, can ship first)
2. flag = shadow (full traffic)                        → collect ≥2 weeks, ≥50 wouldBeAuto legs
3. Exit gate: false-skip < 2%                          → flag = on, canary by forwarder
4. Full on; queue length + opens-with-nothing-to-decide tracked in §9
```

Sequencing: after parse-flow **PR-1** (gates land the GATE_CODES registry this generalizes). CI note: flag flips follow the same rule as the parse-flow plan — green CI required (T0 there).

## 9. Success criteria

- Review queue contains **zero** legs with nothing to decide (operator-reported + shadow data).
- Queue length drops by the shadow-measured FYI-only share; false-skip stays < 2%.
- Every queue row states its decision phrase; time-to-first-action drops.
- Admin enters ≥ 1 batch of missing vendors/forwarders per week from the report; `recurred after ack` surfaces entry mismatches; the same miss stops re-appearing after Mesh entry.

## 10. Non-goals

- Full 2b routing flip (bare band=low auto) — separate, data-gated (parse-flow T12).
- Mesh write-back from the report.
- Ports/brands/factories in the report v1.
- Backfilling legacy prose misses.
- Re-opening 07-17 / 07-19 card layouts.

## 11. Open items (implementation-time)

- Enumerate the exact FYI mergeNote families from `review-reasons.ts` categories; the fixture forces queue/track agreement.
- Final operator copy for the six decision phrases (with ops).

---

## Appendix — ELI5(繁中)

審核隊列 = **決策中心**:入到嚟嘅每一票,都寫明「等你做咩決定」。純粹「話你知」嘅嘢唔會再拉貨入隊——乾淨而且 AI 信心夠嘅,直接自動入帳,理由留返喺貨件詳情頁。AI 自己都話唔肯定(band low)嘅,照樣入隊,叫你「驗證拆解」。Mesh 缺漏(vendor/forwarder 未入 master)唔再喺審核度嘈:去咗一頁 admin 報表,admin 一次過入 Mesh,以後呢類雜音由源頭消失;入咗之後仲彈返出嚟嘅,會標「入咗但重現」提你入錯名。上線分三步:先影子模式量兩星期(本應自動嘅貨,操作員有幾多次真係唔同意),錯放率低過 2% 先正式開。
