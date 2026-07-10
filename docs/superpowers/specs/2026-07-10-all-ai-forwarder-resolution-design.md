# All-AI Resolution — extend the LLM Master Matcher seam to `forwarder` + `port` (Design)

Date: 2026-07-10 · Repos: cobalt-queue + cobalt_track_system · Status: approved (approach A; v2 adds ports)
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
- **v2 — ports join the seam (user override of parent §5, with live evidence).** The parent design kept
  `portByCodeOrName` deterministic; the architect reports it matches the WRONG port at the code level. The
  failure modes are structural: the bare-IATA tier can collide (the HCM-vs-Somali-port class), `port_fragment`
  is a contains-match, the last-resort tier is a forward FUZZY name match — and the whole chain is
  **mode-blind** (Air vs Sea for the same city: SHANGHAI → CNSHA sea vs CNPVG air). The LLM path gets the
  group's `mode` as context and owns exactly this judgment. Exact-UN/LOCODE lookup stays (it is tier 1 and
  cannot be wrong); every non-exact tier gets shadow-metered like the forwarder linker.

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

**Ports (v2) — same seam, two more fields:**
- `UnresolvedParty.field` also gains `'pol' | 'pod'`; `MasterMatchKind` (queue) and `CandidateKind` (track)
  gain `'port'`.
- Detection: `f.pol` / `f.pod` non-empty ∧ NOT UN/LOCODE-shaped (`/^[A-Z]{2}[A-Z0-9]{3}$/` after
  uppercase-trim). A soul-resolved UN/LOCODE passes and is NEVER re-judged (the soul owns clear cases;
  wrong soul picks flow through review → `prior_correction`, not through a second LLM pass). A bare IATA
  (`PVG`), an abbreviation (`HCM`), or a raw name (`HO CHI MINH CITY`) all fail the shape test → seam.
- The matcher call for `kind:'port'` carries the record's **`mode`** in `context` (the whole point: Air →
  airport UN/LOCODE, Sea → seaport). Write-back at ≥ 0.75 puts the UN/LOCODE into `fields.pol`/`fields.pod`
  + the same LOW note. `pol`/`pod` are not match keys — no matchKeys interaction.
- Per-run cache key `port|<MODE>|<RAW>` (the same raw resolves differently by mode).

`prompts/cobalt-master-matcher.md` also gains a port paragraph: resolve by mode (Air → airport, Sea →
seaport); never a country or a warehouse address; when two ports share the fragment, prefer the candidate
whose signals (prior_correction, region) support it; `none` beats a guess.

Non-changes: `validate.ts` 4c platform scrub runs at parse time and is untouched (a scrubbed platform arrives
null → no seam call). Stub matcher behavior unchanged (conservative: unique ≥0.95 or unique domain:exact,
else none — for ports that means stub mostly defers to review, which is the safe default).

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

**Ports (v2) — shadow-meter the non-exact tiers, change nothing else:**
- `portByCodeOrName` already runs exact-UN/LOCODE FIRST — no new code tier needed. Refactor to attribute the
  tier (`unlocode_exact | abbreviation | iata | alias | fragment | fuzzy_name`), public signatures unchanged.
- `resolvePort`/`resolvePortFull` call sites write the same `audit.change_log` `changeType='shadow'` row
  (`field='port_link'`) whenever the link came from any tier EXCEPT `unlocode_exact` — measuring exactly the
  tiers that can mis-link (bare-IATA collision, fragment contains, fuzzy last resort). The curated-fact tiers
  (`port_abbreviation`/`port_alias`/`port_iata`) are included in the measurement: they are human-curated but
  their APPLICATION is mode-blind, which is part of what the user reports. Origin-country denormalization
  (`deriveOriginCountry` reads the resolved port's country) is unaffected.
- Deleting/trimming port tiers = the same follow-up, gated on the shadow going quiet.

**Learning loop (v2 catch — applies to forwarder AND port):** `review-queue.service.ts`
`recordPriorCorrections` currently persists `prior_correction` facts ONLY for `customer_code`/`vendor_code`.
Extend the field table with `forwarder_name` (new value must be a real forwarder code —
`forwarderIdByCode`) and `pol`/`pod` (new value must be a known UN/LOCODE — ports lookup). Without this,
human corrections of the two new kinds never feed the retrieval boost and the loop stays open.

No schema migration: `audit.change_log`/`changeType='shadow'` already exist; `forwarderIdByCode` reads an
existing column; `prior_correction` is an existing fact kind.

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

**Ports (v2) — `rowsFor('port')`:**
- Rows from the `ports` table: `code = unlocode`, `name`, `country` (column, else the locode's first two
  letters). Fold the curated `port_abbreviation`/`port_alias`/`port_iata` fact lhs values onto their rhs
  port as **aliases**, so the trigram/token/prior signals fire on `HCM`, spelling variants, and bare IATA
  codes exactly like forwarder aliases. `prior_correction` boost works unchanged (lhs raw → rhs unlocode).
- The `name:tokens` signal applies to ports for free ('HO CHI MINH CITY VIETNAM' ⊇ tokens of
  'HO CHI MINH').
- If the ports table carries an air/sea function tag, expose it on the candidate (the LLM honors mode);
  if not, the LLM falls back on world knowledge + the mode context — acceptable for MVP, no schema change.

## 4. Verification (NO corpus re-parse)

- **Unit**: queue — `unresolvedParties` forwarder + port detection (known key / UN/LOCODE shape skips, raw
  name / bare IATA / abbreviation triggers, code write-back at ≥0.75, none→raw-stays, port cache keyed by
  mode), `isKnownForwarderKey` seed/file tiers; track — `forwarderIdByCode`, tier attribution (fuzzy vs
  exact, forwarder AND port), shadow-row writes (`forwarder_link` + `port_link`), `name:tokens` (the DSV
  fixture: master `DSV` surfaces for raw `DSV AIR AND SEA CO LTD`; port fixture: `HO CHI MINH CITY` sees
  `VNSGN` among candidates), `rowsFor('port')` fact-alias folding, `recordPriorCorrections` for
  forwarder_name + pol/pod (raw→code only, code→code never).
- **Suites green** both repos (queue 705+ / track 634 backend + 198 frontend baselines).
- **Match-level before/after** (the Phase-0+1 measurement style): run `run-matcher` over existing evidence
  (deterministic re-match, not an LLM re-parse) and compare forwarder link counts + forwarder-related
  review reasons before/after the seam.
- **Live probe**: `MASTER_MATCHER=openpave` one-shot resolve of a real raw forwarder (e.g. a `DSV`-family
  name) AND a mode-sensitive port (`SHANGHAI` under Air → CNPVG, under Sea → CNSHA) against live
  candidates — needs the warm openpave server; if unavailable, verify the stub path end-to-end
  (conservative none → review) and record that the AI-path probe is pending.

## 5. Failure modes & rollout

All inherited from the proven customer/vendor seam: tracking API down → raw flows (→ review); LLM
timeout/failure → `none` → raw flows; `MASTER_MATCHER=stub` (default) never guesses. The write-back is
in-memory per matcher run (evidence keeps the raw value), so behavior is reversible by config alone.
Shadow rows quantify what the LLM path misses while the deterministic linker still guarantees links.

## 6. Out of scope

- Consignee resolution (decided against — see §0).
- Deleting `forwarderIdByName` fuzzy tiers / trimming `portByCodeOrName` non-exact tiers (follow-ups, each
  gated on its shadow going quiet).
- LLM re-judging soul-emitted UN/LOCODEs (the soul owns clear cases; wrong soul picks flow through review →
  `prior_correction` → the facts-triggered re-match, not a second LLM pass per email).
- Carriers/SCAC (rule 6 — already shipped separately).
- Multi-domain table, semantic embeddings (parent design non-goals).

## 7. References

- Queue seam: `cobalt-queue/src/matcher/runner.ts` (45–137), `src/master-matcher/*`, `src/parser/master.ts`.
- Track retrieval: `backend/src/masters/candidates.service.ts`; linker:
  `backend/src/db/repositories/masters.repository.ts` (`forwarderIdByName` 181–~260).
- Committer: `backend/src/reconcile/committer.service.ts` (`resolveForwarder`, 491).
- De-correction staging pattern: TODO.md § "De-correction" (c); shadow mechanism PR #43.
