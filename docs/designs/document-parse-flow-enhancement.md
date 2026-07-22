# Document Parse Flow Enhancement Plan (v2 — ground-truth rewrite)

**Status:** ACTIVE · CEO HOLD-SCOPE re-review (2026-07-20)  
**Repos of truth:** `D:\cobalt-queue` (Agent VM) + `D:\cobalt_track_system` (ShipTrack / Tracking VM)  
**Not source of truth:** `C:\Users\John\pave-apps\cobalt_track_system` (demo / PAVE mirror only)

---

## 0. Platform lock (corrected)

| Layer | Truth (as of 2026-07-10+) |
|-------|---------------------------|
| **OLTP DB** | **Microsoft Fabric SQL** (prod) · **SQL Server 2022** container `mssql-2022` (dev/CI) |
| **ORM** | **Kysely** + T-SQL migrations (`kysely-migrations/`) — Drizzle/`pg` **removed** |
| **Shared DB layout** | One Fabric DB `ShipTrackDB`: ship-track owns **`dbo.*`**, queue owns **`queue.*`** |
| **Job broker** | **RabbitMQ** (RabbitBoss) — **not** pg-boss |
| **Auth to Fabric** | Entra Service Principal (`SQL_SERVER_URL` ADO.NET string) |
| **HTTP boundary** | Queue → track: `POST /api/decisions` only (no shared app code) |
| **Evidence storage** | SQL Server **`nvarchar(max)` JSON** + **`varbinary(max)`** for attachment/image bytes in `queue.*` — **not** Postgres bytea / S3-first |

> v1 of this plan wrongly assumed Postgres + pg-boss. That is obsolete. All new work must use Kysely/T-SQL patterns and SQL Server gotchas (TOP not LIMIT, JSON stringify/parse, GUID case, 2100-param cap, no `pg_trgm`).

---

## 1. Executive summary

### Real problem
The production pipeline is far past “add OCR.” Cobalt already runs:

Graph ingest → normalize → RabbitMQ → OpenPAVE parse (Qwen-VL OCR + Paddle fallback + **horizontal tiling**) → deterministic `validate` → packing skills → matcher → critic → decisions → ShipTrack review (confirm/correct + field locks).

What still hurts ops is **precision gaps on dense packing lists / scans** and a few **missing hard gates**, not a missing platform.

### Outcome
- Raise **safe auto-commit** without silent wrong cartons/weights/containers  
- Make Review an **exception desk** with gate reasons already native to the stack  
- Ship increments on **D: repos + Fabric/SQL Server**, not C: pave-apps

### Scope (HOLD SCOPE after re-audit)
Enhance **existing** flow. Do **not** rebuild spine components that already exist.

---

## 2. What already exists (do not rebuild)

### 2.1 cobalt-queue (`D:\cobalt-queue`)

| Capability | Location | Notes |
|------------|----------|-------|
| Message lifecycle incl. `PROCESSING` | `queue.queue_message.status` CHECK | PENDING→…→PROCESSING→DONE/FAILED/DEAD_LETTER |
| Attachment bytes | `queue.queue_attachment.raw_bytes` varbinary(max) | Content-hash keyed |
| Normalized parts | `queue.queue_normalized` | text + image_bytes |
| Parsed records | `queue.parsed_record` | fields/match_keys/needs_review as nvarchar(max) JSON |
| PDF normalize | `src/normalize/pdf.ts` | text_pdf vs scanned_pdf; native PDF passthrough |
| **Qwen-VL OCR** | `src/parser/qwen-ocr.ts`, `ocr.ts` | Primary when `OPENPAVE_OCR_PROVIDER=qwen` |
| **PaddleOCR** | `paddle-run.ts`, `paddle-worker.ts` | Fallback; out-of-process default; v6-tiny |
| **Horizontal tiling** | `ocr-tile.ts` | Cap ~2.5 Mpx, 120px overlap — already measured vs Qwen token clamp |
| OCR cache | `ocr-cache.ts` | SHA-256 process cache |
| Glyph arbiter | `glyph-arbiter.ts` | Paddle vs VL style votes |
| **realignTables** | `candidate-digest.ts` | Column-major table re-pair |
| Body table fast-path | `body-table-fastpath`, `table-extract.ts`, `deepseek-extract.ts` | Column mapping for HTML/OCR tables |
| **Multi-PO packing skill** | `skills/multi-po-packing-list.ts` | Broadcast TOTAL qty detection + plain block parse |
| Packing authority collapse | `packing-authority.ts` | One authoritative row per PO |
| Deterministic validate | `validate.ts` | IDs, dates, MAWB, **container shape AAAA#######**, multi-value identity, echoes |
| Critic + merge | `src/critic/` | Trust score 0–100 |
| Matcher + ambiguity | `src/matcher/` | Multi-candidate open issues (#175) |
| Iterator / learning | `src/iterator/` | Correction → soul (gated) |
| RabbitMQ consumer | `src/consumer/` | Job orchestration |

### 2.2 cobalt_track_system (`D:\cobalt_track_system`)

| Capability | Location | Notes |
|------------|----------|-------|
| Decisions ingest | `POST /api/decisions` | Raised JSON body limit for evidence bundles |
| Review confirm/correct | `backend/src/review/review.service.ts` | Locks fields; confirm sentinels to queue learning |
| Field locks | field-lock repository | Human-wins |
| Evidence mirror | evidence repository | From decisions payload |
| Review queue UI | frontend review pages | Provisional legs, lowest confidence first |
| SQL Server / Fabric | Kysely migrations `dbo.*` | 29+ tables; mssql-2022 CI |

### 2.3 Already decided product rules (keep)

- Multi-PO packing list with **ambiguous / broadcast qty** → skill flags review (not silent stamp)  
- Container must match `AAAA#######` shape or null + needs_review  
- Paddle-sourced OCR can flag medium trust (`flagPaddleOcr`)  
- Message statuses already include **PROCESSING**

---

## 3. Real gaps (enhancement targets)

| ID | Gap | Severity | Why it still hurts |
|----|-----|----------|-------------------|
| G1 | **ISO 6346 check digit** not validated | P1 | Shape `AAAA#######` accepts wrong check digit → bad auto-join on container |
| G2 | **Line-item Σ vs footer TOTAL** not a hard gate | P1 | Multi-PO skill handles broadcast qty but not full PL line reconciliation (cartons/NW/GW/CBM) |
| G3 | **PP-Structure / table structure model** not integrated | P1–P2 | Plain OCR + realign + deepseek column map help; dense multi-col PL still fails (ACNS-class) |
| G4 | **Review UI lacks gate evidence chips** | P2 | TOTAL delta / checksum reason not first-class in Review (fields + critic only) |
| G5 | **realignTables adoption / default** | P2 | Exists + tests; ensure production path always builds digest with realign when tables look column-shifted |
| G6 | **Page budget for huge docs** | P2 | Tile max exists for Paddle; need explicit **page cap** (15 full spine + footer) for multi-page PL |
| G7 | **Committer multi-hit first-match** | P2 | Open #175 — wrong leg can absorb fields before human pick |
| G8 | **Gold eval harness for PL line recall / TOTAL match** | P1 | Partial golden tests exist; need PL-specific corpus metrics as release gate |
| G9 | **Evidence size on decisions POST** | P2 | Large structure HTML in JSON → already raised body limit; need **cap + truncate policy** on SQL nvarchar(max) payloads |
| G10 | **LLM Master Matcher still deferred** | P3 | `pg_trgm` removed; FTS re-spec open — orthogonal to PL OCR |

### Explicitly NOT gaps (v1 plan errors)

| v1 claimed “build” | Actual |
|--------------------|--------|
| Add Qwen-VL sidecar | **Already primary OCR path** |
| Add image tiling | **Already in ocr-tile + paddle tile** |
| Add PROCESSING status | **Already on queue_message** |
| Add Review field locks / confirm | **Already shipped** |
| Migrate off Postgres | **Already on Fabric/SQL Server** |
| Introduce pg-boss | **Wrong — RabbitMQ** |

---

## 4. Target architecture (delta only)

```
EXISTING PIPELINE (unchanged spine)
  Graph → normalize → RabbitMQ → parse(OpenPAVE)
       → OCR (Qwen primary | Paddle fallback + tiles)
       → table-extract / realignTables / packing skills
       → validate (shape guards)
       → matcher → critic → POST /decisions → review

NEW / HARDENED DELTAS
  validate.ts  ──+── ISO 6346 check digit (G1)
                 └── total_reconcile when line items present (G2)

  table path   ──+── optional PP-Structure HTML inject before hybrid extract (G3)
                 └── force realignTables on packing-list-like bodies (G5)

  OCR budget   ──+── max full-spine pages = 15; always keep last page for TOTAL (G6)

  decisions    ──+── gate_failures[] + total_check on needs_review / critic payload (G4,G9)

  shiptrack UI ──+── chips for gate codes + TOTAL delta (G4)

  eval         ──+── PL gold: line recall + TOTAL match CI gate (G8)

  committer    ──+── observability / hold multi-hit (#175) (G7)
```

### SQL / Fabric constraints for new work

- Migrations: **additive** T-SQL in `queue` or `dbo` schema via Kysely modules only  
- Prefer store gate results in existing `needs_review` / `fields` JSON (`nvarchar(max)`) before new tables  
- If new columns: `nvarchar(max)` for JSON, `bit` for flags, `datetimeoffset(7)`, `uniqueidentifier`  
- **No** `LIMIT`, **no** `ON CONFLICT`, **no** `jsonb` operators, **no** `pg_trgm`  
- Dev: `localhost:1433` mssql-2022; Prod: Fabric Entra SP, skip CREATE DATABASE  
- Evidence images stay `varbinary(max)` in queue; do not assume object storage  
- Cap inline structure HTML (recommend **32 KB** in decisions payload; truncate with note)

---

## 5. Phased delivery (revised)

### Phase 0 — Gold PL corpus + metrics (Week 1) · P1
- Freeze 30–50 **production-shaped** fixtures from D: corpus / Graph samples (redact PII)  
- Metrics: line recall, TOTAL match, container check-digit fail rate, auto-commit would-pass rate  
- Hook into existing vitest / `extract-golden` patterns; add `pnpm test:pl-gold` or extend golden suite  
- **Exit:** baseline numbers checked into `docs/eval/`

### Phase 1 — Hard gates in `validate.ts` (Week 1–2) · P1
1. **ISO 6346** after shape normalize — invalid check digit → null container + `needs_review` medium/high + reason `container_checksum`  
2. **total_reconcile** when `item_list`/multi-record qtys present and footer total known — mismatch → medium/high review + structured note  
3. Map gate codes into decision payload so track can surface chips  
- **Exit:** unit tests for check digit + TOTAL; zero gold auto-commits with bad checksum  

### Phase 2 — Table structure quality (Week 2–4) · P1–P2
1. Ensure `realignTables` + candidate digest always on packing-list-like subjects (flag)  
2. Spike **PP-Structure** (or Paddle structure API if available in ppu stack) → HTML table inject into extract context  
3. Keep deepseek column map as secondary  
- **Exit:** ACNS-class / multi-col PL line recall ≥ baseline +15pp on gold  

### Phase 3 — Page budget + cost guards (Week 3–4) · P2
- Full spine on first **15** pages max; always process **last page** for TOTAL/footer  
- Log `pages_skipped` on message; force review if skipped pages > 0 and TOTAL missing  
- Align with existing `paddleTileMaxTiles` / vision budget  

### Phase 4 — Review evidence chips (Week 4–5) · P2
- ShipTrack Review: show `gate_failures` + TOTAL delta from decision/evidence  
- Sanitize any HTML fragment (allowlist table tags only)  
- No new object store — read from mirrored evidence / leg critic JSON  

### Phase 5 — Multi-hit committer safety (#175) (Week 5–6) · P2
- Observability first: record `committerChosenLegId`  
- Prefer **hold NEEDS_REVIEW** when ≥2 strong matches (align with multi-PO ambiguity)  
- Do not auto apply-back across multi-shipment without human  

### Phase 6 — Hardening (Week 6–7)
- Feature flags: `iso6346_gate`, `total_reconcile_gate`, `structure_html`, `pl_page_cap`, `review_gate_chips`  
- Canary by forwarder  
- Runbooks: Structure/Paddle worker crash (already soft-fail), TOTAL spike freeze auto-commit for packing lists  

---

## 6. Error & rescue (new codes only)

| Codepath | Error class | Action | Surfaces as |
|----------|-------------|--------|-------------|
| ISO 6346 | `ContainerChecksumFail` | null container; needs_review | Review chip + field empty |
| TOTAL Σ | `TotalMismatch` | needs_review high; keep lines | TOTAL delta chip |
| PP-Structure timeout | `StructureTimeout` | skip structure; keep OCR path | metric only |
| Page cap | `PagesSkipped` | needs_review if TOTAL missing | note on message |
| Decisions payload too large | `EvidenceTruncated` | truncate HTML; keep codes | warning in evidence |

Existing soft-fail contracts (OCR never throws, paddle-worker timeout → '') **stay**.

---

## 7. Security (SQL + decisions)

- Structure HTML in UI: **sanitize** (XSS)  
- Gold fixtures: redact phones/emails; store under restricted path  
- No secrets in git; Fabric SP via env only  
- Decisions POST already large-body — do not log full varbinary/HTML at info level  

---

## 8. Testing

| Layer | Add |
|-------|-----|
| Unit | ISO 6346 vectors (valid/invalid/null/short); TOTAL tolerance; page-cap planner |
| Integration | validate → needs_review → critic disposition still correct on mssql-2022 |
| Golden | PL multi-col + multi-PO broadcast + bad container check digit |
| E2E | email w/ scanned PL → gate fail → provisional leg → Review chip → correct → lock |

CI engine remains **mssql-2022** service; do not reintroduce Postgres tests.

---

## 9. Deployment

```
1. Additive code flags OFF
2. Deploy queue consumer (validate gates)
3. Deploy track Review chips (read-only if no gate payload yet)
4. Enable iso6346_gate + total_reconcile_gate (fail → review)
5. Enable structure_html canary
6. Enable page_cap
```

Rollback = flag OFF. Migrations additive only.

---

## 10. Success metrics (8 weeks)

| Metric | Target |
|--------|--------|
| Invalid ISO container auto-commit | **0** |
| PL TOTAL match (gold) | ≥ **95%** |
| PL line recall | ≥ baseline **+15pp** |
| Safe auto-commit rate (canary) | **+10pp** vs pre-gates |
| Median review time on gated items | **−20%** with chips |

---

## 11. Implementation tasks (D: paths)

### P1
- [ ] **T1** PL gold corpus + metrics runner — `D:\cobalt-queue\test` / `docs/eval`  
- [ ] **T2** ISO 6346 in `D:\cobalt-queue\src\parser\validate.ts`  
- [ ] **T3** TOTAL reconcile gate + structured needs_review codes  
- [ ] **T4** Propagate gate codes through critic → decisions DTO → track evidence  

### P2
- [ ] **T5** Harden realignTables production path for packing-list-like mail  
- [ ] **T6** PP-Structure spike + HTML inject behind flag  
- [ ] **T7** Page cap 15 + last-page TOTAL  
- [ ] **T8** Review gate chips UI — `D:\cobalt_track_system\frontend` + review service  
- [ ] **T9** #175 multi-hit committer observability + prefer review  

### P3
- [ ] **T10** Master matcher FTS re-spec (orthogonal)  
- [ ] **T11** Evidence payload size dashboard / truncate metrics  

---

## 12. Repo ownership pin

| Work | Repo | Path root |
|------|------|-----------|
| OCR / validate / structure / packing | **cobalt-queue** | `D:\cobalt-queue\src\parser` |
| Consumer / flags / config | cobalt-queue | `D:\cobalt-queue\src\config.ts`, `consumer/` |
| Queue schema migrations | cobalt-queue | `D:\cobalt-queue\src\db\kysely-migrations` |
| Decisions DTO / review / chips | **cobalt_track_system** | `D:\cobalt_track_system\backend\src` |
| Review UI | cobalt_track_system | `D:\cobalt_track_system\frontend` |
| Shared Fabric DB | both | `dbo.*` vs `queue.*` via `SQL_SERVER_URL` |

**C:\Users\John\pave-apps\*** is not a deploy target for this plan.

---

## 13. NOT in scope

- Rebuild tiling / Qwen / Paddle (already shipped)  
- Postgres or pg-boss return  
- Full ERP bidirectional sync  
- Object-storage-first evidence redesign (unless varbinary size forces it later)  
- Replacing OpenPAVE soul wholesale  

---

## 14. Dream state delta

| After this plan | Still later |
|-----------------|-------------|
| Hard digital gates on container + TOTAL | Self-improving structure from locked corrections |
| Better dense PL tables | Full multi-attachment assembly polish |
| Review shows why it failed | Public per-forwarder accuracy board |
| Fabric/SQL Server as assumed baseline | — |

---

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 2 | CLEAR | HOLD SCOPE re-audit; platform corrected to Fabric/SQL2022; v1 overbuild cut |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 0 | — | eng review required on D: paths |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | recommended for gate chips only |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **VERDICT:** CEO CLEARED (v2 ground-truth) — implement only real gaps G1–G9 on D: repos; eng review required before large Structure integration

### Resolved this pass
- Repo pin → **D:\cobalt-queue + D:\cobalt_track_system** (not C: pave-apps)  
- DB → **Fabric SQL / SQL Server 2022 + Kysely + RabbitMQ**  
- Async UX → existing `PROCESSING` status; extend with page-skip notes if needed  
- Multi-PO → force review on ambiguity (align skill + #175)  
- Page cap → **15 full spine + last page TOTAL**  
- Evidence store → **SQL nvarchar/varbinary**, 32KB HTML cap  

NO UNRESOLVED DECISIONS
