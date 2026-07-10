# All-AI Forwarder Resolution — extend the LLM Master Matcher seam to `forwarder` (Design)

Date: 2026-07-10 · Repos: cobalt-queue + cobalt_track_system · Status: approved (approach A)
Parent design: `2026-07-09-llm-master-matcher-design.md` (+ T-SQL re-spec `2026-07-10-master-matcher-tsql-respec.md`)

## 0. Context & goal

The LLM Master Matcher (Phases 0–3, all shipped 2026-07-10) resolves **customer/vendor** raw names via
retrieve-then-match: track `POST /api/masters/candidates` → one `MasterMatcherAgent` call → confident code
written back, otherwise raw → review. The architect's directive ("all AI") extends this to the last
deterministic party path: **forwarder**. Today a raw forwarder name skips the LLM entirely — the parser soul
resolves only its 8 embedded `FORWARDER_KEYS`; everything else lands raw on the decision and the track
committer links it with the 6-tier exactly-one-guarded `forwarderIdByName` (deterministic name matching).

**Decisions locked in brainstorm:**
- **Scope = forwarder only.** Consignee stays as-is: it has no code (name-only master), the committer performs
  NO deterministic consignee matching today, and it is already half-wired into the AI path (when
  `customer_code` is missing, `consignee_name` is fed to the customer resolution — `runner.ts`
  `unresolvedParties`). Resolving it could only rewrite the name → de-correction red line. YAGNI.
- **Approach A**: code write-back (consistent with customer/vendor) + demote the deterministic linker via
  shadow measurement, not immediate deletion.
- Ports stay deterministic (parent design §5, explicit keep — code system, not party resolution).

Track-side retrieval is ALREADY ready for this: `candidates.service.ts` serves `type:'forwarder'` (names +
`forwarder_aliases` name/domain rows) and the Phase-2 `cooccur:customer` boost already covers forwarders.
The gap is queue-side detection/write-back, plus a retrieval recall weakness for short master names.

## 1. Queue seam extension (`cobalt-queue`)

`src/matcher/runner.ts`:
- `UnresolvedParty.field` union gains `'forwarder_name'`.
- `unresolvedParties(rec)` gains: `f.forwarder_name` non-empty ∧ `!isKnownForwarderKey(f.forwarder_name)` →
  `{ kind: 'forwarder', rawName, field: 'forwarder_name' }`.
- `resolveGroupParties` needs NO structural change: candidates request (`type:'forwarder'`, name, emailDomain,
  `context.customerCode` → `cooccur:customer` boost), per-run cache key `forwarder|<RAW>`, retrieval-down
  degradation (raw stays → review), and the write-back block all apply as-is. At
  `confidence ≥ MASTER_MATCH_APPLY_CONFIDENCE` (0.75, unchanged) the matched master **code** is written to
  `fields.forwarder_name` + the existing LOW `needs_review` audit note (`llm master match '<raw>'→CODE …`).

`src/parser/master.ts` / `master-store.ts`:
- New `isKnownForwarderKey(v)`: membership in `FORWARDER_KEYS` (the 8 soul keys) ∪ the master-file/DB
  forwarder entry **codes** (`master.generated.json` `forwarders[].code`, both `type:'forwarder'` and
  `type:'carrier'` entries — any code the parser or a previous seam pass legitimately wrote is "resolved";
  a raw NAME never collides with a code in practice). Exposed as a live binding like
  `isKnownCustomerCode`/`isKnownVendorCode`, swapped by `applyMasters()`; SEED floor = `FORWARDER_KEYS` only.
  Uppercase-normalized comparison.

`prompts/cobalt-master-matcher.md`:
- Add a forwarder paragraph: the candidates are freight forwarders (HBL issuers) and carriers; a
  **portal/platform** (TradeLinkOne, CVP, CRSA) is NEVER a forwarder; a **carrier** (MBL line) is only correct
  when the reference is genuinely the carrier acting as forwarder; when the raw is a person/email display name,
  decision `none`. Same output contract (match/none + confidence + rationale) — no schema change.

Non-changes: `validate.ts` 4c platform scrub runs at parse time and is untouched (a scrubbed platform arrives
null → no seam call). `MasterMatchKind` already includes `'forwarder'`. Stub matcher behavior unchanged
(conservative: unique ≥0.95 or unique domain:exact, else none).

## 2. Track committer — code-first link + shadow-metered fuzzy tiers (`cobalt_track_system`)

`db/repositories/masters.repository.ts`:
- New `forwarderIdByCode(code)`: exact case-insensitive lookup on `forwarders.code`, **exactly-one-guarded**
  like every name tier — on 0 or >1 rows it returns null and resolution falls through to the name linker
  (the ERP key should be unique, but a duplicate must not resolve heap-order style).
- `forwarderIdByName` internals gain tier attribution: refactor to an internal
  `forwarderLinkByName(name): { id, tier } | null` where tier ∈
  `containment | norm_exact | stripped_norm_exact | alias_containment | org_token | reverse_containment |
  legal_form`. Public `forwarderIdByName` keeps its signature (wrapper) — no caller churn.

`reconcile/committer.service.ts`:
- `resolveForwarder(name)` becomes: `forwarderIdByCode(v) ?? forwarderLinkByName(v)`; when the link came from a
  **fuzzy tier** — anything except `forwarderIdByCode` / `norm_exact` / `stripped_norm_exact` — write an
  `audit.change_log` row with `changeType='shadow'`, `field='forwarder_link'`, note
  `fuzzy-tier <tier> linked '<raw>' → <forwarderId> — LLM path missed this name` (same mechanism as the
  de-correction (c) shadows; excluded from `listForEntity` history automatically).
- Measure: `select note, count(distinct entity_id) from audit.change_log where change_type='shadow' and
  field='forwarder_link' group by note`. **Deleting the fuzzy tiers is a follow-up gated on this going
  quiet** — NOT part of this change.
- `forwarderIdForVendorCode` (committer.service:143, the forwarder-as-vendor misclassification guard probe)
  is deliberately untouched.

No schema migration: `audit.change_log`/`changeType='shadow'` already exist; `forwarderIdByCode` reads an
existing column.

## 3. Retrieval recall fix — token signal (`cobalt_track_system` `masters/candidates.service.ts`)

Problem (recorded in TODO): trigram similarity fails on short master names — raw `DSV AIR AND SEA CO LTD` vs
master `DSV` scores < 0.3 → 0 candidates → the LLM never even sees the right answer.

Fix — a third name signal, `name:tokens`, additive alongside trigram + domain:
- Tokenize input and master name/aliases: uppercase, split on non-alphanumerics, drop legal-form/generic
  stopwords (`CO, LTD, LIMITED, INC, CORP, GMBH, AG, SA, PLC, COMPANY, INTERNATIONAL, LOGISTICS, EXPRESS,
  有限公司, 公司` — final list at implementation) and tokens shorter than 2 chars.
- Signal fires when the master's token set is non-empty ∧ (master tokens ⊆ input tokens, or Jaccard ≥ 0.5).
- Contributes a name-score of 0.6 (below a strong trigram hit, far above threshold) into the existing
  additive ranking; `signals` gains `name:tokens`. Applies to aliases identically. UNION recall — never
  filters existing candidates.
- This is retrieval, the parent design's sanctioned deterministic layer (§3/§5) — the LLM still makes every
  final call.

## 4. Verification (NO corpus re-parse)

- **Unit**: queue — `unresolvedParties` forwarder detection (known key skips, raw name triggers, code
  write-back at ≥0.75, none→raw-stays), `isKnownForwarderKey` seed/file tiers; track — `forwarderIdByCode`,
  tier attribution (fuzzy vs exact), shadow-row write, `name:tokens` (the DSV fixture: master `DSV` surfaces
  for raw `DSV AIR AND SEA CO LTD`).
- **Suites green** both repos (queue 705+ / track 634 backend + 198 frontend baselines).
- **Match-level before/after** (the Phase-0+1 measurement style): run `run-matcher` over existing evidence
  (deterministic re-match, not an LLM re-parse) and compare forwarder link counts + forwarder-related
  review reasons before/after the seam.
- **Live probe**: `MASTER_MATCHER=openpave` one-shot resolve of a real raw forwarder (e.g. a `DSV`-family
  name) against live candidates — needs the warm openpave server; if unavailable, verify the stub path
  end-to-end (conservative none → review) and record that the AI-path probe is pending.

## 5. Failure modes & rollout

All inherited from the proven customer/vendor seam: tracking API down → raw flows (→ review); LLM
timeout/failure → `none` → raw flows; `MASTER_MATCHER=stub` (default) never guesses. The write-back is
in-memory per matcher run (evidence keeps the raw value), so behavior is reversible by config alone.
Shadow rows quantify what the LLM path misses while the deterministic linker still guarantees links.

## 6. Out of scope

- Consignee resolution (decided against — see §0).
- Deleting `forwarderIdByName` fuzzy tiers (follow-up, gated on shadow-quiet).
- Carriers/SCAC (rule 6 — already shipped separately).
- Multi-domain table, semantic embeddings (parent design non-goals).

## 7. References

- Queue seam: `cobalt-queue/src/matcher/runner.ts` (45–137), `src/master-matcher/*`, `src/parser/master.ts`.
- Track retrieval: `backend/src/masters/candidates.service.ts`; linker:
  `backend/src/db/repositories/masters.repository.ts` (`forwarderIdByName` 181–~260).
- Committer: `backend/src/reconcile/committer.service.ts` (`resolveForwarder`, 491).
- De-correction staging pattern: TODO.md § "De-correction" (c); shadow mechanism PR #43.
