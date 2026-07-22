# Cobalt ShipTrack — Build Plan

**Owner:** John Mak · **Scope:** POC at near‑production fidelity · **Authored:** 2026‑06‑13
**Definition of done:** the 5 representative forwarder chains flow Graph → queue → parse → match → commit → tracking → dashboard on real data; parser passes the gold benchmark (PO ≥ 90% / HBL ≥ 85%); alerts pass the Pillar‑4 gate (≤ 15% false positives, 0 missed Criticals).

This plan supersedes the old `PLAN.md` (which finished track‑system's *own* Graph email‑sync — now dropped, because cobalt‑queue owns ingestion).

---

## 1. Decisions locked (this session)

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | **cobalt‑queue stays Hono/TS, untouched** | Validated end‑to‑end on real emails + the 156‑record gold benchmark. |
| 2 | **track‑system app backend → NestJS** (replacing Hono) | "More robust." Cheap to do — its old backend is being deleted anyway; NestJS guards/interceptors/modules map onto RBAC + audit + committer invariants. |
| 3 | **NestJS + Drizzle ORM — NOT TypeORM/Prisma** | One shared schema package across both services + the `evidence` contract. Two ORMs over one Postgres is a footgun. |
| 4 | **Data model = PO → Booking → Shipment** (3 levels) | Represents multi‑leg / re‑mode / split natively; keys on the stable Booking + a bag of `match_keys`, not on rotating email IDs. |
| 5 | **Matching agent emits a decision JSON; NestJS committer writes the DB** | Safety invariants (field‑locks, audit, idempotency, dedup) live in tested code, not the LLM. |
| 6 | **Auth = JWT, local accounts, RBAC** (Viewer / Editor [/ Admin]) | Self‑contained, no IT dependency, real enough for near‑prod, swappable for Entra SSO later. |
| 7 | **Agent runtime = OpenPAVE; EPM routes to Azure (gpt‑5‑mini)** | Keeps PAVE host tools (`ocr_image` PP‑OCRv4, `parse_document`). **Azure `responses` adapter kept as proven fallback** — see Risk R1. |
| 8 | **UI = redesigned around Booking** as the primary object | Harvest the existing design system; restructure information architecture. |
| 9 | **VM split:** App/UI + ingestion on **VM1** (inbound 443); parser + agents on **VM2** (outbound LLM only); **shared managed Postgres** is the boundary | Only VM1 has inbound 443 → operators + webhook must land there; LLM egress isolates on VM2. |
| 10 | **Aggressive auto‑apply (policy C)** | High‑confidence writes apply live + log to the audit timeline; only low‑confidence / unknown‑entity / hard‑conflict route to review. |

---

## 2. Runtime architecture

```
        Internet — operators' browsers + Graph webhooks
                     │  HTTPS 443 (inbound HERE ONLY)
   ┌─────────────────▼───────────────────────┐
   │ VM1 — App Host                           │
   │  • React/Vite UI (Booking‑centric)       │
   │  • NestJS API (tracking · review ·       │
   │    alerts · masters · auth/RBAC ·        │
   │    the COMMITTER)                        │
   │  • Ingestion: cobalt‑queue poller        │
   │    (webhook receiver later)              │
   └──────┬───────────────────────────────────┘
          │ writes tracking/audit/alerts · reads evidence
   ┌──────▼───────────────────────────────────┐
   │ Managed Postgres (Azure Flexible, VNet)   │  ← VM1↔VM2 boundary
   │  queue · evidence        ← cobalt‑queue   │
   │  tracking · audit · alerts ← track‑system │
   └──────▲───────────────────────────────────┘
          │ writes queue/evidence
   ┌──────┴───────────────────────────────────┐
   │ VM2 — Agent Host (NO inbound)             │
   │  • cobalt‑queue consumer + parser         │
   │  • Agents: Parser → Matching → Iterator   │
   │  • LLM egress: OpenPAVE / Azure Foundry   │
   └───────────────────────────────────────────┘
```

**Repos:** `cobalt-queue` (Hono, VM2 consumer + VM1 poller process), `cobalt_track_system` (NestJS API + React UI, VM1), and a new **`@cobalt/contracts`** package (Drizzle schema + Zod types) linked into both — the only shared code surface.

---

## 3. Data model (track‑system owns `tracking` / `audit` / `alerts`)

- **PO** — ERP mirror, read‑only (`purchase_orders`). The merchandising unit.
- **Booking** — stable parent (`bookings`, `job_no` key; `booking_pos`). Customer, vendor, forwarder, brand, CRD.
- **Shipment leg** — volatile child (`shipments`: `booking_id`, `mode`, `state`, `confirmed_by_email`; `shipment_pos` for splits). State + all mutable fields live here.
- **Milestones** (`shipment_milestones`, + `AT_WAREHOUSE`, + `INVOICE_RECEIVED`). `AT_WAREHOUSE` = earliest of (1) forwarder CFS/进仓通知书, (2) vendor "delivered to warehouse", (3) Draft B/L fallback → `sender_type` is load‑bearing.
- **Field‑locks** (`field_locks`) — human edit wins + locks; agent fills empties / revises its own prior values, never overwrites a lock → raises a conflict.
- **Masters to add:** `consignees` (maps_to_customer), `ports` (UN/LOCODE, sea+air). Tiered resolver: exact → alias → CN‑name → email‑domain → fuzzy.
- **Audit** (`audit.change_log`): entity, field, old/new, source ∈ email|manual|system, is_delay.
- **Alerts** (`alert_rules` A1–A6 Pillar‑4, thresholds + `compute_tz`; `alerts`).
- **Evidence contract (read‑only, written by cobalt‑queue):** `evidence.parsed_record` — one row per email×PO, 20 fields, match_keys, amendments, needs_review, confidence.

State staircase (unified sea + air, display driven by `mode`): **BOOKED → CONFIRMED → AT_WAREHOUSE → SAILED/Departed → RELEASED → DELIVERED**. Re‑mode = add a child leg; leg 1 superseded, leg 2 active, under one Booking.

---

## 4. The reconciliation core (Phase 3 detail)

**Matching agent (VM2, OpenPAVE)** — input = `{ new evidence record(s) + candidate bookings/legs (pre‑fetched by NestJS via match_keys) + relevant masters }`; output = a **decision JSON**: `action ∈ {create_booking, add_leg, amend_fields, merge_into_leg, flag_conflict, needs_review}`, target ids, field diffs, confidences, match_keys. Stays a pure function — **no DB access in the agent**.

**Committer (VM1, NestJS, deterministic + tested)** — consumes the decision JSON and applies it under invariants: enforce `field_locks`, write `change_log` on every change, idempotency + dedup (match_keys + content‑hash), route low‑confidence / unknown‑entity / hard‑conflict to the review queue. This is `cobalt-queue/src/critic/merge.ts` promoted into tested NestJS code.

> **Confirm:** candidate retrieval is **app‑side** (NestJS queries by match_keys, passes candidates to the agent). Keeps all DB access + invariants in tested code. Object if you want the agent to query the tracking DB directly.

---

## 5. Phases (dependency‑ordered)

**Phase 0 — Foundations & contract. ✅ DONE 2026-06-13.** `@cobalt/contracts` at `packages/contracts` — ONE Drizzle schema for all 6 pg schemas (`queue`/`evidence` mirrored verbatim from cobalt-queue + new `tracking`/`audit`/`alerts`/`match`) + Zod seam (`ParsedFields`/`MatchKeys`/`MatchDecisionZ`). Typechecks; **live round-trip verified** on throwaway Postgres (docker `cobalt-rt` :5432): 25 tables, all 6 schemas, seam + PO→Booking→Shipment + sea→air supersede + field_lock + audit insert/read-back clean. First migration: `packages/contracts/drizzle/0000_tiresome_karnak.sql`. *Deferred:* full workspace `pnpm install` (node_modules purge) → do at Phase-1 NestJS scaffold.

**Phase 1 — Tracking schema + masters (NestJS).** Implement `tracking`/`audit`/`alerts` schemas; add `consignees` + `ports`; tiered resolver; seed customers/vendors/forwarders + ERP PO mirror from fixture (no live ERP in POC). **Migrate SQLite → Postgres; delete the OLD shipment‑centric tables + pipeline.** *Exit:* migrates clean; masters seeded. **✅ DONE 2026-06-13:** NestJS backend scaffolded in-place (CommonJS + `@nestjs` 10, Drizzle/pg provider, `@cobalt/contracts` workspace dep made CJS); old Hono backend + SQLite removed; modules health/masters/bookings/shipments; seed adds masters + fixture PO + A1–A6 rules + demo sea→air booking; **endpoints verified live** on `cobalt-rt` (`/api/bookings` returns the booking with both legs). Remaining (later): tiered resolver, full masters import from cheat sheet, write/CRUD endpoints.

**Phase 2 — Ingestion → evidence on real data (cobalt‑queue).** Point at shared Postgres. **Wire OpenPAVE adapter (target) + keep azure `responses` as fallback.** Load the 5 chains. *Exit:* 5 chains produce correct evidence; gold benchmark PO ≥ 90% / HBL ≥ 85% on those forwarders.

**Phase 3 — Matching agent + committer + state engine.** Decision‑JSON schema; matching agent (OpenPAVE); committer (NestJS, field‑locks/audit/idempotency/dedup); 6‑state engine; AT_WAREHOUSE earliest‑of. *Exit:* 5 chains land on correct timelines; a sea→air chain shows leg1 superseded + leg2 active; a partial (B6+B7) shows parent + N children; a field‑lock conflict routes to review.

**Phase 4 — Alerts (Pillar‑4).** Seed A1–A6 (thresholds + compute_tz in DB); A2/A3 in vessel TZ; evaluator cron. *Exit:* Pillar‑4 gate — ≤ 15% FP, 0 missed Criticals over a shadow run.

**Phase 5 — UI redesign around Booking (React).** Booking detail = hub (POs, parties, CRD) with legs as 🚢/✈️ cards (superseded→active), each with state timeline + key dates + milestones. Review queue (inline correct‑and‑approve) with **view-original = on-demand Graph fetch** of the source email + attachments (NestJS endpoint using the stored `queue_message.graphId`; renders in-app + an "Open in Outlook" `webLink`; **falls back to stored normalized text + attachment_meta if the email was purged from the mailbox**). Audit timeline reuses the same view-original. Alerts dashboard. Masters admin. Harvest the existing design system (#0047BA/#00A884, Card/Badge/Pagination/StatusBadge/MilestoneTimeline). *Exit:* operator follows a booking E2E, sees both legs on a re‑mode, corrects a field (which locks it), clears an alert.

**Phase 6 — Auth/RBAC.** JWT + local accounts; NestJS guards; Viewer (read) / Editor (mutate, edits audited + locked) / Admin (masters, rules). *Exit:* unauth blocked; Viewer can't mutate; Editor edits locked + audited.

**Phase 7 — Iterator (self‑iterating agent).** *(After first E2E demo.)* Capture review corrections as (agent‑said → human‑corrected → field → email) pairs; refine the parser/matcher prompt; **benchmark‑gated auto‑promote** vs the frozen 156‑record gold set (per‑forwarder & per‑field), auto‑reject on regression, versioned prompts + instant rollback; gold set stays frozen/held‑out. *Exit:* a correction round auto‑promotes a passing prompt version (or correctly rejects a regressing one).

```
0 ─▶ 1 ─┬─▶ 3 ─┬─▶ 4
        │       └─▶ 5 ─▶ (6 parallel)
   2 ───┘
        └────────────────────▶ 7 (last)
```

---

## 6. Risks & mitigations

- **R1 — OpenPAVE run‑API wiring (highest).** `openpave.ts` is a throwing stub; `opencode serve` errors on this install. → **Mitigation:** ship Phase‑2/3 E2E on the validated `responses`/`azure` adapter; wire OpenPAVE in parallel via the `PARSER` switch; E2E never blocks on it.
- **R2 — No live ERP for POC.** → PO mirror loaded from CSV/fixture.
- **R3 — Webhook needs internet‑facing host.** → POC uses polling; webhook receiver moves to VM1 later.
- **R4 — Two frameworks (Hono queue / NestJS app).** → Isolated services; only shared surface is `@cobalt/contracts`.
- **R5 — UI redesign spends much of the "90%".** → Harvest components/design system; restructure IA only.

## 7. Still open

- Candidate‑retrieval ownership (§4 confirm) — recommend app‑side.
- Exact RBAC role set (Viewer/Editor, or +Admin).
- Whether the matching + critic stages are one agent or two (treated as one "Matching/Critic" stage here).
