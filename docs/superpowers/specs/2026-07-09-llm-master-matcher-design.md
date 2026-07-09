# LLM Master Matcher — Design (LLM-only resolution)

> **Status:** design, approved 2026-07-09. Supersedes the assumptions in `LLM-MASTER-MATCHER-SPEC.md`
> (repo root) per four shaping decisions (see §0). Ready for an implementation plan.
> **Repos:** track-system = `D:\cobalt_track_system` (deterministic truth-keeper, owns masters);
> cobalt-queue = `D:\cobalt-queue` (the LLM parser/matcher). Read `AGENTS.md` in both before starting.

---

## 0. Shaping decisions (locked)

Four decisions reshape the original spec. They are non-negotiable inputs to this design.

1. **Sequencing — B.** Build the LLM matcher first; delete deterministic name→code resolution in the
   *same* change. No regression window where no resolver exists. The LLM is the only resolver.
2. **Learning loop — D.** No deterministic fast-path, even a learned one. Human corrections feed back as
   (a) a **retrieval signal** that boosts a code as a *candidate* (the LLM still decides every time), and
   (b) **Iterator soul generalization** (Phase 3) that turns repeated corrections into soul rules. Both feed
   the LLM; neither bypasses it.
3. **Deletion scope — A (surgical).** Delete only name→code resolution. Keep structural extraction hygiene,
   port UN/LOCODE resolution, `master_resolution` **relationship** facts (human-curated business knowledge),
   and field-locks.
4. **Production reality.** Deterministic resolution was a crutch for weak models. Production now runs
   qwen + gpt-5-mini together (vision over email + masters); it can see and learn from the email directly.
   Deterministic resolution cannot keep up with ever-changing vendors/customers/forwarders — the system
   learns from scratch via the LLM + corrections.

**Consequence:** the spec's "exact code / exact-domain / prior-alias → skip the LLM" hybrid fast-path is
**gone**. The parser soul resolves clear cases inline (it sees the masters); every ambiguous/unresolved case
goes through retrieve-then-match. No deterministic name→code resolution anywhere.

---

## 1. Architecture & boundary

```
cobalt-queue (parser/matcher, LLM)                 track-system (deterministic, owns masters)
─────────────────────────────────                 ──────────────────────────────────────────
parser soul (qwen+gpt-5-mini, vision over email):
  extract party refs (name, domain, country, role, PO, brand)
  → clear cases: resolve to code directly in the soul
  → ambiguous/unresolved: carry as RAW (no deterministic fallback)
        │
        ▼
LLM Master Matcher (NEW, cobalt-queue):
  POST /api/masters/candidates  ──────────────────▶  multi-signal retrieval (SQL, pg_trgm, domain,
        │                                              region, prior-correction boost)
        ◀──────────────────────────────────────────  ← ranked candidates + attributes
        ▼
  LLM disambiguation (candidates + signals → {code|none|new, confidence, rationale})
        │
        ├─ high confidence → resolved code → evidence/decision as today
        └─ low confidence  → raw surfaces → review queue → human corrects
                                     │
                                     ▼
                       correction stored → retrieval signal (boosts that code next time)
                       + (Phase 3) Iterator generalizes into soul rules
```

**Boundary (unchanged from original spec):** track-system stays LLM-free (deterministic retrieval SQL);
the LLM lives in cobalt-queue. New cross-repo contract: `POST /api/masters/candidates`. The Agent VM reaches
track-system only through `TrackingClient` over HTTP — no shared DB.

**What's gone vs. the original spec:** the deterministic name→code fast-path (`resolveEntity`, SEED name
tables, synced-master name/domain indexes, `master_resolution` alias-kind facts). The LLM is the *only*
resolver.

**What's kept:** structural extraction hygiene in `validate.ts` (ID-label strip, PO trim, multi-value guard,
date sanity, placeholder/consignee-origin guards — extraction correctness, not resolution), port UN/LOCODE
resolution, `master_resolution` **relationship** facts (`customer_group`/`vendor_group`/`customer_role`/
`consignee_for_customer` — human-curated business knowledge), field-locks.

---

## 2. Data model & Phase 0 enrichment (track-system)

Phase 0 is **narrower than the original spec assumed** — verified against the actual schema:

- `vendors` — **already enriched**: `location` (country), `contactEmail`, `contactPhone` exist and are
  synced. No change.
- `forwarders` — domains already live in `forwarder_aliases` (`aliasType='domain'`). No change.
- `consignees` — have `address` text but no `country` column. Derive country at query time from address
  tokens (no schema change for MVP).
- **`customers` — the real gap.** Today `code` + `name` only. Mesh `mapCustomer` fetches `CountryName` +
  `Address` + `Email` but drops them.

**Phase 0 changes (customers-only):**

1. **Schema:** add `country` (text) + `contactEmail` (text) + `address` (text) to `customers`. Migration
   `0001` (append — production already on the `0000` baseline).
2. **Mesh sync:** extend `MeshCustomerRow` (`mesh.types.ts`) + `mapCustomer` (`mesh.client.ts`) to carry
   `country`/`contactEmail`/`address` (already fetched, just persist). Extend `MastersSyncService.
   syncCustomers` + `MastersSyncRepo` to compare/write the new fields.
3. **Backfill:** one sync run populates existing rows.
4. **Trigram search:** migration `CREATE EXTENSION IF NOT EXISTS pg_trgm;` + `GIN (name gin_trgm_ops)`
   indexes on `customers`/`vendors`/`forwarders`/`consignees` `.name`.

**No new tables for MVP** — domain derived from `contactEmail` at query time via the same `emailDomain()`
helper cobalt-queue already has. Single domain per customer is fine; the spec's `master_domain` table is
deferred to Phase 2 if multi-domain matters.

**Phase 0 is all track-system, no cobalt-queue change, no behavior change** — just enriching the masters the
future endpoint reads.

---

## 3. The retrieval endpoint — `POST /api/masters/candidates` (track-system, Phase 1)

Deterministic, LLM-free, recall-oriented. Pure + unit-testable like the existing `masters.repository`
methods; the controller is a thin wrapper.

**Request** (all optional except `type`):
```jsonc
{
  "type": "customer" | "vendor" | "forwarder" | "consignee",
  "name": "MACAU FUNG TAI LTD",
  "emailDomain": "macfun.com.hk",
  "country": "HK",
  "address": "…",
  "context": { "customerCode": "WYSE", "poNumbers": ["100-100209"], "brand": "…" },
  "limit": 12
}
```

**Response** — ranked, deduped candidates with the attributes the LLM reasons over:
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

**Retrieval = UNION of per-signal candidate sets, scored + ranked:**

| Signal | How (Phase 1 MVP) |
|---|---|
| name | `pg_trgm` similarity over `name` + alias values (GIN index, threshold ~0.3) |
| domain | exact/suffix match of `emailDomain` against: forwarder_aliases `domain`; `customers.contactEmail`/`vendors.contactEmail` derived domain. Exact domain = top rank. |
| region | boost (not filter) candidates whose `country` matches the input `country` |
| role | constrains the master TYPE searched (the `type` param) |
| prior correction | candidates from the correction store keyed on (name/domain → code) — top-rank boost |

**Phase 2 signals (deferred):** co-occurrence history (boost candidates linked to `context.customerCode`/
`poNumbers` via `shipment_pos`/`bookings`), brand→customer.

**Correction store (decision D):** reuse `master_resolution` in a **new role** — not as resolution
rules (those alias-kinds are deleted as resolution reads), but as the **prior-correction signal store**. A
new enum value `prior_correction` is added to `MASTER_RESOLUTION_KIND`. A human correction writes a row
(`kind: 'prior_correction'`, `lhs: name|domain`, `rhs: code`, `evidence: {context}`). Retrieval reads these
as a candidate boost (top rank). The LLM still makes the final call every time — no deterministic
fast-path. Reusing the table (not a new one) keeps it on the existing curator loop surface.

**Auth:** the endpoint is agent-consumed, on the same surface as `GET /api/masters/resolution` — ungated
read (the agent's Bearer token), like the existing `GET /resolution`.

---

## 4. LLM disambiguation — cobalt-queue (Phase 1)

Lives in cobalt-queue behind the existing agent contracts, same place `validate.ts` did resolution today.

**A new matcher agent** (mirroring the `ParserAgent`/`CriticAgent` seam): a `MasterMatcherAgent` with two
adapters — `openpave` (the live LLM on the warm server, `epm/gpt-5-mini-cobalt`) and `stub` (deterministic
fallback for tests, no model). Selected via a new `MASTER_MATCHER` env knob. The `openpave` adapter is
resilient: on unreachable/junk it degrades to "no match" (→ review), never a forced pick — the pipeline
never stalls.

**Input to the LLM:** the extracted reference + all its signals + the candidate list (attributes from §3) +
relevant business context (the shipment's `master_resolution` *relationship* facts, so the LLM can resolve
"trading house → its factory group").

**Output** (structured — forced via JSON schema/tool):
```jsonc
{
  "match": "MACFUN" | null,
  "decision": "match" | "none" | "new",
  "confidence": 0.0..1.0,
  "usedSignals": ["domain", "region", "name"],
  "rationale": "domain macfun.com.hk + HK region pin MACFUN over the name-similar MACFUL (Vietnam)"
}
```

**Prompt rules (baked into a soul prompt, `prompts/cobalt-master-matcher.md`):**
- Only pick from the provided candidates (or `none`/`new`) — never invent a code. Real-candidates-only is
  the anti-hallucination guarantee.
- Prefer candidates supported by **multiple independent signals** (domain + region beats a lone high name
  score).
- If nothing fits, `none` (→ review), never a forced pick.
- No value mappings in the prompt — they live in candidates/masters; the LLM reasons, doesn't memorize.

**Where it plugs in (the seam):** the matcher's `decision.ts`/`merge.ts` operate on `fields.customer_code`/
`fields.vendor_code`. Today those arrive already-resolved by `validate.ts`. After this change:
- The parser soul resolves *clear* cases inline (it sees masters via the existing master sync —
  `master-store.ts` keeps loading masters for the *parser's* inline use, just not for `validate.ts`'s deleted
  resolution indexes).
- *Ambiguous/unresolved* parties (raw name, no clean code) flow through to the matcher, which calls the
  retrieve-then-match flow and writes the resolved code back into `fields` before `merge.ts` runs.
  Low-confidence → raw surfaces → review (unchanged review path).

**Gate:** high confidence (≥ a new `match_confidence_threshold` app_setting, EDITOR-managed) → apply via the
existing `POST /api/decisions` path. Low → existing review queue.

---

## 5. The deletion — what dies in Phase 1 (decision A: surgical)

Removed in the same change that lands the LLM matcher, so there is no no-resolution gap.

**cobalt-queue (`src/parser/`):**
- `validate.ts`: delete `resolveEntity` + all name→code resolution calls (`vendor_code`, `customer_code`,
  consignee name→code). Keep structural hygiene (ID-label strip, PO trim, multi-value guard, date sanity,
  placeholder/consignee-origin guards) + `needs_review` audit trail.
- `master.ts` (SEED): delete the hardcoded name tables — `VENDOR_ALIASES`, `VENDOR_NAME_TO_CODE`,
  `VENDOR_NAME_MARKERS`, `CUSTOMER_NAME_TO_CODE`, `CUSTOMER_CANONICAL`, and the curated customer↔vendor/
  consignee name facts. Relationship facts (`customer_group`/`vendor_group`/`customer_role`) are NOT in
  SEED name tables — they come from `master_resolution`; they stay.
- `master-store.ts`: delete `nameIndexes`, `namePrefixIndex`, `domainIndex`, and the `vendorNameToCode`/
  `customerNameToCode`/`*NormToCode`/`*NormMulti`/`customerDomainToCode`/`vendorDomainToCode`/
  `customerNamePrefixToCodes` bindings. The parser soul still gets masters inline (code+name+country+email)
  for its own resolution — `loadMasters` keeps loading the *entity list*, just not the *resolution indexes*.
- `decision.ts`: the `customerResolvedFuzzy` flag — gone (no fuzzy resolution anymore; the LLM matcher's
  confidence replaces it).

**track-system (`master_resolution`):**
- Delete alias-kind facts as *resolution rules*: `vendor_alias`, `forwarder_ref`, `customer_canonical`,
  `vendor_name_marker`. The enum values stay (existing rows are audit history) but **nothing reads them for
  resolution anymore**. The retrieval endpoint doesn't consult them.
- Keep relationship-kind facts: `customer_group`, `vendor_group`, `customer_role`,
  `consignee_for_customer`, `customer_vendor` — human-curated business knowledge, served via
  `GET /api/masters/resolution` as today.
- The curator loop (`/proposals`, `/curate`, approve/reject) stays — it now manages *relationship* facts +
  the new *prior-correction* signal store, not alias resolution rules.

**What is NOT deleted** (explicitly, to prevent over-zealous removal):
- Structural extraction hygiene in `validate.ts`.
- Port UN/LOCODE resolution (`portByCodeOrName`) — deterministic, not party resolution.
- Field-locks (human-wins) — orthogonal to resolution.
- The `forwarder_aliases` `domain` rows — these become a *retrieval signal* for the new endpoint, not a
  resolution fast-path.
- The daily Mesh sync + cobalt-queue's own `master_entity` table — fresh masters feed both the parser soul
  and the retrieval endpoint.

**Verification standard:** per the cobalt-queue invariant, touching extraction quality requires
`pnpm bench` before AND after, reporting the recall/precision delta. The deletion + LLM matcher landing
together is one benchmarked change.

---

## 6. Phasing

- **Phase 0 — masters enrichment (track-system only, no behavior change):** add `country` + `contactEmail`
  + `address` to `customers`; extend Mesh `mapCustomer` + `MastersSyncService` to persist them; backfill via
  one sync run. Add `pg_trgm` extension + GIN trigram indexes on `customers`/`vendors`/`forwarders`/
  `consignees` `.name`. *No cobalt-queue change, no deletion.*
- **Phase 1 — MVP matcher + the deletion (both repos, one benchmarked change):**
  - track-system: `POST /api/masters/candidates` retrieval endpoint (name pg_trgm + domain + region + role +
    prior-correction boost); prior-correction store (decision D).
  - cobalt-queue: `MasterMatcherAgent` (`openpave` + `stub` adapters, `MASTER_MATCHER` knob) + soul prompt
    `prompts/cobalt-master-matcher.md`; plug into the matcher seam before `merge.ts`.
  - the deletion (§5): `resolveEntity` + SEED name tables + synced-master resolution indexes +
    `master_resolution` alias-kind resolution reads. One `pnpm bench` delta reported.
- **Phase 2 — richer signals + semantic:** co-occurrence/history boost (signal 6, via `shipment_pos`/
  `bookings`), brand→customer (signal 7); optional `pgvector` embeddings for semantic name matches trigram
  misses; tuned scoring; a `master_domain` table if multi-domain matters.
- **Phase 3 — automation:** Iterator generalizes domain/region/name corrections into soul rules (decision
  D's pattern-learning arm); scheduled re-matching of provisional legs as masters/facts improve.

Each phase is its own spec → plan → implement → benchmark cycle. **Phase 0 first** (no behavior change,
unblocks Phase 1's endpoint).

---

## 7. Non-goals (carried from original spec, still hold)

- Not replacing `master_resolution` **relationship** facts (groups/roles) — human-curated.
- Not writing to Mesh (masters stay ERP-owned, read-only).
- No LLM in track-system (retrieval is deterministic SQL; the LLM is cobalt-queue-side).
- Not matching `ports` (deterministic UN/LOCODE resolution is fine as-is).

## 8. Risks & mitigations

- **Hallucinated match** → candidates are real rows only; `none` option; confidence gate; review; field-locks.
- **Confident-but-wrong** → require multi-signal support for auto-apply; a single weak name match stays review.
- **Cost / latency** → the parser soul resolves clear cases inline (no LLM matcher call); the matcher only
  runs for genuinely ambiguous/unresolved parties.
- **Noisy learning** → prior-correction boosts go through retrieval (the LLM still decides), not auto-promoted
  resolution rules.
- **Region false-negatives** → country is a *boost*, not a hard filter.
- **Stale masters** → the daily Mesh sync keeps candidates fresh.

## 9. References (code)

- track-system masters + retrieval home: `backend/src/db/repositories/masters.repository.ts`,
  `backend/src/masters/`.
- Mesh sync (extend in Phase 0): `backend/src/masters/mesh/`, `backend/src/db/sync-masters.ts`.
- Resolution facts + curator loop: `backend/src/masters/masters.controller.ts`, `master_resolution` table,
  enum `MASTER_RESOLUTION_KIND`.
- Aliases/domain: `tracking.forwarder_aliases` (`aliasType` name|domain|chinese_name).
- cobalt-queue parser resolution (delete in Phase 1): `src/parser/validate.ts`, `src/parser/master.ts`,
  `src/parser/master-store.ts`, `src/parser/master-sync.ts`.
- cobalt-queue matcher seam (plug into): `src/matcher/decision.ts`, `src/critic/merge.ts`,
  `src/matcher/types.ts`, `src/matcher/tracking-client.ts`.
- Review + apply-back + locks (track-system): `backend/src/emails/review-queue.service.ts`,
  `backend/src/shipments/shipments.service.ts` (`applyExtractionCorrection`, `editFields`), `field_locks`.
