# All-AI Forwarder + Port Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route raw forwarder names and non-UN/LOCODE port values through the proven LLM Master Matcher seam (retrieve → LLM → code write-back at ≥0.75, else raw → review), demote the deterministic linkers to shadow-metered fallbacks, and close the prior_correction learning loop for both kinds.

**Architecture:** Two repos. Track-system first (retrieval + linker attribution + shadow + learning loop are foundations the queue seam consumes at runtime, but each task is independently unit-testable). Queue second (seam detection + write-back + soul). Spec: `docs/superpowers/specs/2026-07-10-all-ai-forwarder-resolution-design.md`.

**Tech Stack:** NestJS 11 + Kysely/SQL Server (track), plain TS + vitest (queue). Both use vitest; run bins per-package (root `.bin` is empty — build-infra gotcha).

## Global Constraints

- De-correction: NEVER rewrite a model value silently — write-back happens ONLY via the seam at conf ≥ 0.75 with a LOW audit note; unresolved raw values stay and surface in review.
- `MASTER_MATCH_APPLY_CONFIDENCE` stays `0.75`; stub matcher behavior unchanged.
- No corpus re-parse; no schema migration (all columns/enums exist).
- Track tests: int specs need the local `mssql-2022` container up (`test/setup-db.ts` auto-creates `cobalt_test`).
- Track repo branch: `feat/all-ai-forwarder-resolution` (spec already on it). Queue repo branch: create `feat/all-ai-forwarder-port-seam` from `main`.
- Commands below assume Git Bash on Windows; track backend cwd = `D:\cobalt_track_system\backend`, queue cwd = `D:\cobalt-queue`.
- The committer's `forwarderIdForVendorCode` guard probe (committer.service.ts:143) stays `forwarderIdByName` — deliberately untouched.

---

### Task 1: Track — `forwarderIdByCode` + tier-attributed `forwarderLinkByName` + `portIdByUnlocode`

**Files:**
- Modify: `backend/src/db/repositories/masters.repository.ts` (forwarder block ~181–308)
- Test: `backend/test/masters.kysely.int.spec.ts` (the file that pins the forwarder tiers)

**Interfaces:**
- Produces: `type ForwarderLinkTier = 'code_exact' | 'containment' | 'norm_exact' | 'stripped_norm_exact' | 'alias_containment' | 'org_token' | 'reverse_containment' | 'legal_form'`; `FUZZY_FORWARDER_TIERS: ReadonlySet<ForwarderLinkTier>`; `forwarderLinkByName(name): Promise<{ id: string; tier: ForwarderLinkTier } | null>`; `forwarderIdByCode(code): Promise<string | null>`; `portIdByUnlocode(code): Promise<string | null>`. Existing `forwarderIdByName(name)` keeps its `Promise<string | null>` signature (wrapper).

- [ ] **Step 1: Write the failing tests** — append to `backend/test/masters.kysely.int.spec.ts` (follow the file's existing setup: it already seeds forwarders + aliases and asserts tier behavior; reuse its repo instance/fixtures):

```ts
describe('forwarderIdByCode (exactly-one, case-insensitive)', () => {
  it('links an exact code and rejects unknown', async () => {
    // seed a forwarder with a distinct code the same way the surrounding tests seed rows
    const id = await seedForwarder({ code: 'DSVAIR', name: 'DSV AIR & SEA CO LTD' })
    expect(await repo.forwarderIdByCode('dsvair')).toBe(id)
    expect(await repo.forwarderIdByCode('NOPE99')).toBeNull()
    expect(await repo.forwarderIdByCode('')).toBeNull()
  })
})

describe('forwarderLinkByName tier attribution', () => {
  it('normalized-exact reports norm_exact; containment reports containment', async () => {
    const id = await seedForwarder({ code: 'LXP001', name: 'LX PANTOS LOGISTICS (SHENZHEN) CO. LTD' })
    const exact = await repo.forwarderLinkByName('LX PANTOS LOGISTICS (SHENZHEN) CO.,LTD.')
    expect(exact).toEqual({ id, tier: 'norm_exact' })
    const contained = await repo.forwarderLinkByName('PANTOS LOGISTICS (SHENZHEN)')
    expect(contained?.tier).toBe('containment')
  })
  it('forwarderIdByName wrapper still returns the bare id', async () => {
    const id = await seedForwarder({ code: 'WRAP01', name: 'WRAPPER TEST FORWARDER LIMITED' })
    expect(await repo.forwarderIdByName('WRAPPER TEST FORWARDER LIMITED')).toBe(id)
  })
})

describe('portIdByUnlocode (strict shape + exact)', () => {
  it('resolves only a real UN/LOCODE', async () => {
    // ports are seeded by the suite's fixture load (CNSHK exists); adapt to the file's port seeding
    expect(await repo.portIdByUnlocode('CNSHK')).toBeTruthy()
    expect(await repo.portIdByUnlocode('SHEKOU')).toBeNull() // not UN/LOCODE-shaped
    expect(await repo.portIdByUnlocode('XXXXX')).toBeNull() // shaped but absent
  })
})
```

If the spec file has no `seedForwarder` helper, inline the insert the way its existing forwarder tests do (copy the surrounding pattern verbatim — do not invent a new fixture style).

- [ ] **Step 2: Run to verify failure**

Run: `cd /d/cobalt_track_system/backend && ./node_modules/.bin/vitest run test/masters.kysely.int.spec.ts`
Expected: FAIL — `forwarderIdByCode is not a function` / `forwarderLinkByName is not a function` / `portIdByUnlocode is not a function`.

- [ ] **Step 3: Implement in `masters.repository.ts`**

Above the forwarder block add:

```ts
export type ForwarderLinkTier =
  | 'code_exact'
  | 'containment'
  | 'norm_exact'
  | 'stripped_norm_exact'
  | 'alias_containment'
  | 'org_token'
  | 'reverse_containment'
  | 'legal_form'

/** Tiers that can mis-link (spec §2): everything except code/normalized-exact. Shadow-metered by the committer. */
export const FUZZY_FORWARDER_TIERS: ReadonlySet<ForwarderLinkTier> = new Set([
  'containment', 'alias_containment', 'org_token', 'reverse_containment', 'legal_form',
])
```

Add `forwarderIdByCode` + `portIdByUnlocode`:

```ts
/** Exact, case-insensitive forwarder CODE lookup — exactly-one-guarded like every name tier (a duplicate
 *  code must not resolve heap-order style). The fast path for LLM-matcher write-backs. */
async forwarderIdByCode(code: string): Promise<string | null> {
  const c = code.trim().toUpperCase()
  if (!c) return null
  const hits = await this.db
    .selectFrom('forwarders')
    .select(['id', 'code'])
    .execute()
  const match = hits.filter((f) => (f.code ?? '').trim().toUpperCase() === c)
  return match.length === 1 ? match[0]!.id : null
}

/** Strict UN/LOCODE-only port lookup (no tiers) — used by the prior_correction validator. */
async portIdByUnlocode(code: string): Promise<string | null> {
  const c = code.trim().toUpperCase()
  if (!/^[A-Z]{2}[A-Z0-9]{3}$/.test(c)) return null
  const r = await this.db.selectFrom('ports').select('id').where('unlocode', '=', c).executeTakeFirst()
  return r?.id ?? null
}
```

(Full-scan-then-filter matches the file's existing pattern — `forwarderIdByName` already loads all forwarders per call; the ERP mirror is a few hundred rows.)

Rename the body of `forwarderIdByName` to `forwarderLinkByName` returning `{ id, tier }`; each existing `return <id>` becomes a tiered return:

```ts
async forwarderLinkByName(name: string): Promise<{ id: string; tier: ForwarderLinkTier } | null> {
  // ... existing body, with each return point wrapped:
  // containment stage:            return { id: contained[0]!.id, tier: 'containment' }
  // byNorm(norm) hit:             return { id: normHit, tier: 'norm_exact' }
  // byNorm(strippedNorm) hit:     return { id: hit, tier: 'stripped_norm_exact' }
  // alias containment:            return { id: aliasContained[0]!.forwarderId, tier: 'alias_containment' }
  // org-token (tokenResolved):    return { id: tokenResolved, tier: 'org_token' }
  // reverse-containment:          return { id: rc.id, tier: 'reverse_containment' }
  // legal-form fold:              return { id: hits[0]!.id, tier: 'legal_form' }
  // final:                        return null
}

async forwarderIdByName(name: string): Promise<string | null> {
  return (await this.forwarderLinkByName(name))?.id ?? null
}
```

Note: `byNorm` is used by both the plain and the stripped retry AND inside the org-token loop — it returns a bare id; the TIER is assigned at each call site (plain → `norm_exact`, stripped → `stripped_norm_exact`, inside org-token → the whole stage is `org_token`). Do not change `byNorm` itself.

- [ ] **Step 4: Run tests to verify pass**

Run: `cd /d/cobalt_track_system/backend && ./node_modules/.bin/vitest run test/masters.kysely.int.spec.ts`
Expected: PASS (including all pre-existing tier-pinning tests — the refactor must not change any linking behavior).

- [ ] **Step 5: Commit**

```bash
cd /d/cobalt_track_system && git add backend/src/db/repositories/masters.repository.ts backend/test/masters.kysely.int.spec.ts && git commit -m "feat(masters): forwarderIdByCode + tier-attributed forwarderLinkByName + portIdByUnlocode"
```

---

### Task 2: Track — tier-attributed `portLinkByCodeOrName`

**Files:**
- Modify: `backend/src/db/repositories/masters.repository.ts` (port block ~310–390)
- Test: `backend/test/port-resolver.int.spec.ts`

**Interfaces:**
- Produces: `type PortLinkTier = 'unlocode_exact' | 'abbreviation' | 'iata' | 'alias' | 'fragment' | 'fuzzy_name'`; `portLinkByCodeOrName(code): Promise<{ id: string; country: string | null; tier: PortLinkTier } | null>`. Existing `portByCodeOrName` / `portIdByCodeOrName` keep their signatures (wrappers).

- [ ] **Step 1: Write the failing tests** — append to `backend/test/port-resolver.int.spec.ts`, reusing its seeded ports/facts fixtures:

```ts
describe('portLinkByCodeOrName tier attribution', () => {
  it('exact UN/LOCODE reports unlocode_exact', async () => {
    const link = await repo.portLinkByCodeOrName('CNSHK')
    expect(link?.tier).toBe('unlocode_exact')
  })
  it('an abbreviation fact reports abbreviation (HCM → VNSGN)', async () => {
    const link = await repo.portLinkByCodeOrName('HCM')
    expect(link?.tier).toBe('abbreviation')
  })
  it('a bare 3-letter IATA reports iata', async () => {
    const link = await repo.portLinkByCodeOrName('PVG')
    expect(link?.tier).toBe('iata')
  })
  it('portByCodeOrName wrapper is unchanged (id + country only)', async () => {
    const port = await repo.portByCodeOrName('CNSHK')
    expect(port).toHaveProperty('id')
    expect(port).toHaveProperty('country')
    expect(port).not.toHaveProperty('tier')
  })
})
```

Adapt the seeded values to what the file actually loads (it pins HCM→VNSGN and IATA behavior already — reuse those rows; if a case lacks a seeded row, seed it the way the file's other tests do).

- [ ] **Step 2: Run to verify failure**

Run: `cd /d/cobalt_track_system/backend && ./node_modules/.bin/vitest run test/port-resolver.int.spec.ts`
Expected: FAIL — `portLinkByCodeOrName is not a function`.

- [ ] **Step 3: Implement** — rename the body of `portByCodeOrName` to `portLinkByCodeOrName`; each return point gains its tier:

```ts
export type PortLinkTier = 'unlocode_exact' | 'abbreviation' | 'iata' | 'alias' | 'fragment' | 'fuzzy_name'

async portLinkByCodeOrName(code: string): Promise<{ id: string; country: string | null; tier: PortLinkTier } | null> {
  // ... existing body:
  // byUnlocode(c) direct hit:        return { ...byCode, tier: 'unlocode_exact' }
  // abbreviation fact hit:           return { ...a, tier: 'abbreviation' }
  // iata COLUMN lookup hit:          return { id: byIata.id, country: byIata.country, tier: 'iata' }
  // port_alias fact hit:             return { ...a, tier: 'alias' }
  // port_iata fact hit:              return { ...a, tier: 'iata' }   // both IATA routes tag 'iata'
  // port_fragment hit:               return { ...a, tier: 'fragment' }
  // the trailing fuzzy name match:   return { ..., tier: 'fuzzy_name' }
  // final:                           return null
}

async portByCodeOrName(code: string): Promise<{ id: string; country: string | null } | null> {
  const l = await this.portLinkByCodeOrName(code)
  return l ? { id: l.id, country: l.country } : null
}
```

`portIdByCodeOrName` already delegates to `portByCodeOrName` — no change.

- [ ] **Step 4: Run to verify pass**

Run: `cd /d/cobalt_track_system/backend && ./node_modules/.bin/vitest run test/port-resolver.int.spec.ts`
Expected: PASS (all pre-existing port-resolver tests still green — behavior identical, only attribution added).

- [ ] **Step 5: Commit**

```bash
cd /d/cobalt_track_system && git add backend/src/db/repositories/masters.repository.ts backend/test/port-resolver.int.spec.ts && git commit -m "feat(masters): tier-attributed portLinkByCodeOrName (unlocode_exact..fuzzy_name)"
```

---

### Task 3: Track — committer code-first forwarder link + fuzzy-tier shadow rows

**Files:**
- Modify: `backend/src/reconcile/committer.service.ts` (resolve helpers ~487–502; the `Promise.all` at ~124–133)
- Test: `backend/test/committer.int.spec.ts`

**Interfaces:**
- Consumes: Task 1 `forwarderIdByCode`/`forwarderLinkByName`/`FUZZY_FORWARDER_TIERS`; Task 2 `portLinkByCodeOrName`.
- Produces: shadow rows `field='forwarder_link'` / `field='port_link'` in `audit.change_log` (`changeType='shadow'`), riding the existing `shadows` array → `writeShadow` path.

- [ ] **Step 1: Write the failing int test** — append to `backend/test/committer.int.spec.ts` (reuse its decision-ingest fixture helpers):

```ts
describe('resolution shadow rows (all-AI spec §2)', () => {
  it('a fuzzy-tier forwarder link writes a forwarder_link shadow; exact does not', async () => {
    // fixture A: forwarder_name that only links via containment (seed 'EXPEDITORS KOREA LTD',
    // send 'EXPEDITORS KOREA') → expect one change_log row changeType='shadow', field='forwarder_link'
    // fixture B: forwarder_name equal to the master code (code_exact) → expect NO forwarder_link shadow
  })
  it('a non-exact port link writes a port_link shadow; exact UN/LOCODE does not', async () => {
    // fixture A: pol='HCM' (abbreviation fact) → one shadow row field='port_link' whose note contains 'abbreviation'
    // fixture B: pol='CNSHK' → no port_link shadow
  })
})
```

Write the fixtures with the file's existing `ingest(decision)` helper (it already posts decisions and asserts `change_log` rows for the de-correction shadows — copy that assertion pattern: `db.selectFrom('changeLog').where('changeType','=','shadow').where('field','=','forwarder_link')…`).

- [ ] **Step 2: Run to verify failure**

Run: `cd /d/cobalt_track_system/backend && ./node_modules/.bin/vitest run test/committer.int.spec.ts`
Expected: FAIL — no shadow rows found (0 rows where 1 expected).

- [ ] **Step 3: Implement in `committer.service.ts`**

Import the new types:

```ts
import { FUZZY_FORWARDER_TIERS, type ForwarderLinkTier, type PortLinkTier } from '../db/repositories/masters.repository'
```

Replace the three private helpers (keep `resolveCustomer`/`resolveVendor` untouched):

```ts
private async resolveForwarderLink(name: unknown): Promise<{ id: string | null; tier: ForwarderLinkTier | null }> {
  const n = str(name)
  if (!n) return { id: null, tier: null }
  const byCode = await this.masters.forwarderIdByCode(n)
  if (byCode) return { id: byCode, tier: 'code_exact' }
  const link = await this.masters.forwarderLinkByName(n)
  return link ?? { id: null, tier: null }
}
private async resolvePortLink(code: unknown): Promise<{ id: string; country: string | null; tier: PortLinkTier } | null> {
  const c = str(code)
  return c ? this.masters.portLinkByCodeOrName(c) : null
}
```

Update the `Promise.all` block (~124):

```ts
const [customerId, vendorId, forwarderLink, polLink, podLink] = await Promise.all([
  this.resolveCustomer(f.customer_code),
  this.resolveVendor(f.vendor_code),
  this.resolveForwarderLink(f.forwarder_name),
  this.resolvePortLink(f.poi ?? (f as Record<string, unknown>).pol), // POL: id + country (origin_country); alias: parser still emits `pol`
  this.resolvePortLink(f.pod),
])
const forwarderId = forwarderLink.id
const polId = polLink?.id ?? null
const podId = podLink?.id ?? null
const originCountry = polLink?.country ?? null // resolved-port country only; no code-side guessing from a raw POL

// all-AI spec §2 — shadow-meter the deterministic linkers: a link the LLM path did not produce
// (fuzzy forwarder tier / non-exact port tier) is recorded WITHOUT changing behavior; deleting the
// tiers is a follow-up gated on these going quiet.
if (forwarderLink.id && forwarderLink.tier && FUZZY_FORWARDER_TIERS.has(forwarderLink.tier))
  shadows.push({ field: 'forwarder_link', oldValue: str(f.forwarder_name), newValue: forwarderLink.id, note: `fuzzy-tier ${forwarderLink.tier} linked — LLM path missed this name` })
if (polLink && polLink.tier !== 'unlocode_exact')
  shadows.push({ field: 'port_link', oldValue: str(f.poi ?? (f as Record<string, unknown>).pol), newValue: polLink.id, note: `port tier ${polLink.tier} linked — LLM path missed this value` })
if (podLink && podLink.tier !== 'unlocode_exact')
  shadows.push({ field: 'port_link', oldValue: str(f.pod), newValue: podLink.id, note: `port tier ${podLink.tier} linked — LLM path missed this value` })
```

`podId` was previously the bare `resolvePort` result — check the downstream use (`legValues`/`podId` reference) and keep the same variable names the file uses. The `shadows` array + `writeShadow` flush already exist (c1/c2 pattern) — no new plumbing.

Delete the now-unused `resolveForwarder`/`resolvePort`/`resolvePortFull` helpers (replaced above); run `./node_modules/.bin/tsc --noEmit -p tsconfig.json` to catch any other caller.

- [ ] **Step 4: Run to verify pass**

Run: `cd /d/cobalt_track_system/backend && ./node_modules/.bin/vitest run test/committer.int.spec.ts && ./node_modules/.bin/tsc --noEmit -p tsconfig.json`
Expected: PASS + clean tsc.

- [ ] **Step 5: Commit**

```bash
cd /d/cobalt_track_system && git add backend/src/reconcile/committer.service.ts backend/test/committer.int.spec.ts && git commit -m "feat(committer): code-first forwarder link + shadow-metered fuzzy forwarder/port tiers"
```

---

### Task 4: Track — candidates `name:tokens` signal + `port` kind

**Files:**
- Modify: `backend/src/masters/trigram.ts`, `backend/src/masters/candidates.service.ts`, `backend/src/masters/dto.ts:63-71`
- Test: `backend/src/masters/trigram.spec.ts`, plus the candidates coverage where the service's existing tests live (`backend/src/masters/masters.spec.ts` — if candidates tests are elsewhere, follow them)

**Interfaces:**
- Consumes: `MastersRepository.listPorts()` (existing), `listResolution('approved')` (existing).
- Produces: `tokenMatch(input, master): boolean` (trigram.ts); `CandidateKind` includes `'port'`; `Candidate` gains `mode?: string | null`; port candidates carry `code=unlocode`, `aliases` = port_* fact lhs values + the iata column.

- [ ] **Step 1: Write the failing tests**

`backend/src/masters/trigram.spec.ts` — append:

```ts
import { tokenMatch } from './trigram'

describe('tokenMatch (name:tokens recall signal)', () => {
  it('short master name inside a long raw (the DSV case)', () => {
    expect(tokenMatch('DSV AIR AND SEA CO LTD', 'DSV')).toBe(true)
  })
  it('legal-form stopwords are ignored', () => {
    expect(tokenMatch('MAERSK LOGISTICS COMPANY LIMITED', 'MAERSK LOGISTICS')).toBe(true)
  })
  it('does not fire on disjoint names or stopword-only overlap', () => {
    expect(tokenMatch('KUEHNE NAGEL LTD', 'DSV')).toBe(false)
    expect(tokenMatch('GLOBAL CO LTD', 'PACIFIC COMPANY LIMITED')).toBe(false)
  })
  it('CJK names tokenize (公司 dropped as a stopword)', () => {
    expect(tokenMatch('广州保迅诺物流有限公司', '广州保迅诺物流')).toBe(true)
  })
})
```

Candidates spec (same file as existing CandidatesService tests) — add:

```ts
it("kind='port' surfaces ports with fact-lhs aliases + iata, and mode rides the candidate", async () => {
  // repo stub: listPorts → [{ unlocode:'VNSGN', name:'Ho Chi Minh City', country:'Vietnam', mode:'sea', iata:'SGN' }]
  // listResolution('approved') → [{ kind:'port_abbreviation', lhs:'HCM', rhs:'VNSGN', ... }]
  const { candidates } = await svc.candidates({ type: 'port', name: 'HO CHI MINH' })
  const sgn = candidates.find((c) => c.code === 'VNSGN')
  expect(sgn).toBeTruthy()
  expect(sgn!.mode).toBe('sea')
  expect(sgn!.aliases).toContain('HCM')
  expect(sgn!.aliases).toContain('SGN')
})

it('name:tokens rescues a short master name (DSV)', async () => {
  // repo stub: listForwarders → [{ id:'f1', code:'DSV001', name:'DSV' }], listForwarderAliases → []
  const { candidates } = await svc.candidates({ type: 'forwarder', name: 'DSV AIR AND SEA CO LTD' })
  expect(candidates.some((c) => c.code === 'DSV001' && c.signals.includes('name:tokens'))).toBe(true)
})
```

(Stub the repository the way the file's existing candidates tests stub it; if no candidates tests exist yet in `masters.spec.ts`, create `backend/src/masters/candidates.service.spec.ts` with a hand-rolled `MastersRepository` stub object exposing only the methods used.)

- [ ] **Step 2: Run to verify failure**

Run: `cd /d/cobalt_track_system/backend && ./node_modules/.bin/vitest run src/masters`
Expected: FAIL — `tokenMatch` not exported; port kind rejected/`rowsFor` falls into the consignee branch.

- [ ] **Step 3: Implement**

`trigram.ts` — append:

```ts
/** Legal-form / generic tokens carrying no identity — excluded from the token-overlap signal. */
const NAME_STOPWORDS = new Set([
  'CO', 'COMPANY', 'LTD', 'LIMITED', 'INC', 'INCORPORATED', 'LLC', 'CORP', 'CORPORATION',
  'GMBH', 'AG', 'SA', 'PLC', 'PTE', 'PVT', 'SDN', 'BHD', 'THE', 'AND', '&',
  '有限公司', '公司',
])

export function nameTokens(s: string): Set<string> {
  const out = new Set<string>()
  for (const t of s.toUpperCase().replace(/[^A-Z0-9一-鿿]+/g, ' ').trim().split(/\s+/)) {
    if (t.length >= 2 && !NAME_STOPWORDS.has(t)) out.add(t)
  }
  return out
}

/** Token-overlap recall signal (all-AI spec §3): master tokens ⊆ input tokens, or Jaccard ≥ 0.5.
 *  Rescues short master names ('DSV') that trigram similarity under-scores against long raws. */
export function tokenMatch(input: string, master: string): boolean {
  const a = nameTokens(input)
  const b = nameTokens(master)
  if (!a.size || !b.size) return false
  let inter = 0
  for (const t of b) if (a.has(t)) inter++
  if (inter === b.size) return true
  return inter / (a.size + b.size - inter) >= 0.5
}
```

`candidates.service.ts`:
1. `export type CandidateKind = 'customer' | 'vendor' | 'forwarder' | 'consignee' | 'port'`
2. `Candidate` + `MasterRow` gain `mode?: string | null` (pass through in the scored push).
3. Import `tokenMatch`; in the scoring loop, after the trigram block:

```ts
if (inputName && nameScore === 0) {
  const tokenHit = tokenMatch(inputName, r.name) || r.aliases.some((a) => tokenMatch(inputName, a))
  if (tokenHit) {
    nameScore = 0.6
    signals.push('name:tokens')
  }
}
```

4. `rowsFor` — add before the consignee `else`:

```ts
} else if (kind === 'port') {
  const [ports, facts] = await Promise.all([this.repo.listPorts(), this.repo.listResolution('approved')])
  const aliasesByUloc = new Map<string, string[]>()
  for (const f of facts) {
    if (!f.rhs) continue
    if (f.kind === 'port_abbreviation' || f.kind === 'port_alias' || f.kind === 'port_iata' || f.kind === 'port_fragment') {
      const u = String(f.rhs).toUpperCase()
      const slot = aliasesByUloc.get(u) ?? []
      slot.push(f.lhs)
      aliasesByUloc.set(u, slot)
    }
  }
  rows = ports.map((p) => ({
    code: p.unlocode, name: p.name, type: 'port' as const, country: p.country, mode: p.mode,
    domains: [],
    aliases: [...(aliasesByUloc.get(p.unlocode.toUpperCase()) ?? []), ...(p.iata ? [p.iata] : [])],
  }))
}
```

`dto.ts` — widen:

```ts
@IsIn(['customer', 'vendor', 'forwarder', 'consignee', 'port']) type!: 'customer' | 'vendor' | 'forwarder' | 'consignee' | 'port'
```

- [ ] **Step 4: Run to verify pass**

Run: `cd /d/cobalt_track_system/backend && ./node_modules/.bin/vitest run src/masters && ./node_modules/.bin/tsc --noEmit -p tsconfig.json`
Expected: PASS + clean tsc.

- [ ] **Step 5: Commit**

```bash
cd /d/cobalt_track_system && git add backend/src/masters && git commit -m "feat(candidates): port kind (facts folded as aliases, mode on the candidate) + name:tokens recall signal"
```

---

### Task 5: Track — `recordPriorCorrections` covers forwarder_name + pol/pod

**Files:**
- Modify: `backend/src/emails/review-queue.service.ts:95-124`
- Test: `backend/test/review-queue.int.spec.ts` (already covers the customer/vendor prior_correction path — extend it)

**Interfaces:**
- Consumes: Task 1 `forwarderIdByCode`, `portIdByUnlocode`.
- Produces: `prior_correction` facts for `forwarder_name` / `pol` / `pod` raw→code corrections (same supersede-on-same-raw, never-throws semantics).

- [ ] **Step 1: Write the failing test** (in the located spec, following its fixture style):

```ts
it('a forwarder raw→code correction writes a prior_correction fact', async () => {
  // original extractedData: { forwarder_name: 'DSV AIR AND SEA' }, corrected: { forwarder_name: 'DSV001' }
  // where DSV001 IS a seeded forwarder code → expect an active prior_correction fact lhs='DSV AIR AND SEA', rhs='DSV001'
})
it('a pol raw→UN/LOCODE correction writes a fact; code→code does not', async () => {
  // original { pol: 'HO CHI MINH' } corrected { pol: 'VNSGN' } → fact lhs='HO CHI MINH' rhs='VNSGN'
  // original { pol: 'CNSHK' } corrected { pol: 'CNYTN' } → NO fact (old value is already a code)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /d/cobalt_track_system/backend && ./node_modules/.bin/vitest run test/review-queue.int.spec.ts`
Expected: FAIL (no facts written for the new fields).

- [ ] **Step 3: Implement** — replace the `fields` table in `recordPriorCorrections`:

```ts
const fields: Array<[string, (code: string) => Promise<unknown>]> = [
  ['customer_code', (c) => this.masters.customerByCode(c)],
  ['vendor_code', (c) => this.masters.vendorIdByCode(c)],
  // all-AI spec (v2): forwarder + port corrections must feed the retrieval boost too,
  // else the learning loop stays open for the two new kinds.
  ['forwarder_name', (c) => this.masters.forwarderIdByCode(c)],
  ['pol', (c) => this.masters.portIdByUnlocode(c)],
  ['pod', (c) => this.masters.portIdByUnlocode(c)],
]
```

The loop body (old-not-code ∧ new-is-code gate, supersede, insert, never-throw) is unchanged and applies verbatim to the new rows.

- [ ] **Step 4: Run to verify pass**

Run: `cd /d/cobalt_track_system/backend && ./node_modules/.bin/vitest run test/review-queue.int.spec.ts && ./node_modules/.bin/tsc --noEmit -p tsconfig.json`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /d/cobalt_track_system && git add backend/src/emails backend/test && git commit -m "feat(review): prior_correction facts for forwarder_name + pol/pod corrections"
```

---

### Task 6: Queue — `isKnownForwarderKey` membership

**Files:**
- Modify: `src/parser/master.ts` (Masters interface ~37-51, SEED ~73-86, live bindings ~90-98, applyMasters ~167-175), `src/parser/master-store.ts` (`buildMastersFrom` ~63-90, `overlayDbFacts` return ~142)
- Test: Create `src/parser/known-forwarder.test.ts`

**Interfaces:**
- Produces: `Masters.forwarderCodes: Set<string>`; `isKnownForwarderKey(v: unknown): boolean` — exported from `src/parser/master.ts`, uppercase-trim membership over `FORWARDER_KEYS` ∪ loaded forwarder/carrier codes.

- [ ] **Step 1: Write the failing test** — `src/parser/known-forwarder.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { applyMasters, isKnownForwarderKey, SEED } from './master.js'

afterEach(() => applyMasters(SEED))

describe('isKnownForwarderKey', () => {
  it('SEED floor = the 8 static FORWARDER_KEYS', () => {
    expect(isKnownForwarderKey('LOGIMARK')).toBe(true)
    expect(isKnownForwarderKey('logimark ')).toBe(true) // upTrim
    expect(isKnownForwarderKey('DSV AIR AND SEA')).toBe(false)
    expect(isKnownForwarderKey('')).toBe(false)
    expect(isKnownForwarderKey(null)).toBe(false)
  })
  it('applyMasters overlays loaded codes', () => {
    applyMasters({ ...SEED, forwarderCodes: new Set([...SEED.forwarderCodes, 'DSV001']) })
    expect(isKnownForwarderKey('DSV001')).toBe(true)
    expect(isKnownForwarderKey('FAIRATE')).toBe(true) // seed keys ride inside the set
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /d/cobalt-queue && ./node_modules/.bin/vitest run src/parser/known-forwarder.test.ts`
Expected: FAIL — `isKnownForwarderKey` not exported / `forwarderCodes` missing on Masters.

- [ ] **Step 3: Implement**

`master.ts`:

```ts
export interface Masters {
  // ...existing fields...
  /** forwarder master KEYS/codes (soul FORWARDER_KEYS ∪ the loaded forwarder+carrier entry codes) —
   *  membership only: "is this forwarder_name value already a resolved key?" (the matcher seam skips these). */
  forwarderCodes: Set<string>
}
// SEED gains (note: FORWARDER_KEYS is declared BELOW SEED today — move the FORWARDER_KEYS const ABOVE SEED):
forwarderCodes: new Set<string>(FORWARDER_KEYS),
// live binding + swap:
export let FORWARDER_CODES: Set<string> = SEED.forwarderCodes
// in applyMasters(): FORWARDER_CODES = m.forwarderCodes
// membership check (beside isKnownCustomerCode/isKnownVendorCode):
export function isKnownForwarderKey(v: unknown): boolean {
  const s = upTrim(v)
  return !!s && FORWARDER_CODES.has(s)
}
```

`master-store.ts` — in `buildMastersFrom`, beside the carrierScac build:

```ts
const forwarderCodes = new Set<string>(SEED.forwarderCodes)
for (const f of g.forwarders ?? []) if (f.code) forwarderCodes.add(up(f.code))
```

…and include `forwarderCodes` in the returned object; in `overlayDbFacts`'s return add `forwarderCodes: base.forwarderCodes`.

- [ ] **Step 4: Run to verify pass**

Run: `cd /d/cobalt-queue && ./node_modules/.bin/vitest run src/parser/known-forwarder.test.ts && ./node_modules/.bin/tsc --noEmit`
Expected: PASS + clean tsc (the compiler enforces `forwarderCodes` at every `Masters` literal — fix any test fixtures it flags by spreading SEED).

- [ ] **Step 5: Commit**

```bash
cd /d/cobalt-queue && git add src/parser/master.ts src/parser/master-store.ts src/parser/known-forwarder.test.ts && git commit -m "feat(masters): isKnownForwarderKey membership (seed keys ∪ loaded forwarder/carrier codes)"
```

---

### Task 7: Queue — seam detection + write-back for forwarder + ports

**Files:**
- Modify: `src/master-matcher/types.ts` (kind ~9, MasterCandidate ~13-24, MasterMatchInput ~43-53), `src/matcher/runner.ts` (seam block 45–137)
- Test: Create `src/matcher/master-match-seam.test.ts`

**Interfaces:**
- Consumes: Task 6 `isKnownForwarderKey`.
- Produces: `MasterMatchKind` includes `'port'`; `MasterCandidate.mode?: string | null`; `MasterMatchInput.context` gains `mode?: string`; `UnresolvedParty.field` covers `'forwarder_name' | 'pol' | 'pod'`; port cache key `port|<MODE>|<RAW>`.

- [ ] **Step 1: Write the failing test** — `src/matcher/master-match-seam.test.ts`. Build minimal `MatcherRecord`s (shape: `src/matcher/types.ts:8` — `graphMessageId/conversationId/receivedAt/emailType/mode/poNo/fields/matchKeys`) and drive `runMatcher` with fakes:

```ts
import { describe, it, expect } from 'vitest'
import { runMatcher } from './runner.js'
import type { MatcherRecord } from './types.js'
import type { MasterCandidatesRequest, MasterMatchInput, MasterMatchResult } from '../master-matcher/types.js'

const rec = (fields: Record<string, unknown>, mode = 'Sea'): MatcherRecord => ({
  graphMessageId: 'm1', conversationId: 'c1', receivedAt: '2026-07-10T00:00:00Z',
  emailType: 'Booking Request', mode, poNo: 'PO1', fields: { customer_code: 'DOCC', ...fields }, matchKeys: { booking_no: 'BK1' },
})

const critic = { name: 'stub', async score() { return { confidence: 90, rationale: 't' } } } as never
const sink = { posted: [] as unknown[], async postDecision(d: unknown) { this.posted.push(d) } }

function fakes(result: MasterMatchResult) {
  const calls: { candidates: MasterCandidatesRequest[]; resolve: MasterMatchInput[] } = { candidates: [], resolve: [] }
  const masterCandidates = { async masterCandidates(req: MasterCandidatesRequest) { calls.candidates.push(req); return [] } }
  const masterMatcher = { name: 'fake', async resolve(input: MasterMatchInput) { calls.resolve.push(input); return result } }
  return { calls, masterCandidates, masterMatcher }
}

describe('master-matcher seam — forwarder + port (all-AI spec §1)', () => {
  it('routes a raw forwarder name and writes the code back at ≥0.75', async () => {
    const { calls, masterCandidates, masterMatcher } = fakes({ match: 'DSV001', decision: 'match', confidence: 0.9, usedSignals: [], rationale: 'domain' })
    const r = rec({ forwarder_name: 'DSV AIR AND SEA' })
    await runMatcher([r], { critic, sink, masterMatcher, masterCandidates })
    expect(calls.candidates.some((c) => c.type === 'forwarder' && c.name === 'DSV AIR AND SEA')).toBe(true)
    expect(r.fields.forwarder_name).toBe('DSV001')
    expect(JSON.stringify(r.needsReview)).toContain('llm master match')
  })
  it('skips a known forwarder key (LOGIMARK) — no LLM call', async () => {
    const { calls, masterCandidates, masterMatcher } = fakes({ match: null, decision: 'none', confidence: 0, usedSignals: [], rationale: '' })
    await runMatcher([rec({ forwarder_name: 'LOGIMARK' })], { critic, sink, masterMatcher, masterCandidates })
    expect(calls.candidates.filter((c) => c.type === 'forwarder')).toHaveLength(0)
  })
  it('routes a non-UN/LOCODE pol with mode in context; a UN/LOCODE pod is skipped', async () => {
    const { calls, masterCandidates, masterMatcher } = fakes({ match: 'CNPVG', decision: 'match', confidence: 0.85, usedSignals: [], rationale: 'mode air' })
    const r = rec({ pol: 'SHANGHAI', pod: 'JPOSA' }, 'Air')
    await runMatcher([r], { critic, sink, masterMatcher, masterCandidates })
    expect(calls.candidates.some((c) => c.type === 'port' && c.name === 'SHANGHAI')).toBe(true)
    expect(calls.candidates.filter((c) => c.type === 'port')).toHaveLength(1) // pod skipped
    expect(calls.resolve.find((i) => i.kind === 'port')?.context?.mode).toBe('Air')
    expect(r.fields.pol).toBe('CNPVG')
  })
  it('below-threshold match leaves the raw in place', async () => {
    const { masterCandidates, masterMatcher } = fakes({ match: 'DSV001', decision: 'match', confidence: 0.6, usedSignals: [], rationale: 'weak' })
    const r = rec({ forwarder_name: 'MYSTERY FWD' })
    await runMatcher([r], { critic, sink, masterMatcher, masterCandidates })
    expect(r.fields.forwarder_name).toBe('MYSTERY FWD')
  })
})
```

Adjust the `critic`/`sink` fakes to the real `CriticAgent`/`DecisionSink` contracts if the compiler complains — mirror how `src/matcher/decision.test.ts` builds records and keep the fakes minimal.

- [ ] **Step 2: Run to verify failure**

Run: `cd /d/cobalt-queue && ./node_modules/.bin/vitest run src/matcher/master-match-seam.test.ts`
Expected: FAIL — forwarder/port never routed (0 candidate calls; fields unchanged where a write-back is expected).

- [ ] **Step 3: Implement**

`src/master-matcher/types.ts`:

```ts
export type MasterMatchKind = 'customer' | 'vendor' | 'forwarder' | 'consignee' | 'port'
// MasterCandidate gains:
  /** port candidates only: the port's mode tag ('sea' | 'air' | 'both') — the mode-fit signal */
  mode?: string | null
// MasterMatchInput.context widens:
  context?: { customerCode?: string; poNumbers?: string[]; mode?: string }
```

`src/matcher/runner.ts` — extend the seam:

```ts
import { isKnownCustomerCode, isKnownForwarderKey, isKnownVendorCode } from '../parser/master.js' // extend the existing import

interface UnresolvedParty {
  kind: MasterMatchKind
  rawName: string
  /** which field the raw value came from — where a resolved code is written back */
  field: 'customer_code' | 'vendor_code' | 'forwarder_name' | 'pol' | 'pod'
}

/** UN/LOCODE shape — a value that already passes needs no resolution (the soul owns clear cases). */
const UNLOCODE = /^[A-Z]{2}[A-Z0-9]{3}$/

function unresolvedParties(rec: MatcherRecord): UnresolvedParty[] {
  const out: UnresolvedParty[] = []
  const f = rec.fields ?? {}
  // ...existing customer/vendor blocks stay verbatim...
  const fw = f.forwarder_name
  if (fw != null && fw !== '' && !isKnownForwarderKey(fw)) {
    out.push({ kind: 'forwarder', rawName: String(fw), field: 'forwarder_name' })
  }
  for (const field of ['pol', 'pod'] as const) {
    const v = f[field]
    if (v != null && v !== '' && !UNLOCODE.test(String(v).toUpperCase().trim())) {
      out.push({ kind: 'port', rawName: String(v), field })
    }
  }
  return out
}
```

In `resolveGroupParties`:

```ts
// the group's mode — ports resolve differently under Air vs Sea (the whole point of the port seam)
const mode = group.map((r) => r.mode).find((m): m is string => typeof m === 'string' && m.trim() !== '')
// cache key: the same raw port resolves differently by mode
const key = party.kind === 'port'
  ? `port|${(mode ?? '').toUpperCase()}|${party.rawName.toUpperCase().trim()}`
  : `${party.kind}|${party.rawName.toUpperCase().trim()}`
// matcher call context gains mode for ports:
result = await matcher.resolve({
  kind: party.kind,
  rawName: party.rawName,
  emailDomain: emailDomain(rec.sender) || undefined,
  candidates,
  context: { poNumbers, ...(party.kind === 'port' && mode ? { mode } : {}) },
})
```

The candidates request and the write-back block are untouched — `party.field` now covers the three new slots.

- [ ] **Step 4: Run to verify pass**

Run: `cd /d/cobalt-queue && ./node_modules/.bin/vitest run src/matcher/master-match-seam.test.ts && ./node_modules/.bin/tsc --noEmit`
Expected: PASS + clean tsc.

- [ ] **Step 5: Run the full queue suite**

Run: `cd /d/cobalt-queue && ./node_modules/.bin/vitest run`
Expected: 705+ passed | 2 skipped (broker-gated) — no regressions.

- [ ] **Step 6: Commit**

```bash
cd /d/cobalt-queue && git add src/master-matcher/types.ts src/matcher/runner.ts src/matcher/master-match-seam.test.ts && git commit -m "feat(matcher): forwarder + port join the LLM master-matcher seam (mode-aware, code write-back)"
```

---

### Task 8: Queue — master-matcher soul: forwarder + port guidance

**Files:**
- Modify: `prompts/cobalt-master-matcher.md`

- [ ] **Step 1: Edit the soul.** In the Input section, extend the `kind` line to:

```
- `kind` — what role the reference plays: `customer` (the buyer), `vendor` (the supplier/factory/booking
  house), `forwarder` (the freight forwarder), `consignee` (the destination party), or `port` (a load /
  discharge port or airport).
```

Extend the `context` line:

```
- `context` — business context: `customerCode` (the shipment's buyer, when resolving its counterparties),
  `poNumbers` (the purchase orders in play), and — for `port` — `mode` (`Sea`/`Air`/`Sea-LCL`/`Sea-FCL`),
  the shipment's transport mode.
```

Append two rules after rule 6:

```
7. **Forwarders:** the candidates are freight forwarders (HBL issuers) and carriers. A booking
   **portal/platform** (TradeLinkOne, CVP, CRSA) is NEVER a forwarder — `none`. A **carrier** is the right
   pick only when the reference genuinely is the carrier acting as the forwarder (carrier-direct booking).
   A person's name or a bare email display-name is not a forwarder — `none`.
8. **Ports resolve by MODE.** `context.mode` Air → an airport UN/LOCODE (`mode: "air"`/`"both"`
   candidates); Sea → a seaport. The SAME city under different modes is DIFFERENT ports (SHANGHAI + Air →
   CNPVG, SHANGHAI + Sea → CNSHA). A candidate whose `mode` tag contradicts the shipment's mode needs
   other decisive signals (`prior_correction`) to win. Never pick a country, a warehouse, or a city with
   no candidate — `none`.
```

- [ ] **Step 2: Sanity-check rendering** — `head -40 prompts/cobalt-master-matcher.md` reads coherently; no duplicate rule numbers.

- [ ] **Step 3: Commit**

```bash
cd /d/cobalt-queue && git add prompts/cobalt-master-matcher.md && git commit -m "feat(soul): master-matcher guidance for forwarder (never a platform) + mode-aware ports"
```

---

### Task 9: Verification, docs, PRs

**Files:**
- Modify: `D:\cobalt_track_system\TODO.md` (record the feature under the LLM-matcher section), spec status line in `docs/superpowers/specs/2026-07-10-all-ai-forwarder-resolution-design.md`

- [ ] **Step 1: Full track suite**

Run: `cd /d/cobalt_track_system/backend && ./node_modules/.bin/vitest run && ./node_modules/.bin/tsc --noEmit -p tsconfig.json`
Expected: 634+ backend green (new tests add to the count), tsc clean. Then `cd ../frontend && ./node_modules/.bin/vitest run` → 198 green (untouched).

- [ ] **Step 2: Full queue suite**

Run: `cd /d/cobalt-queue && ./node_modules/.bin/vitest run && ./node_modules/.bin/tsc --noEmit`
Expected: 705+ passed | 2 skipped, tsc clean.

- [ ] **Step 3: Live probe (openpave warm only).** With the local stack + a warm openpave server (`OPENPAVE_URL` reachable) and `MASTER_MATCHER=openpave`: run `cd /d/cobalt-queue && tsx src/dev/run-matcher.ts` against existing evidence and confirm in the log (a) a `forwarder` seam call resolving a real raw name, (b) a `port` seam call where `context.mode` steered the pick. If openpave is down: run with the default stub, confirm raw values flow to review unchanged, and record "AI-path probe pending" in the PR body — do NOT fake the probe. When the stack IS up, also capture the spec-§4 before/after: `run-matcher` on `main` vs on the branch over the same evidence — compare posted forwarder/port link counts + forwarder/port review reasons (deterministic re-match, no re-parse).

- [ ] **Step 4: Update TODO.md** — under the LLM master matcher entry add one line: forwarder + port joined the seam (spec + both PR numbers), shadow metering live (`forwarder_link`/`port_link`), fuzzy-tier deletion = follow-up gated on shadow-quiet.

- [ ] **Step 5: PRs**

```bash
cd /d/cobalt-queue && git push -u origin feat/all-ai-forwarder-port-seam && gh pr create --title "feat(matcher): forwarder + port join the LLM master-matcher seam" --body "<summary + verification evidence + spec link>"
cd /d/cobalt_track_system && git push -u origin feat/all-ai-forwarder-resolution && gh pr create --title "feat(masters): all-AI forwarder/port resolution — retrieval, code-first links, shadow metering, learning loop" --body "<summary + verification evidence>"
```

Expected: both PRs green in CI. Report results honestly (including a pending AI-probe if openpave was down).
