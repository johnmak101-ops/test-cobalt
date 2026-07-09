# LLM Master Matcher — Design Spec

> **Status:** design, ready for implementation by another agent. Self-contained handoff doc.
> **Date:** 2026-07-09. **Author context:** follows the Cobalt Mesh masters sync (PR #47).
> **Repos:** track-system = `D:\cobalt_track_system` (this repo, deterministic truth-keeper);
> cobalt-queue = the Agent/VM2 parser+matcher (the LLM lives here). Read `AGENTS.md` +
> `.claude/.../memory/cobalt-master-data-governance.md`, `cobalt-mesh-masters-sync.md`,
> `cobalt-de-correction-principle.md` before starting.

---

## 1. Goal

Resolve an **extracted party reference** from an email (a customer / vendor / forwarder / consignee) to the
correct **master record** (its `code`), using **many signals** — not just the name. Output a match, a
confidence, and a rationale; low-confidence goes to human review; human corrections feed a learning loop so
the system gets better over time.

This replaces the brittle, hand-maintained resolution that exists today:
- Code-bound tables in track-system `masters.repository.ts` (`PORT_ALIASES`, `IATA_TO_UNLOCODE`,
  `ABBREV_OVERRIDE`, `NAME_CONTAINS_ALIASES`, `GENERIC_HOSTS`, legal-form fold).
- Code-bound party lists in cobalt-queue `validate.ts` (`PLATFORM_NOT_FORWARDER`, `SELF`, …).
- Hand-curated `master_resolution` **alias** facts (`vendor_alias`, `forwarder_ref`, `customer_canonical`).

It does **not** replace the `master_resolution` **relationship** facts (`customer_group`, `customer_role`,
`vendor_group`, `consignee_for_customer`) — those are business knowledge not inferable from a party's own
attributes, and stay curated (Settings → Resolution Rules).

Prerequisite (done): masters are now a fresh daily mirror of the ERP (Mesh sync). That fresh, complete master
list is the candidate set this matcher needs.

## 2. Core idea: multi-signal retrieve-then-match

You cannot put 845 customers / ~1,466 vendors / 871 forwarders / 4,151 carriers in a prompt per match. So:

1. **Retrieve** a small candidate set (~5–15) cheaply and deterministically from **multiple signals**
   (recall-oriented — cast a wide net). Runs in **track-system** (it owns the masters + SQL).
2. **Disambiguate** with the LLM: give it the extracted reference + all its signals + the candidates (with
   each candidate's attributes) → it picks the best `code`, or `none` (unknown → review) or `new`
   (looks like a genuinely new master). Precision-oriented, context-aware. Runs in **cobalt-queue** (the LLM).
3. **Gate**: high confidence → apply (commit-first); low → review queue. Human correction → learning loop.

The LLM is worth it (over a pure weighted score) precisely because signals **conflict** — the name looks like
A but the domain + region say B; the reference is a trading house that books for factory X; none fit → new.
Reasoning over heterogeneous signals + business context is the LLM's job.

## 3. Signals (the heart of this spec)

Each signal contributes candidates and/or evidence. **The matcher must fuse these, not rely on name alone.**

| # | Signal | Source | How it's used |
|---|--------|--------|---------------|
| 1 | **Name** | extracted party name (+ CH/EN, legal-form variants) | trigram / semantic similarity vs master `name` + aliases |
| 2 | **Email domain** | sender address + any contact email in the body | domain → master (forwarder_aliases `domain`; customer/vendor contact-email domain). **Strong signal.** |
| 3 | **Region / country** | party address country, or the shipment's POL/POD country | filter/boost candidates in the same country (disambiguates two "GLOBAL LTD") |
| 4 | **Address** | extracted address text | city/country tokens as extra name-ish evidence |
| 5 | **Role** | which parsed field (customer_code vs vendor_code vs forwarder_name vs consignee) | constrains the master TYPE searched |
| 6 | **Co-occurrence / history** | the PO / customer / brand on the same shipment | a vendor that has shipped for this customer before is a stronger candidate (graph over `shipment_pos`/`bookings`) |
| 7 | **Brand** | the shipment's brand | brand → owning customer (Mesh `brands` endpoint maps BrandCode→customer relationships, if available) |
| 8 | **Prior corrections** | the learning store (see §7) | exact/fuzzy prior human correction (this context → this code) is a very strong candidate |

**Implication for the data model:** today `customers` stores only `code`+`name`. To match by region/domain
the masters must carry **country** and **domain/contact-email**. The Mesh sync already fetches `CountryName`,
`Address`, `Email` for customers/factories/gmtsuppliers — but the sync currently drops them. **Phase 0 of this
work extends the masters schema + the Mesh sync to persist country + contact email (→ domain).** See §8.

## 4. Architecture & boundary

```
  cobalt-queue (parser/matcher, LLM)                 track-system (deterministic, owns masters)
  ─────────────────────────────────                 ──────────────────────────────────────────
  parse email → extract party refs
        │  (name, domain, country, role, PO, brand)
        ▼
  POST /api/masters/candidates  ───────────────────▶  multi-signal retrieval (SQL, pg_trgm, domain,
        │                                              region, co-occurrence, prior corrections)
        ◀───────────────────────────────────────────  ← ranked candidates + attributes
        ▼
  LLM disambiguation (candidates + signals in;
     {code|none|new, confidence, rationale} out)
        │
        ├─ high confidence → use the code (commit-first, POST /api/decisions as today)
        └─ low confidence  → review queue (existing) → human corrects
                                     │
                                     ▼
                       correction stored → proposed master_resolution fact
                       (existing curator inbox) → approved → deterministic next time
```

**Why this split:** track-system stays the deterministic truth-keeper and already owns the masters (fresh via
Mesh), the resolution facts, the review queue, field-locks, and the curator loop. Retrieval is deterministic
SQL → it belongs there. The LLM belongs in the parser/matcher soul (cobalt-queue), consistent with the whole
system. Track-system stays LLM-free.

## 5. Candidate retrieval — track-system (deterministic)

**New endpoint:** `POST /api/masters/candidates` (called by cobalt-queue; keep it on the same
agent-consumed contract surface as `GET /api/masters/resolution`).

Request (all optional except `type`):
```jsonc
{
  "type": "customer" | "vendor" | "forwarder" | "consignee",
  "name": "MACAU FUNG TAI LTD",
  "emailDomain": "macfun.com.hk",      // from sender/contact
  "country": "HK",                       // ISO-2 or the raw CountryName
  "address": "…",
  "context": {                           // co-occurrence hints (all optional)
    "customerCode": "WYSE",
    "poNumbers": ["100-100209"],
    "brand": "…"
  },
  "limit": 12
}
```

Response — a ranked, deduped candidate list, each with the attributes the LLM needs to reason:
```jsonc
{
  "candidates": [
    { "code": "MACFUN", "name": "MACAU FUNG TAI CO LTD", "type": "vendor", "vendorType": "factory",
      "country": "HK", "domains": ["macfun.com.hk"], "aliases": ["…"],
      "signals": ["name:0.82", "domain:exact", "region:match", "prior_correction"],
      "score": 0.91 }
  ]
}
```

Retrieval = the UNION of per-signal candidate sets, scored + ranked:
- **name**: `pg_trgm` similarity over `masters.name` + alias values (GIN trigram index; threshold ~0.3). Later:
  optional pgvector embeddings for semantic matches trigram misses.
- **domain**: exact/suffix match of `emailDomain` against a domain index (forwarder_aliases `domain`; a new
  customer/vendor domain derived from the synced contact email — see §8). Exact domain = top rank.
- **region**: boost (not hard filter, to keep recall) candidates whose `country` matches.
- **co-occurrence**: candidates linked to `context.customerCode`/`poNumbers`/`brand` via
  `shipment_pos`/`bookings` history — boosted.
- **prior corrections**: candidates from the learning store keyed on (name/domain → code) — top rank.

Keep retrieval **pure + unit-testable** (like the existing `masters.repository` methods); the endpoint is a
thin wrapper. Deterministic — no LLM here.

## 6. LLM disambiguation — cobalt-queue

Input to the LLM: the extracted reference + ALL its signals + the candidate list (attributes above) + the
relevant business context (e.g. this shipment's `master_resolution` relationship facts, so the LLM can resolve
"trading house → its factory group").

Output (structured — force a tool/JSON schema):
```jsonc
{
  "match": "MACFUN" | null,        // null = no confident match
  "decision": "match" | "none" | "new",   // none → review as unknown; new → propose a new master (review)
  "confidence": 0..1,
  "usedSignals": ["domain", "region", "name"],
  "rationale": "domain macfun.com.hk + HK region pin MACFUN over the name-similar MACFUL (Vietnam)"
}
```

Rules baked into the prompt/policy:
- **Only pick from the provided candidates** (or `none`/`new`) — never invent a code. Real-candidates-only is
  the anti-hallucination guarantee.
- Prefer the candidate supported by **multiple independent signals** (domain + region beats a lone high name
  score).
- If nothing fits, `none` (→ review), never a forced pick.
- Keep entity **value mappings out of the prompt** (they live in candidates/masters); the LLM reasons, it
  doesn't memorize the master list.

Model / prompt / runner live in cobalt-queue behind the existing agent contracts (`MatcherAgent`/soul), same
place `validate.ts` does resolution today. Warm-runner caveats as with the other OpenCode/OpenPAVE agents.

## 7. Gate + learning loop (reuse what exists)

- **Gate:** high confidence (≥ the `confidence_threshold` app_setting, or a matcher-specific one) →
  commit-first apply via the existing `POST /api/decisions` path. Low confidence → the existing review queue
  (`review_email` + the review UI). A resolved-to-the-wrong-master case is caught the same way.
- **Human correction:** the reviewer's fix flows through the existing **apply-back** (`ShipmentsService.
  applyExtractionCorrection`, PR #44) → writes the leg + **field-locks** it (human-wins) + audits with the note.
- **Promotion to deterministic:** a confirmed (name/domain → code) correction becomes a **proposed
  `master_resolution` fact** (`vendor_alias` / `forwarder_ref` / `customer_canonical`) in the **existing
  curator inbox** (`GET /masters/proposals`, `POST /masters/curate`, approve/reject). Approved → the next match
  is an exact deterministic hit (no LLM needed). This is the de-correction loop: surface → human → generalize →
  deterministic. **Relationship facts still only ever come from a human**, never inferred.
- **Soul generalization (later):** the Iterator can generalize repeated corrections into soul rules ("this
  domain always means this forwarder"), same mechanism as the parser soul.

## 8. Data-model / schema additions (track-system)

1. **Masters enrichment (Phase 0 — prerequisite):** add `country` (text, ISO-2 or CountryName) + a domain
   source to `customers` and `vendors` (e.g. `contact_email` text, already fetched by Mesh; derive domain at
   query time — or a normalized `master_domain` table). Extend `MeshClient` mappers + `MastersSyncService` to
   persist `CountryName` + `Email` (they're already fetched, currently dropped). Forwarders already have a
   domain home (`forwarder_aliases` `domain`).
2. **Trigram search:** migration `CREATE EXTENSION IF NOT EXISTS pg_trgm;` + `GIN (name gin_trgm_ops)` indexes
   on `customers`/`vendors`/`forwarders`/`consignees` `name`.
3. **(Optional, Phase 2) embeddings:** `pgvector` extension + a `name_embedding` column + ANN index, for
   semantic name matches trigram misses. New dep — gate behind a flag; pg_trgm is the zero-dep MVP.
4. **Learning store:** reuse `master_resolution` (proposed alias facts) — no new table needed for MVP. A richer
   per-context correction store (signals → code) is a Phase 2 option if alias facts prove too coarse.

## 9. Phasing

- **Phase 0 — masters enrichment:** persist country + contact email/domain via the Mesh sync (schema +
  mappers + sync). Backfill via one sync run. *(track-system)*
- **Phase 1 — MVP matcher:** `pg_trgm` + domain + region + role + prior-alias retrieval endpoint
  (track-system); LLM disambiguation over candidates (cobalt-queue); commit-first + review gate; corrections →
  `master_resolution` proposals. Covers signals 1–5 + 8.
- **Phase 2 — richer signals + semantic:** co-occurrence/history (signal 6), brand→customer (signal 7),
  pgvector embeddings, tuned scoring, auto-promotion of high-confidence repeated corrections.
- **Phase 3 — automation:** Iterator generalizes domain/region corrections into soul rules; scheduled
  re-matching of provisional legs as masters/facts improve.

## 10. Non-goals

- Not replacing `master_resolution` **relationship** facts (groups/roles) — human-curated.
- Not writing to Mesh (masters stay ERP-owned, read-only).
- No LLM in track-system (retrieval is deterministic SQL; the LLM is cobalt-queue-side).
- Not matching `ports` (deterministic UN/LOCODE resolution is fine as-is) — though the same endpoint could
  later serve ports.

## 11. Risks & mitigations

- **Hallucinated match** → candidates are real rows only; `none` option; confidence gate; review; field-locks.
- **Confident-but-wrong** → require multi-signal support for auto-apply; a single weak name match stays review.
- **Cost / latency** → hybrid: keep exact code / exact-domain / prior-alias deterministic (no LLM); the LLM
  only runs for the genuinely ambiguous/unresolved cases (today's review/curated-alias cases).
- **Noisy learning** → learned aliases go through the **curator** (human approve), not auto-promoted (MVP).
- **Region false-negatives** → country is a *boost*, not a hard filter, so a mislabeled country can't drop the
  right candidate.
- **Stale masters** → the daily Mesh sync keeps candidates fresh; a just-added ERP master is matchable next day.

## 12. Open decisions (for the implementing agent + the architect)

1. **Learned-alias promotion:** always via the curator inbox (recommended, per governance), or auto-promote a
   correction seen ≥N times? → default: curator.
2. **Name retrieval:** `pg_trgm` only (MVP, zero-dep) vs add `pgvector` embeddings now? → default: pg_trgm MVP.
3. **Confidence threshold:** reuse the `confidence_threshold` app_setting, or a matcher-specific tunable? →
   propose a separate `match_confidence_threshold` (EDITOR-managed).
4. **Domain storage:** derive domain from the synced `contact_email` at query time, or normalize into a
   `master_domain` table (+ multiple domains per master)? → table if multi-domain matters; else derive.
5. **Where the endpoint's LLM-free scoring weights live:** hardcoded vs `app_settings`-tunable? → start
   hardcoded, expose later.

## 13. Testing strategy

- **Retrieval (track-system, unit + int):** pg_trgm returns the right candidates; domain-exact ranks top;
  region boosts; co-occurrence boosts; prior-alias is top rank; role constrains type. Deterministic, no LLM.
- **LLM disambiguation (cobalt-queue):** golden cases where signals conflict — name→A but domain+region→B must
  pick B; nothing-fits → `none`; trading-house → factory-group resolution; never returns a non-candidate code
  (schema-forced). Use a fixture candidate set + a stubbed/replayed model for determinism.
- **End-to-end:** an email whose party only resolves via domain/region (not name) matches correctly and
  auto-applies at high confidence; a low-confidence one lands in review; the correction promotes an alias fact
  that makes the next identical case deterministic.
- **Regression:** the existing deterministic exact-code path is unchanged and still wins first.

## 14. References (code + prior art)

- Masters + retrieval home: `backend/src/db/repositories/masters.repository.ts`, `backend/src/masters/`.
- Mesh sync (candidate source, extend in Phase 0): `backend/src/masters/mesh/`, `backend/src/db/sync-masters.ts`.
- Resolution facts + curator loop: `backend/src/masters/masters.controller.ts` (`/resolution*`, `/proposals`,
  `/curate`), `master_resolution` table, enum `MASTER_RESOLUTION_KIND`.
- Aliases/domain: `tracking.forwarder_aliases` (`aliasType` name|domain|chinese_name).
- Review + apply-back + locks: `backend/src/emails/review-queue.service.ts`,
  `backend/src/shipments/shipments.service.ts` (`applyExtractionCorrection`, `editFields`), `field_locks`.
- Commit-first ingest: `backend/src/decisions/`, `backend/src/reconcile/committer.service.ts`.
- Governance + philosophy: `AGENTS.md` "Master data"; memories `cobalt-master-data-governance`,
  `cobalt-mesh-masters-sync`, `cobalt-de-correction-principle`, `cobalt-queue-soul-iteration-map`.
```
