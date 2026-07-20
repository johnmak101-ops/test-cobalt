# Decision-Centre Desk (Track Side) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **EXECUTE AFTER the queue plan** (`D:\cobalt-queue\docs\superpowers\plans\2026-07-20-decision-centre-queue-plan.md`) — Task 1 here copies the fixture that queue Task 6 authors. Tasks 4-5 (admin report) only depend on Task 1 and may run before Tasks 2-3.

**Goal:** Review rows lead with a decision phrase, shadow-eligible legs get one-click Confirm-as-is, and a new admin `/admin/mesh-misses` page turns structured `masterMisses[]` into a Mesh-entry worklist with ack + recurred-after-ack.

**Architecture:** Track never reclassifies the gate (single-brain rule). It renders what queue sends: `criticReview.wouldBeAuto` drives the shadow lane; `criticReview.masterMisses[]` is aggregated in a Nest service (JSON parsed in Node, not SQL) over a 30-day window against a new additive `dbo.mesh_miss_ack` table. Frontend stays Tailwind v4 + existing `Badge`/pill vocabulary.

**Tech Stack:** NestJS + Kysely (SQL Server — `TOP` not `LIMIT`, JSON as nvarchar strings), React + Tailwind v4, vitest (backend tests are manual-construction: verify DI/routes by BOOTING `dist/main.js`, never by vitest alone).

**Spec:** `docs/superpowers/specs/2026-07-20-review-decision-centre-membership-design.md`

## Global Constraints

- Repo: `D:\cobalt_track_system`, branch `feat/decision-centre-desk` off `main`.
- Local gate before every commit: `pnpm lint && npx tsc --noEmit && pnpm test` in `backend/`, plus `npx tsc --noEmit` in `frontend/` (CI is down; nest build emits dist even on tsc errors — never trust it).
- NEVER reclassify or override the gate's disposition in track (this is the #144 bug family). Render only.
- `docs/` is gitignored here: any new doc needs `git add -f`.
- New migrations MUST be registered in the static migration registry (there is a registry-guard test; find the registry with `rg -n "0000_init" backend/src/db` and add the new file exactly where siblings are listed).
- DB rules: additive-only; `datetimeoffset(7)` for timestamps; no `LIMIT`/`ON CONFLICT`/jsonb.
- Frontend: no new dependencies (no sanitizer, no chart lib); CSV export is client-side Blob.
- The frontend must not display raw confidence scores (existing rule, `frontend/src/lib/critic-review.ts:61`).

---

### Task 0 (conditional): desk display filter from the 07-20 spec

The membership feature assumes the approved desk filter (`2026-07-20-review-desk-decision-vs-fyi-design.md` §5) exists. Check first:

- [ ] **Step 1:** `rg -n "desk" frontend/src/lib/review-reasons.ts frontend/src/components/review` — if `tagDesk` / a `desk` field exists, mark this task complete and skip.
- [ ] **Step 2 (only if absent):** implement that spec's §5 sketch exactly: extend the needs-attention item type with `desk: 'decision' | 'fyi'`; assign per its §3.4 allow/deny lists (including the `g-*` lineIds already written into that spec); `buildNeedsAttentionGroups({ desk: 'decision' | 'all' })`; Review passes `'decision'`, shipment detail passes `'all'`; drop empty groups. Unmapped default per that spec: `decision` if group is `which_shipment`/`real_shipment`, else `fyi`.
- [ ] **Step 3:** test: a fixture item list containing one `w-po-only` line + one `m-party` line → Review build shows only the placement line; detail build shows both. Run backend/frontend gates. Commit: `git commit -am "feat(review): desk display filter (decision vs fyi) per 07-20 spec"`.

---

### Task 1: Wire types + cross-repo fixture consumption

**Files:**
- Copy: `D:\cobalt-queue\test\fixtures\decision-centre-fixture.json` → `backend/test/fixtures/decision-centre-fixture.json` (byte-identical)
- Modify: `backend/src/decisions/critic-review.types.ts` (the CriticReview type, band at :48)
- Test: `backend/src/decisions/decision-centre-fixture.spec.ts`

**Interfaces:**
- Produces (consumed by every later task):

```ts
export interface MasterMiss { type: 'vendor' | 'forwarder' | 'customer'; rawName: string; field: string }
// on CriticReview (both optional — legacy payloads lack them):
wouldBeAuto?: boolean
masterMisses?: MasterMiss[]
export function normalizeMasterName(raw: string): string  // casefold+trim+collapse-ws — MUST match queue
```

- [ ] **Step 1: Failing test**

```ts
// backend/src/decisions/decision-centre-fixture.spec.ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { normalizeMasterName, type CriticReview } from './critic-review.types'

const fx = JSON.parse(readFileSync('test/fixtures/decision-centre-fixture.json', 'utf8'))

describe('decision-centre cross-repo fixture (track side)', () => {
  it('parses the fixture criticReview slice into our type', () => {
    const cr = fx.criticReview as CriticReview
    expect(cr.wouldBeAuto).toBe(true)
    expect(cr.masterMisses).toEqual([
      { type: 'vendor', rawName: 'Dongguan Great Co', field: 'vendor' },
      { type: 'forwarder', rawName: 'Speedy Logistics', field: 'forwarder' },
    ])
  })
  it('normalizer contract matches queue', () => {
    expect(normalizeMasterName('  ACME   Ltd ')).toBe('acme ltd')
    expect(fx.normalizer).toBe('casefold+trim+collapse-ws')
  })
  it('desk classes include the gate lineIds', () => {
    expect(fx.deskClasses.decision).toContain('g-checksum')
    expect(fx.deskClasses.fyi).toContain('g-repaired')
  })
})
```

- [ ] **Step 2: Run** — `cd backend && pnpm vitest run src/decisions/decision-centre-fixture.spec.ts` → FAIL
- [ ] **Step 3: Implement** — add to `critic-review.types.ts`:

```ts
export interface MasterMiss { type: 'vendor' | 'forwarder' | 'customer'; rawName: string; field: string }
// inside CriticReview:
wouldBeAuto?: boolean
masterMisses?: MasterMiss[]

export function normalizeMasterName(raw: string): string {
  return raw.toLowerCase().trim().replace(/\s+/g, ' ')
}
```

No DTO change needed — `criticReview` is already a loose object (`dto.ts:119`) and nesting passes `whitelist:true`.

- [ ] **Step 4: Run** → PASS; backend gate green
- [ ] **Step 5: Commit** — `git commit -am "feat(decisions): wouldBeAuto + masterMisses types, fixture pinned to queue"`

---

### Task 2: Decision phrase on rows and card

**Files:**
- Create: `frontend/src/lib/decision-phrase.ts`
- Modify: `frontend/src/pages/ReviewQueuePage.tsx` (row lead text, near the row render ~line 146-200); `frontend/src/components/review/ReviewCard.tsx` (headline, near the band read at :304)
- Test: `frontend/src/lib/decision-phrase.test.ts` (if the frontend has no vitest config — check `ls frontend/vitest.config.*` — put the test file in place anyway and verify via `npx tsc --noEmit` + the manual checklist in Task 6)

**Interfaces:**
- Produces:

```ts
export interface PhraseInput {
  candidates?: number            // multi-match candidate count
  weakIdentity?: boolean         // real_shipment class present
  criticalBlanks?: number        // from 07-19 helpers if present, else 0
  conflictField?: string | null  // first conflict field label
  gateCodes?: string[]           // decision-class gate codes (g-checksum, g-total, g-pages)
  band?: 'low' | 'medium' | 'high'
  aiLowReason?: boolean          // reviewReasons contains the ai_confidence_low text
}
export function decisionPhrase(i: PhraseInput): string | null  // null = no decision phrase (fall back to today's lead)
```

- [ ] **Step 1: Failing test**

```ts
// frontend/src/lib/decision-phrase.test.ts
import { describe, expect, it } from 'vitest'
import { decisionPhrase } from './decision-phrase'

describe('decisionPhrase priority', () => {
  it('which-shipment beats everything', () => {
    expect(decisionPhrase({ candidates: 2, conflictField: 'ETD', gateCodes: ['g-total'] }))
      .toBe('Pick the right shipment (2 candidates) · 揀邊票貨')
  })
  it('order: real → blanks → conflict → gate → ai-low', () => {
    expect(decisionPhrase({ weakIdentity: true })).toBe('Confirm this is a real shipment · 真貨定通知')
    expect(decisionPhrase({ criticalBlanks: 2 })).toBe('Fill 2 critical blanks · 補關鍵欄位')
    expect(decisionPhrase({ conflictField: 'ETD' })).toBe('Resolve ETD conflict · 解欄位衝突')
    expect(decisionPhrase({ gateCodes: ['g-checksum'] })).toBe('Verify container check digit · 驗證 gate')
    expect(decisionPhrase({ aiLowReason: true })).toBe('Verify extraction (AI low confidence) · 驗證拆解')
  })
  it('nothing decision-shaped → null', () => {
    expect(decisionPhrase({})).toBeNull()
  })
})
```

- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**

```ts
// frontend/src/lib/decision-phrase.ts
// Copy strings are draft (spec §11 open item) — keep them ALL in this one file for the ops copy pass.
export interface PhraseInput {
  candidates?: number; weakIdentity?: boolean; criticalBlanks?: number
  conflictField?: string | null; gateCodes?: string[]
  band?: 'low' | 'medium' | 'high'; aiLowReason?: boolean
}
const GATE_PHRASE: Record<string, string> = {
  'g-checksum': 'Verify container check digit',
  'g-total': 'Verify line totals vs footer',
  'g-pages': 'Verify totals (pages skipped)',
}
export function decisionPhrase(i: PhraseInput): string | null {
  if (i.candidates && i.candidates > 1) return `Pick the right shipment (${i.candidates} candidates) · 揀邊票貨`
  if (i.weakIdentity) return 'Confirm this is a real shipment · 真貨定通知'
  if (i.criticalBlanks) return `Fill ${i.criticalBlanks} critical blank${i.criticalBlanks > 1 ? 's' : ''} · 補關鍵欄位`
  if (i.conflictField) return `Resolve ${i.conflictField} conflict · 解欄位衝突`
  const g = i.gateCodes?.find((c) => GATE_PHRASE[c])
  if (g) return `${GATE_PHRASE[g]} · 驗證 gate`
  if (i.aiLowReason) return 'Verify extraction (AI low confidence) · 驗證拆解'
  return null
}
```

Wiring: in `ReviewQueuePage.tsx`, build `PhraseInput` from what each row already has (candidate count from matchAmbiguity if surfaced, conflict count/first field from the compact projection, `gateCodes` if the parse-flow compact field exists yet — pass `undefined` when absent, tiers simply cannot fire; `aiLowReason` = `reviewReasons?.includes('AI confidence low — verify extraction')`). Render the phrase as the row's lead text when non-null, existing lead otherwise. In `ReviewCard.tsx`, render the same phrase as a headline line above the existing regions — no other card change (07-19 layout stands).

- [ ] **Step 4: Run** test (if vitest configured) → PASS; `npx tsc --noEmit` in frontend → clean
- [ ] **Step 5: Commit** — `git commit -am "feat(review): decision phrase on queue rows and card headline"`

---

### Task 3: Shadow lane — chip + Confirm-as-is

**Files:**
- Modify: `frontend/src/pages/ReviewQueuePage.tsx` (row actions area)
- Test: `frontend/src/lib/shadow-lane.test.ts` (pure helper) — UI verified in Task 6 checklist

**Interfaces:**
- Consumes: `criticReview.wouldBeAuto` (Task 1 type); the EXISTING confirm mutation — find it with `rg -n "confirm" frontend/src/components/review/ReviewCard.tsx` and reuse the same hook/endpoint; do NOT create a new confirm path.
- Produces: `isShadowEligible(cr?: { wouldBeAuto?: boolean }): boolean`.

- [ ] **Step 1: Failing test**

```ts
// frontend/src/lib/shadow-lane.test.ts
import { describe, expect, it } from 'vitest'
import { isShadowEligible } from './shadow-lane'

describe('isShadowEligible', () => {
  it('true only when the queue marked wouldBeAuto', () => {
    expect(isShadowEligible({ wouldBeAuto: true })).toBe(true)
    expect(isShadowEligible({})).toBe(false)
    expect(isShadowEligible(undefined)).toBe(false)   // legacy payloads
  })
})
```

- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**

```ts
// frontend/src/lib/shadow-lane.ts
export function isShadowEligible(cr?: { wouldBeAuto?: boolean }): boolean {
  return cr?.wouldBeAuto === true
}
```

Row UI: when eligible, render a muted pill (reuse the reason-pill classes from `ReviewQueuePage.tsx:295-327`) labelled `auto-eligible (shadow)` plus a secondary button `Confirm as-is` that calls the existing confirm mutation for that leg with no edits. No modal. False-skip measurement needs no new code: an operator who edits first goes through the normal card flow, and the existing confirm/correct audit rows distinguish the two (shadow report reads them later).

- [ ] **Step 4: Gates** → frontend tsc clean; test PASS
- [ ] **Step 5: Commit** — `git commit -am "feat(review): shadow lane chip + one-click confirm-as-is for wouldBeAuto legs"`

---

### Task 4: Mesh-miss ack table + aggregation endpoint

**Files:**
- Create: `backend/src/db/kysely-migrations/00XX_mesh_miss_ack.ts` (next number; REGISTER it in the static migration registry — the registry-guard test fails if you forget)
- Create: `backend/src/admin/mesh-misses.service.ts`, `backend/src/admin/mesh-misses.controller.ts` (follow the module/controller registration pattern of an existing admin-guarded controller — find one with `rg -rn "AdminGuard|Roles\('admin'\)|isAdmin" backend/src` and mirror its guard exactly)
- Test: `backend/src/admin/mesh-misses.service.spec.ts` (manual-construction style, like the other backend specs)

**Interfaces:**
- Produces API (admin-guarded):
  - `GET /api/admin/mesh-misses?days=30&includeAcked=false` → `MeshMissRow[]`
  - `POST /api/admin/mesh-misses/ack` body `{ type: string; normalizedName: string }`

```ts
export interface MeshMissRow {
  type: 'vendor' | 'forwarder' | 'customer'
  rawName: string            // most recent raw spelling
  normalizedName: string
  shipmentIds: string[]
  count: number
  firstSeen: string          // ISO
  lastSeen: string
  status: 'open' | 'acked' | 'recurred'   // recurred = lastSeen > ackedAt + 7d
}
```

- [ ] **Step 1: Migration**

```ts
// backend/src/db/kysely-migrations/00XX_mesh_miss_ack.ts  (match sibling file style from 0000_init.ts)
import { sql, type Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE dbo.mesh_miss_ack (
      id uniqueidentifier NOT NULL DEFAULT NEWID() PRIMARY KEY,
      type nvarchar(20) NOT NULL,
      normalized_name nvarchar(400) NOT NULL,
      acked_by nvarchar(200) NOT NULL,
      acked_at datetimeoffset(7) NOT NULL DEFAULT SYSDATETIMEOFFSET(),
      CONSTRAINT uq_mesh_miss_ack UNIQUE (type, normalized_name)
    )
  `.execute(db)
}
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE dbo.mesh_miss_ack`.execute(db)
}
```

- [ ] **Step 2: Failing service test**

```ts
// backend/src/admin/mesh-misses.service.spec.ts
import { describe, expect, it } from 'vitest'
import { aggregateMisses } from './mesh-misses.service'

const leg = (id: string, seen: string, misses: unknown[]) => ({
  id, createdAt: seen,
  criticReview: JSON.stringify({ masterMisses: misses }),
})

describe('aggregateMisses', () => {
  it('groups by type + normalized name, counts, tracks first/last seen', () => {
    const rows = aggregateMisses(
      [
        leg('s1', '2026-07-01T00:00:00Z', [{ type: 'vendor', rawName: 'ACME  Ltd', field: 'vendor' }]),
        leg('s2', '2026-07-10T00:00:00Z', [{ type: 'vendor', rawName: 'acme ltd', field: 'vendor' }]),
      ],
      [],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ type: 'vendor', normalizedName: 'acme ltd', count: 2, status: 'open' })
    expect(rows[0].shipmentIds).toEqual(['s1', 's2'])
  })
  it('acked hides inside 7 days, recurs after', () => {
    const acks = [{ type: 'vendor', normalized_name: 'acme ltd', acked_at: '2026-07-02T00:00:00Z' }]
    const recentOnly = aggregateMisses([leg('s3', '2026-07-03T00:00:00Z', [{ type: 'vendor', rawName: 'ACME Ltd', field: 'vendor' }])], acks)
    expect(recentOnly[0].status).toBe('acked')
    const recurred = aggregateMisses([leg('s4', '2026-07-15T00:00:00Z', [{ type: 'vendor', rawName: 'ACME Ltd', field: 'vendor' }])], acks)
    expect(recurred[0].status).toBe('recurred')
  })
  it('ignores legs without masterMisses and unparsable JSON', () => {
    expect(aggregateMisses([{ id: 'x', createdAt: '2026-07-01T00:00:00Z', criticReview: '{broken' } as never], [])).toEqual([])
  })
})
```

- [ ] **Step 3: Run** → FAIL
- [ ] **Step 4: Implement service**

```ts
// backend/src/admin/mesh-misses.service.ts (aggregation pure function + thin Nest service around it)
import { normalizeMasterName, type MasterMiss } from '../decisions/critic-review.types'

interface LegRow { id: string; createdAt: string; criticReview: string | null }
interface AckRow { type: string; normalized_name: string; acked_at: string }
const RECUR_MS = 7 * 24 * 3600 * 1000

export function aggregateMisses(legs: LegRow[], acks: AckRow[]) {
  const ackMap = new Map(acks.map((a) => [`${a.type}:${a.normalized_name}`, new Date(a.acked_at).getTime()]))
  const groups = new Map<string, { type: MasterMiss['type']; rawName: string; normalizedName: string; shipmentIds: string[]; first: number; last: number }>()
  for (const leg of legs) {
    let misses: MasterMiss[] = []
    try { misses = (JSON.parse(leg.criticReview ?? '{}').masterMisses ?? []) as MasterMiss[] } catch { continue }
    const t = new Date(leg.createdAt).getTime()
    for (const m of misses) {
      const normalizedName = normalizeMasterName(m.rawName)
      const key = `${m.type}:${normalizedName}`
      const g = groups.get(key) ?? { type: m.type, rawName: m.rawName, normalizedName, shipmentIds: [], first: t, last: t }
      g.shipmentIds.push(leg.id); g.first = Math.min(g.first, t); g.last = Math.max(g.last, t); g.rawName = t >= g.last ? m.rawName : g.rawName
      groups.set(key, g)
    }
  }
  return [...groups.values()].map((g) => {
    const ackedAt = ackMap.get(`${g.type}:${g.normalizedName}`)
    const status = ackedAt === undefined ? 'open' : g.last > ackedAt + RECUR_MS ? 'recurred' : 'acked'
    return { type: g.type, rawName: g.rawName, normalizedName: g.normalizedName, shipmentIds: [...new Set(g.shipmentIds)], count: new Set(g.shipmentIds).size, firstSeen: new Date(g.first).toISOString(), lastSeen: new Date(g.last).toISOString(), status }
  }).sort((a, b) => b.count - a.count)
}
```

The Nest service loads `legs` with Kysely (`where criticReview like '%masterMisses%'` + `createdAt >` window via `sql` — check the real timestamp column name in `backend/src/db/db.generated.ts` first) and `acks` from `mesh_miss_ack`; the controller exposes GET (default `days=30`, `includeAcked=false` filters out `acked` but always keeps `recurred`) and POST ack (upsert by unique key — `MERGE` or delete+insert; no `ON CONFLICT` on MSSQL), guarded by the same admin guard as the sibling admin controller. Register the module where siblings are registered.

- [ ] **Step 5: Run** → service spec PASS; backend gate green
- [ ] **Step 6: Boot verification** — `cd backend && pnpm build && node dist/main.js` then:
  `curl -s -H "Authorization: Bearer <admin JWT>" "http://localhost:3000/api/admin/mesh-misses"` → `200 []` (or rows); without the admin role → `403`.
- [ ] **Step 7: Commit** — `git commit -am "feat(admin): mesh-miss aggregation endpoint + ack table (registered migration)"`

---

### Task 5: `/admin/mesh-misses` page

**Files:**
- Create: `frontend/src/pages/AdminMeshMissesPage.tsx`
- Modify: the frontend router + admin nav (find with `rg -n "Route|path=" frontend/src` where existing admin pages register)
- Test: frontend tsc + Task 6 checklist (no new deps)

**Interfaces:** consumes Task 4's API verbatim.

- [ ] **Step 1: Implement the page**

```tsx
// frontend/src/pages/AdminMeshMissesPage.tsx — Tailwind v4, no new deps; reuse Badge for the Type cell
import { useEffect, useMemo, useState } from 'react'

interface Row { type: string; rawName: string; normalizedName: string; shipmentIds: string[]; count: number; firstSeen: string; lastSeen: string; status: 'open' | 'acked' | 'recurred' }

export default function AdminMeshMissesPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [includeAcked, setIncludeAcked] = useState(false)
  const [typeFilter, setTypeFilter] = useState<'all' | 'vendor' | 'forwarder' | 'customer'>('all')
  const load = () => fetch(`/api/admin/mesh-misses?days=30&includeAcked=${includeAcked}`, { credentials: 'include' })
    .then((r) => r.json()).then(setRows)
  useEffect(() => { void load() }, [includeAcked])
  const view = useMemo(() => rows.filter((r) => typeFilter === 'all' || r.type === typeFilter), [rows, typeFilter])

  const ack = async (r: Row) => {
    await fetch('/api/admin/mesh-misses/ack', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: r.type, normalizedName: r.normalizedName }),
    })
    void load()
  }
  const exportCsv = () => {
    const head = 'type,rawName,count,firstSeen,lastSeen,status'
    const csv = [head, ...view.map((r) => [r.type, `"${r.rawName.replaceAll('"', '""')}"`, r.count, r.firstSeen, r.lastSeen, r.status].join(','))].join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `mesh-misses-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold">Mesh misses</h1>
        <select className="border rounded px-2 py-1 text-sm" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as never)}>
          <option value="all">All types</option><option value="vendor">Vendors</option>
          <option value="forwarder">Forwarders</option><option value="customer">Customers</option>
        </select>
        <label className="text-sm flex items-center gap-1">
          <input type="checkbox" checked={includeAcked} onChange={(e) => setIncludeAcked(e.target.checked)} /> show acked
        </label>
        <button className="ml-auto border rounded px-3 py-1 text-sm" onClick={exportCsv}>Export CSV</button>
      </div>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-neutral-500">
          <th className="py-1">Name</th><th>Type</th><th>Shipments</th><th>First seen</th><th>Last seen</th><th>Status</th><th /></tr></thead>
        <tbody>
          {view.map((r) => (
            <tr key={`${r.type}:${r.normalizedName}`} className="border-t">
              <td className="py-1 font-medium">{r.rawName}</td>
              <td>{r.type}</td>
              <td title={r.shipmentIds.join(', ')}>{r.count}</td>
              <td>{r.firstSeen.slice(0, 10)}</td><td>{r.lastSeen.slice(0, 10)}</td>
              <td>{r.status === 'recurred' ? <span className="text-amber-700 font-semibold">recurred after ack</span> : r.status}</td>
              <td>{r.status !== 'acked' && <button className="border rounded px-2 py-0.5" onClick={() => void ack(r)}>已入 Mesh</button>}</td>
            </tr>
          ))}
          {view.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-neutral-500">No open Mesh misses in the last 30 days.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}
```

Register the route beside the existing admin pages (same guard/wrapper the sender-ignore admin page uses — `rg -n "ignore" frontend/src/pages` to find it) and add a nav link labelled "Mesh misses".

- [ ] **Step 2: Gates** — frontend `npx tsc --noEmit` clean
- [ ] **Step 3: Commit** — `git commit -am "feat(admin): /admin/mesh-misses worklist page with ack + CSV export"`

---

### Task 6: `ai_confidence_low` translation + boot checklist + PR

**Files:**
- Modify: `frontend/src/lib/review-reasons.ts` (TRANSLATIONS + category; `broadcast total` precedent at :249; categories at :352-435)
- Test: extend the existing review-reasons test file (find with `rg -l "review-reasons" frontend/src --glob '*test*'`)

- [ ] **Step 1:** add a TRANSLATIONS entry mapping the exact string `AI confidence low — verify extraction` → label `Verify extraction (AI low confidence)`, category the same group as `i-parse` (real_shipment/incomplete family), lineId `i-ai-low`, desk `decision` (Task 0 map). Test: the raw string humanizes to the label and lands in the decision build.
- [ ] **Step 2:** full local gates in BOTH `backend/` and `frontend/`.
- [ ] **Step 3: Manual boot checklist** (backend `node dist/main.js`, frontend dev or built):
  1. Legacy leg (no new fields) renders exactly as before (no phrase → old lead text, no shadow chip, no crash).
  2. A leg with `criticReview.wouldBeAuto=true` shows the shadow pill + Confirm as-is; clicking confirms without edits.
  3. `/admin/mesh-misses` as admin: rows render, 已入 Mesh hides the row, re-check with `includeAcked=true` shows `acked`; non-admin gets 403.
  4. Review card headline shows a phrase on a multi-candidate leg.
- [ ] **Step 4: Commit + PR** — `git commit -am "feat(review): ai_confidence_low translation + desk registration"`; push `feat/decision-centre-desk`; PR titled `feat: decision-centre desk — phrases, shadow lane, admin Mesh report`.

---

## Round 2 — post-review fixes (2026-07-20, /review of merged PR 249: 6 passes + red team)

Same rules; NEW GATE RULE (fixes a Round-1 plan bug): frontend gate = `npx tsc --noEmit && pnpm test` (vitest was missing, which is how 3 broken ReviewCard tests merged). John's rulings: T2 = enumerate + high-severity valve (spec's quiet-desk default STANDS); T3 = suppress Confirm-as-is on open decisions + error feedback. Backend is green (1025/1026) — do not touch what isn't listed.

### T2-1 (CRITICAL): tagDesk enumeration + severity valve — `frontend/src/components/review/needs-attention.ts`

Live-proven hole: `fields_disagree` lines (`f-count`, `f-backend`, `f-lock`, `f-mode`), `i-cargo` (CARGO_SANITY), and any future unmapped code fall to the final `'fyi'` return → hidden on Review while "Ready to confirm — no open decisions" renders and one click blind-confirms (and `emitConfirms` writes false approved rows into learning/2b calibration).

- `tagDesk` gains severity: `tagDesk(item: Pick<NeedsAttentionItem,'lineId'|'groupId'|'text'|'severity'>)`.
- Order of checks: must-decision set → must-fyi set → `lineId.startsWith('f-')` → `'decision'` → m-* prefixes → `'fyi'` → brand-text regex (ANCHOR it: `/^brand '[^']{1,80}' appears across \d+ distinct buyer families/i`, mirroring the queue anchor) → `'fyi'` → group default (which_shipment/real_shipment → decision) → **severity valve: unmapped && severity 'high' → 'decision'** (future queue codes never vanish silently) → `'fyi'`.
- Add `'i-cargo'` to DESK_DECISION_LINE_IDS; add `'m-vendor'`, `'m-consignee'` to DESK_FYI_LINE_IDS (spec §3.4 lists them).
- Tests (extend the desk describe): one per branch — `f-backend` with no conflict table → decision build shows it; `i-cargo` → decision; exact fyi-set id (`m-party:collapsed`) → hidden on Review, shown on detail; unmapped id in `other` with severity high → decision (valve); unmapped low → fyi; anchored brand note → fyi; hostile text `"brand 'X' ... families.pdf: original not forwarded"` under a non-listed lineId → decision.

### T2-2 (CRITICAL): wire the `i-ai-low` producer — `needs-attention.ts` / `review-reasons.ts`

`'i-ai-low'` is a dead set entry: no classifier assigns that lineId, so the flagship band-low reason 'AI confidence low — verify extraction' lands lineId `reason:<raw>` → group incomplete_data → fyi → **hidden**. Add a classifier branch (mirror the `i-parse` one) mapping the exact string → lineId `'i-ai-low'`, category `extraction`. Build the regex FROM the exported `AI_CONFIDENCE_LOW_REASON` const (decision-phrase.ts) so the string exists once. Test: `buildNeedsAttentionGroups({reviewReasons:['AI confidence low — verify extraction'], desk:'decision'})` contains lineId `i-ai-low` with text 'Verify extraction (AI low confidence)'.

### T2-3 (CRITICAL): fix the 3 ReviewCard tests broken by the desk filter

After T2-1/T2-2, re-run `pnpm test` — the 3 new failures should mostly pass again because their lines are now decision-class. Any that still fail: update the expectation ONLY if the desk-filtered rendering is the intended behavior, with a comment naming rule A. Note: 2 more failures + 2 tsc errors (`ReviewPoStylesSection.test.tsx` Mock type) are PRE-EXISTING on main — leave them.

### T2-4: Confirm-as-is guard + feedback + keyboard — `frontend/src/pages/ReviewQueuePage.tsx`

- Suppress the button when the row shows an open decision: `const openDecision = /conflict$/i.test(compact?.topConflictType ?? '') || (compact?.candidateCount ?? 0) > 1` → render chip only, no button.
- onError: reuse the page's existing stale-conflict path (409 → stale banner + refetch) else `toast(message)`. Keep `onSettled` busy-reset.
- Keyboard: in the row `onKeyDown`, bail when `e.target !== e.currentTarget` so Enter on the focused button activates the button, not row-expand.
- Layout: add `flex-wrap` + `min-w-0` to the chip+button span.
- Test: row with `wouldBeAuto:true` + topConflictType 'ETD conflict' → chip yes, button NO; clean shadow row → button posts confirm with `expectedUpdatedAt` and does not expand the row.

### T2-5: fixture reconciliation (BOTH repos, one sitting — byte-identical again)

REMOVE `vendor-not-stated` + `soft-port-country-only` from `deskClasses.decision` (keep their `representativeNotes`); add `"note": "deskClasses lists PRODUCED families only; m-vendor/m-port display lines are track lineIds, fyi per 07-20 spec §3.4"`. Update both repos' fixtures identically.

### T2-6: ack endpoint hardening — mesh-misses controller/service

- Concurrent-ack 2627 → idempotent success; other errors → generic BadRequestException (no raw SQL passthrough).
- `@MaxLength(400)` on normalizedName.
- Controller spec for @Roles and list param coercion.

### T2-7: polish batch

- CSV BOM for CJK + formula neutralization + revokeObjectURL.
- Status Badge; empty-state copy by filter; tooltip cap shipmentIds.
- Export isWeakIdentityReason; drop PhraseInput.band.
- `/admin/mesh-misses` → Navigate to settings; drop unused AdminModule exports; hoist 30-day const.

### T2-8: test backfill

- aggregateMisses edge cases; compactCriticReview wouldBeAuto/candidateCount; AdminMeshMissesPage tests.

**Exit:** frontend gate = tsc + vitest; fixtures byte-identical; deploy after boot checklist.
