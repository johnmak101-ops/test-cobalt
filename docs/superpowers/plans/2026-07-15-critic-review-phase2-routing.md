# Critic Review Phase 2 — Band-driven routing (shadow-first) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship band-driven routing end-to-end in **shadow** (default `critic_routing_mode='gate'`): cobalt-queue emits `recommendedRouting`, ShipTrack dual-computes gate vs band routing, logs every critic-bearing ingest to `routing_shadow`, exposes a report API, and wires a reversible flip flag — with **zero production routing change** until an admin flips the setting.

**Architecture:** Queue is the source of truth for the band recommendation (`high` + no hard-stop → `auto`; `skip` stays `skip`; else `review`). ShipTrack maps both models at ingest, always writes a shadow row when `criticReview` is present, and selects `reviewStatus` from gate routing by default. Under `band` mode, server-side hard-stop risk codes still force provisional (defence in depth). Shadow report is admin/editor read-only aggregation over a window.

**Tech Stack:**
- **Part A (cobalt-queue):** TypeScript ESM, vitest, pure helpers in matcher.
- **Part B (ShipTrack):** NestJS + Kysely + MSSQL; monorepo `pnpm --filter backend test`.

## Global Constraints

- **Default `critic_routing_mode = 'gate'` → zero behavior change** on `reviewStatus` vs today.
- **Hard stops enforced server-side under `'band'`** — never `confirmed` if a hard-stop risk flag code is present.
- **`skip` stays `skip`**; legacy legs with no `criticReview` → gate routing only (no shadow row required).
- **Migrations MUST be registered** in `backend/src/db/migrate-cli.ts` `MIGRATIONS` (add `0013`).
- **CI fails on eslint** — run `pnpm lint` (or repo-equivalent) before commit, not just tsc/tests.
- **Worktrees lack untracked `backend/.env`** → export dummy `JWT_SECRET` (≥32 chars) when running backend tests.
- **Every task ends green** (relevant tests) and is **committed** before the next begins.
- **Part A ships first** so live POSTs can carry `recommendedRouting` before ShipTrack depends on it (ShipTrack still has a band fallback from `criticReview`).
- Open-item lock-ins for this build: dedicated `routing_shadow` table; report default window 30 days; flip is **global** (staged per-sender is 2b-later).

---

## Repo-boundary map

| Concern | Repo | Tasks |
|---|---|---|
| `recommendedRouting` type + pure derivation | cobalt-queue (`D:\cobalt-queue`) | 1 |
| Emit from `runMatcher` + contract coverage | cobalt-queue | 2 |
| Migration `0013` + DB types + repository | ShipTrack | 3 |
| Settings flag `critic_routing_mode` | ShipTrack | 4 |
| Dual routing + shadow write at ingest | ShipTrack | 5 |
| Shadow report API | ShipTrack | 6 |
| Band-mode flip + hard-stop safety + audit note | ShipTrack | 7 |
| Shadow-proof / acceptance integration tests | ShipTrack | 8 |

---

## File structure

### Part A — cobalt-queue

**Create**
- `src/matcher/recommended-routing.ts` — pure `computeRecommendedRouting({ disposition, band, hasHardStop })`
- `src/matcher/recommended-routing.test.ts`

**Modify**
- `src/matcher/types.ts` — `Decision.recommendedRouting?: 'auto' | 'review' | 'skip'`
- `src/matcher/runner.ts` — set field after gate + critic
- `test/critic-review-contract.test.ts` — assert high→auto, multi-id→review (via derived helper or posted shape)

### Part B — ShipTrack

**Create**
- `backend/src/db/kysely-migrations/0013_routing_shadow.ts`
- `backend/src/decisions/band-routing.ts` — pure dual-routing + hard-stop codes
- `backend/src/decisions/band-routing.spec.ts`
- `backend/src/db/repositories/routing-shadow.repository.ts`
- `backend/src/settings/routing-shadow.service.ts` (report aggregation) — or methods on settings/decisions; prefer dedicated small service under `settings/` or `decisions/`

**Modify**
- `backend/src/db/migrate-cli.ts` — register `0013`
- `backend/src/db/kysely/db.ts` + hand-add `routingShadow` table type (codegen optional)
- `backend/src/db/repositories.module.ts` — provide new repo
- `backend/src/decisions/dto.ts` — optional `recommendedRouting`
- `backend/src/decisions/decisions.service.ts` — dual route, shadow write, mode select
- `backend/src/decisions/decisions.module.ts` — inject deps
- `backend/src/settings/settings.service.ts` — `criticRoutingMode` get/set
- `backend/src/settings/settings.controller.ts` — GET/PUT mode + GET report
- `backend/test/decisions.int.spec.ts` — shadow + mode + hard-stop + legacy proofs

---

## Part A — cobalt-queue

### Task 1: Pure `recommendedRouting` derivation

**Files:**
- Create: `D:\cobalt-queue\src\matcher\recommended-routing.ts`
- Create: `D:\cobalt-queue\src\matcher\recommended-routing.test.ts`
- Modify: `D:\cobalt-queue\src\matcher\types.ts` (add field on `Decision`)

**Interfaces:**
- Consumes: `Disposition` (`'auto' | 'review' | 'skip'`), critic `band`, `hardStops(riskSignals(draft))`
- Produces:
```ts
export type RecommendedRouting = 'auto' | 'review' | 'skip'

export function computeRecommendedRouting(input: {
  disposition: 'auto' | 'review' | 'skip' | undefined
  band: 'low' | 'medium' | 'high' | undefined
  hasHardStop: boolean
}): RecommendedRouting
```

- [ ] **Step 1: Write the failing test**

```ts
// src/matcher/recommended-routing.test.ts
import { describe, it, expect } from 'vitest'
import { computeRecommendedRouting } from './recommended-routing.js'

describe('computeRecommendedRouting', () => {
  it('skip disposition always yields skip (band never overrides)', () => {
    expect(computeRecommendedRouting({ disposition: 'skip', band: 'high', hasHardStop: false })).toBe('skip')
    expect(computeRecommendedRouting({ disposition: 'skip', band: 'low', hasHardStop: true })).toBe('skip')
  })

  it('high band + no hard-stop → auto', () => {
    expect(computeRecommendedRouting({ disposition: 'auto', band: 'high', hasHardStop: false })).toBe('auto')
    expect(computeRecommendedRouting({ disposition: 'review', band: 'high', hasHardStop: false })).toBe('auto')
  })

  it('any hard-stop → review even if band high', () => {
    expect(computeRecommendedRouting({ disposition: 'auto', band: 'high', hasHardStop: true })).toBe('review')
  })

  it('medium/low → review', () => {
    expect(computeRecommendedRouting({ disposition: 'auto', band: 'medium', hasHardStop: false })).toBe('review')
    expect(computeRecommendedRouting({ disposition: 'auto', band: 'low', hasHardStop: false })).toBe('review')
  })

  it('missing band → review (safe default when critic absent for routing rec)', () => {
    expect(computeRecommendedRouting({ disposition: 'auto', band: undefined, hasHardStop: false })).toBe('review')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd D:\cobalt-queue ; pnpm exec vitest run src/matcher/recommended-routing.test.ts`
Expected: FAIL (module not found / function not defined)

- [ ] **Step 3: Write minimal implementation**

```ts
// src/matcher/recommended-routing.ts
export type RecommendedRouting = 'auto' | 'review' | 'skip'

/** Band-routing recommendation (design §1). Pure — queue is source of truth for this field. */
export function computeRecommendedRouting(input: {
  disposition: 'auto' | 'review' | 'skip' | undefined
  band: 'low' | 'medium' | 'high' | undefined
  hasHardStop: boolean
}): RecommendedRouting {
  if (input.disposition === 'skip') return 'skip'
  if (input.band === 'high' && !input.hasHardStop) return 'auto'
  return 'review'
}
```

Add to `Decision` in `src/matcher/types.ts` after `criticReview`:

```ts
  /** Band-routing recommendation (Phase 2): auto = high+clean, review = human, skip = not actionable.
   *  Additive — legacy consumers ignore. ShipTrack uses this in shadow mode then for flip. */
  recommendedRouting?: RecommendedRouting
```

Import type: `import type { RecommendedRouting } from './recommended-routing.js'` (or re-export from types to avoid circular deps — prefer defining the union in `recommended-routing.ts` and importing into `types.ts`).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd D:\cobalt-queue ; pnpm exec vitest run src/matcher/recommended-routing.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd D:\cobalt-queue
git add src/matcher/recommended-routing.ts src/matcher/recommended-routing.test.ts src/matcher/types.ts
git commit -m "feat(matcher): add recommendedRouting pure derivation"
```

---

### Task 2: Emit `recommendedRouting` from `runMatcher`

**Files:**
- Modify: `D:\cobalt-queue\src\matcher\runner.ts` (~lines 250–263)
- Modify: `D:\cobalt-queue\test\critic-review-contract.test.ts` (derive assertions via helper using same inputs as golden cases)

**Interfaces:**
- Consumes: `computeRecommendedRouting`, `hardStops`, `riskSignals`, `review.confidence.band`, `disposition`
- Produces: `Decision.recommendedRouting` on every `postDecision` payload

- [ ] **Step 1: Write the failing contract assertions**

In `test/critic-review-contract.test.ts`, after band expectations, add:

```ts
import { computeRecommendedRouting } from '../src/matcher/recommended-routing.js'
import { hardStops, riskSignals } from '../src/matcher/risk-signals.js'

// inside the existing test, after band asserts:
const highDraft = draft({
  matchKey: { booking_no: 'BY058417', so_no: 'SO-1' },
  backendMismatches: [
    { field: 'eta', emailValue: '2026-07-23', backendValue: '2026-07-20', verdict: 'update' },
  ],
})
const multiDraft = draft({
  identifiers: [ident('hbl_awb_fcr_no', 'H1'), ident('hbl_awb_fcr_no', 'H2')],
})
const portalDraft = draft({ fromPlatform: true, matchKey: { customer_po: 'PO-1' } })

expect(computeRecommendedRouting({
  disposition: 'auto',
  band: high.confidence.band,
  hasHardStop: hardStops(riskSignals(highDraft)),
})).toBe('auto')

expect(computeRecommendedRouting({
  disposition: 'review',
  band: multiId.confidence.band,
  hasHardStop: hardStops(riskSignals(multiDraft)),
})).toBe('review')

expect(computeRecommendedRouting({
  disposition: 'review',
  band: portal.confidence.band,
  hasHardStop: hardStops(riskSignals(portalDraft)),
})).toBe('review')
```

(These pass once Task 1 exists; they pin the cross-repo contract for the three golden shapes.)

- [ ] **Step 2: Wire runner**

In `runner.ts`, after `const review = await deps.criticReview.review(...)`:

```ts
import { hardStops, riskSignals } from './risk-signals.js'
import { computeRecommendedRouting } from './recommended-routing.js'

// ...
const recommendedRouting = computeRecommendedRouting({
  disposition,
  band: review.confidence.band,
  hasHardStop: hardStops(riskSignals(draft)),
})
// postDecision:
const result = await deps.sink.postDecision({
  ...draft,
  confidence,
  disposition,
  autoApply,
  reviewReasons: gateReasons,
  criticReview: review,
  recommendedRouting,
})
```

Update the file header comment that says critic is advisory-only for routing if it claims the queue never recommends routing — note that `recommendedRouting` is additive and gate still owns disposition/autoApply.

- [ ] **Step 3: Run tests**

Run:
```
cd D:\cobalt-queue
pnpm exec vitest run src/matcher/recommended-routing.test.ts test/critic-review-contract.test.ts
```
Expected: PASS. If golden fixture equality fails for unrelated reasons, regenerate only if `high` object shape changed (this task should not change critic JSON).

- [ ] **Step 4: Commit**

```bash
cd D:\cobalt-queue
git add src/matcher/runner.ts test/critic-review-contract.test.ts
git commit -m "feat(matcher): emit recommendedRouting on postDecision"
```

---

## Part B — ShipTrack

### Task 3: Migration `0013` + repository + DB types

**Files:**
- Create: `backend/src/db/kysely-migrations/0013_routing_shadow.ts`
- Create: `backend/src/db/repositories/routing-shadow.repository.ts`
- Modify: `backend/src/db/migrate-cli.ts`
- Modify: `backend/src/db/kysely/db.ts`
- Modify: `backend/src/db/repositories.module.ts`
- Modify: `backend/test/setup-db.ts` (export repo in `repos()`)

**Interfaces:**
- Produces table `routing_shadow` and `RoutingShadowRepository.insert` / `listSince`

- [ ] **Step 1: Migration**

```ts
// backend/src/db/kysely-migrations/0013_routing_shadow.ts
import { sql, type Kysely } from 'kysely'

/** 0013 — append-only shadow log of gate vs band routing at decision ingest (Phase 2a). */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`
CREATE TABLE routing_shadow (
  id uniqueidentifier NOT NULL DEFAULT NEWID(),
  shipment_id uniqueidentifier NULL,
  ingested_at datetimeoffset(7) NOT NULL DEFAULT SYSDATETIMEOFFSET(),
  gate_routing nvarchar(20) NOT NULL,
  band_routing nvarchar(20) NOT NULL,
  band nvarchar(10) NULL,
  differs bit NOT NULL,
  reasons_json nvarchar(max) NULL,
  CONSTRAINT pk_routing_shadow PRIMARY KEY (id),
  CONSTRAINT ck_routing_shadow_gate CHECK (gate_routing IN ('confirmed','provisional','skip')),
  CONSTRAINT ck_routing_shadow_band CHECK (band_routing IN ('confirmed','provisional','skip'))
);
CREATE INDEX ix_routing_shadow_ingested_at ON routing_shadow(ingested_at);
CREATE INDEX ix_routing_shadow_differs ON routing_shadow(differs);
CREATE INDEX ix_routing_shadow_shipment_id ON routing_shadow(shipment_id);
`).execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`DROP TABLE IF EXISTS routing_shadow`).execute(db)
}
```

Register in `migrate-cli.ts`:

```ts
import * as m0013_routing_shadow from './kysely-migrations/0013_routing_shadow'
// in MIGRATIONS:
  '0013_routing_shadow': m0013_routing_shadow,
```

- [ ] **Step 2: DB overlay type**

In `db.ts`, add:

```ts
export interface RoutingShadow {
  id: Generated<string>
  shipmentId: string | null
  ingestedAt: Generated<Date>
  gateRouting: 'confirmed' | 'provisional' | 'skip'
  bandRouting: 'confirmed' | 'provisional' | 'skip'
  band: 'low' | 'medium' | 'high' | null
  differs: boolean
  reasonsJson: Json<string[] | null>
}

export interface DB extends Omit<GeneratedDB, 'shipments' | ...> {
  // existing...
  routingShadow: RoutingShadow
}
```

If `GeneratedDB` lacks `routingShadow`, use:

```ts
export interface DB extends Omit<GeneratedDB, 'shipments' | 'bookings' | 'shipmentMilestones' | 'alertRules' | 'reviewEmail' | 'parsedRecord'> {
  // ...
  routingShadow: RoutingShadow
}
```

(Kysely accepts extra tables on the interface even when codegen is stale.)

- [ ] **Step 3: Repository**

```ts
// backend/src/db/repositories/routing-shadow.repository.ts
import { Inject, Injectable } from '@nestjs/common'
import { type Kysely } from 'kysely'
import type { DB } from '../kysely/db'
import { KYSELY } from '../kysely.provider'

export type RoutingStatus = 'confirmed' | 'provisional' | 'skip'

@Injectable()
export class RoutingShadowRepository {
  constructor(@Inject(KYSELY) private readonly db: Kysely<DB>) {}

  insert(row: {
    shipmentId: string | null
    gateRouting: RoutingStatus
    bandRouting: RoutingStatus
    band: 'low' | 'medium' | 'high' | null
    differs: boolean
    reasons: string[] | null
  }) {
    return this.db.insertInto('routingShadow').values({
      shipmentId: row.shipmentId,
      gateRouting: row.gateRouting,
      bandRouting: row.bandRouting,
      band: row.band,
      differs: row.differs,
      reasonsJson: row.reasons ? JSON.stringify(row.reasons) : null,
    }).execute()
  }

  listSince(since: Date, limit = 500) {
    return this.db.selectFrom('routingShadow')
      .where('ingestedAt', '>=', since)
      .orderBy('ingestedAt', 'desc')
      .limit(limit)
      .selectAll()
      .execute()
  }
}
```

Wire into `repositories.module.ts` providers/exports and `repos()` in `setup-db.ts`.

- [ ] **Step 4: Verify migration applies in tests**

Run: `cd D:\cobalt_track_system ; $env:JWT_SECRET='test-jwt-secret-at-least-32-chars-long!!' ; pnpm --filter backend test -- test/foundation.int.spec.ts`
Expected: PASS (migrations include 0013). If foundation doesn't assert table names, a one-line smoke insert in a new test can wait for Task 5.

- [ ] **Step 5: Commit**

```bash
cd D:\cobalt_track_system
git add backend/src/db/kysely-migrations/0013_routing_shadow.ts backend/src/db/migrate-cli.ts backend/src/db/kysely/db.ts backend/src/db/repositories/routing-shadow.repository.ts backend/src/db/repositories.module.ts backend/test/setup-db.ts
git commit -m "feat(db): add routing_shadow table (0013) and repository"
```

---

### Task 4: Settings flag `critic_routing_mode`

**Files:**
- Modify: `backend/src/settings/settings.service.ts`
- Modify: `backend/src/settings/settings.controller.ts`
- Create: `backend/src/settings/settings.service.spec.ts` (unit, mock repo) **or** extend int tests in Task 8 only — prefer a small unit test with a fake repo if easy; otherwise cover via decisions int tests.

**Interfaces:**
```ts
export type CriticRoutingMode = 'gate' | 'band'
export const ROUTING_MODE_KEY = 'critic_routing_mode'
export const DEFAULT_ROUTING_MODE: CriticRoutingMode = 'gate'
// SettingsService:
async criticRoutingMode(): Promise<CriticRoutingMode>
setCriticRoutingMode(value: CriticRoutingMode, updatedBy: string | null): Promise<void>
```

- [ ] **Step 1: Extend service**

```ts
export type CriticRoutingMode = 'gate' | 'band'
export const ROUTING_MODE_KEY = 'critic_routing_mode'
export const DEFAULT_ROUTING_MODE: CriticRoutingMode = 'gate'

async criticRoutingMode(): Promise<CriticRoutingMode> {
  const v = await this.repo.get<string>(ROUTING_MODE_KEY)
  if (v === 'band' || v === 'gate') return v
  return DEFAULT_ROUTING_MODE
}

setCriticRoutingMode(value: CriticRoutingMode, updatedBy: string | null = null) {
  return this.repo.set(ROUTING_MODE_KEY, value, updatedBy)
}
```

- [ ] **Step 2: Controller endpoints** (mirror threshold pattern)

```ts
class RoutingModeDto {
  @IsIn(['gate', 'band']) mode!: 'gate' | 'band'
}

@Roles('EDITOR', 'ADMIN')
@Get('routing-mode')
async getRoutingMode() {
  return { mode: await this.settings.criticRoutingMode() }
}

@Roles('ADMIN')
@Put('routing-mode')
async setRoutingMode(@Body() dto: RoutingModeDto, @CurrentUser() actor: AuthUser) {
  await this.settings.setCriticRoutingMode(dto.mode, actor.id)
  return { mode: dto.mode }
}
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/settings/settings.service.ts backend/src/settings/settings.controller.ts
git commit -m "feat(settings): critic_routing_mode gate|band (default gate)"
```

---

### Task 5: Pure band-routing helpers + dual compute at ingest (still gate-selected)

**Files:**
- Create: `backend/src/decisions/band-routing.ts`
- Create: `backend/src/decisions/band-routing.spec.ts`
- Modify: `backend/src/decisions/dto.ts`
- Modify: `backend/src/decisions/decisions.service.ts`
- Modify: `backend/src/decisions/decisions.module.ts` (inject `RoutingShadowRepository`)

**Interfaces:**
```ts
export const HARD_STOP_RISK_CODES = new Set([
  'INTRA_EMAIL_MULTI_STRONG_ID',
  'AMBIGUOUS_MATCH',
  'BACKEND_CONFLICT',
  'PO_REASSIGN',
  'PORTAL_ECHO',
])

export type ReviewStatus = 'confirmed' | 'provisional' | 'skip'

export function mapRecommendedToStatus(r: 'auto' | 'review' | 'skip' | undefined): ReviewStatus
export function deriveRecommendedFromCritic(critic: CriticReview | null | undefined): 'auto' | 'review' | 'skip' | null
export function hasHardStopFlags(critic: CriticReview | null | undefined): boolean
export function resolveBandRouting(opts: {
  recommendedRouting?: 'auto' | 'review' | 'skip'
  criticReview?: CriticReview | null
  /** when true, force provisional even if recommended auto */
  forceProvisional?: boolean
}): ReviewStatus | null  // null = band routing N/A (no critic)
```

- [ ] **Step 1: Unit tests for pure helpers**

```ts
// band-routing.spec.ts
import { describe, it, expect } from 'vitest'
import {
  mapRecommendedToStatus,
  hasHardStopFlags,
  resolveBandRouting,
  HARD_STOP_RISK_CODES,
} from './band-routing'

describe('band-routing', () => {
  it('maps recommendedRouting to reviewStatus', () => {
    expect(mapRecommendedToStatus('auto')).toBe('confirmed')
    expect(mapRecommendedToStatus('review')).toBe('provisional')
    expect(mapRecommendedToStatus('skip')).toBe('skip')
  })

  it('detects hard-stop risk codes', () => {
    expect(hasHardStopFlags({
      confidence: { score: 90, band: 'high', label: 'High' },
      summary: '', observations: [], priorState: { headline: '', fields: [] },
      proposedChanges: [], riskFlags: [{ code: 'BACKEND_CONFLICT', severity: 'high', message: 'x' }],
      recommendedHumanAction: 'review', reasons: [],
    })).toBe(true)
    expect(hasHardStopFlags({
      confidence: { score: 90, band: 'high', label: 'High' },
      summary: '', observations: [], priorState: { headline: '', fields: [] },
      proposedChanges: [], riskFlags: [],
      recommendedHumanAction: 'approve_ok', reasons: [],
    })).toBe(false)
  })

  it('high + no hard-stop → confirmed; hard-stop overrides to provisional', () => {
    const clean = {
      confidence: { score: 90, band: 'high' as const, label: 'High' },
      summary: '', observations: [], priorState: { headline: '', fields: [] },
      proposedChanges: [], riskFlags: [] as { code: string; severity: 'low' | 'medium' | 'high'; message: string }[],
      recommendedHumanAction: 'approve_ok', reasons: [],
    }
    expect(resolveBandRouting({ recommendedRouting: 'auto', criticReview: clean })).toBe('confirmed')
    expect(resolveBandRouting({
      recommendedRouting: 'auto',
      criticReview: { ...clean, riskFlags: [{ code: 'PO_REASSIGN', severity: 'high', message: 'x' }] },
    })).toBe('provisional')
  })

  it('falls back to critic band when recommendedRouting omitted', () => {
    const high = {
      confidence: { score: 90, band: 'high' as const, label: 'High' },
      summary: '', observations: [], priorState: { headline: '', fields: [] },
      proposedChanges: [], riskFlags: [],
      recommendedHumanAction: 'approve_ok', reasons: [],
    }
    expect(resolveBandRouting({ criticReview: high })).toBe('confirmed')
    expect(resolveBandRouting({ criticReview: { ...high, confidence: { score: 40, band: 'low', label: 'Low' } } })).toBe('provisional')
  })

  it('null when no critic and no recommendedRouting', () => {
    expect(resolveBandRouting({})).toBe(null)
  })

  it('HARD_STOP_RISK_CODES matches queue HARD_STOP_CODES set', () => {
    for (const c of ['INTRA_EMAIL_MULTI_STRONG_ID', 'AMBIGUOUS_MATCH', 'BACKEND_CONFLICT', 'PO_REASSIGN', 'PORTAL_ECHO']) {
      expect(HARD_STOP_RISK_CODES.has(c)).toBe(true)
    }
  })
})
```

- [ ] **Step 2: Implement `band-routing.ts`**

```ts
import type { CriticReview } from './critic-review.types'

export const HARD_STOP_RISK_CODES = new Set([
  'INTRA_EMAIL_MULTI_STRONG_ID',
  'AMBIGUOUS_MATCH',
  'BACKEND_CONFLICT',
  'PO_REASSIGN',
  'PORTAL_ECHO',
])

export type ReviewStatus = 'confirmed' | 'provisional' | 'skip'

export function mapRecommendedToStatus(r: 'auto' | 'review' | 'skip'): ReviewStatus {
  if (r === 'auto') return 'confirmed'
  if (r === 'skip') return 'skip'
  return 'provisional'
}

export function hasHardStopFlags(critic: CriticReview | null | undefined): boolean {
  if (!critic?.riskFlags?.length) return false
  return critic.riskFlags.some((f) => HARD_STOP_RISK_CODES.has(f.code))
}

export function resolveBandRouting(opts: {
  recommendedRouting?: 'auto' | 'review' | 'skip'
  criticReview?: CriticReview | null
}): ReviewStatus | null {
  const rec = opts.recommendedRouting
  if (rec === 'skip') return 'skip'
  if (rec === 'auto' || rec === 'review') {
    let status = mapRecommendedToStatus(rec)
    if (status === 'confirmed' && hasHardStopFlags(opts.criticReview)) status = 'provisional'
    return status
  }
  // fallback: derive from criticReview only
  const c = opts.criticReview
  if (!c) return null
  if (c.confidence?.band === 'high' && !hasHardStopFlags(c)) return 'confirmed'
  return 'provisional'
}
```

- [ ] **Step 3: DTO field**

```ts
@IsOptional() @IsIn(['auto', 'review', 'skip']) recommendedRouting?: 'auto' | 'review' | 'skip'
```

- [ ] **Step 4: Ingest dual-route (still apply gate; always shadow when critic present)**

In `decisions.service.ts`, after the existing block that sets `reviewStatus` / cancel force (so `gateRouting` includes cancel override):

```ts
const gateRouting: 'provisional' | 'confirmed' | 'skip' = /* for skip early-return path, write shadow if critic present then return */
// For non-skip path, after cancel handling:
const gateRouting = reviewStatus // current value after cancel clamp

const critic = (dto.criticReview ?? null) as CriticReview | null
const bandRouting = resolveBandRouting({
  recommendedRouting: dto.recommendedRouting,
  criticReview: critic,
})

// Shadow: only when criticReview present (band routing applicable)
if (critic && bandRouting) {
  // shipmentId known after commit — write after apply() with result.shipmentId
}

// Mode select (Task 7 will flip; for now force gate):
const mode = await this.settings.criticRoutingMode()
if (mode === 'band' && bandRouting && bandRouting !== 'skip') {
  reviewStatus = bandRouting === 'confirmed' ? 'confirmed' : 'provisional'
  // audit reason appended in Task 7
}
// default gate: leave reviewStatus as-is
```

**Important for skip early-return:** if `disp.disposition === 'skip'` and `dto.criticReview` is present, still insert a shadow row with `shipmentId: null`, `gateRouting: 'skip'`, `bandRouting: 'skip'` (or derived), then return. If no critic, skip shadow as today.

**Write shadow after `committer.apply`** so `shipmentId` is available:

```ts
const result = await this.committer.apply(group)
if (critic && bandRouting) {
  await this.routingShadow.insert({
    shipmentId: result.shipmentId || null,
    gateRouting,
    bandRouting,
    band: critic.confidence?.band ?? null,
    differs: gateRouting !== bandRouting,
    reasons: [
      ...(dto.reviewReasons ?? []),
      `gate=${gateRouting}`,
      `band=${bandRouting}`,
      mode === 'band' ? 'mode=band' : 'mode=gate',
    ],
  })
}
return { ...result, confidence: dto.confidence, reviewStatus }
```

Inject `RoutingShadowRepository` in constructor; update `decisions.module` / int test constructors.

**For this task, mode selection can call `criticRoutingMode()` but default remains gate** — unit/int tests must still show unchanged routing.

- [ ] **Step 5: Run pure unit tests**

Run: `pnpm --filter backend test -- src/decisions/band-routing.spec.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/decisions/band-routing.ts backend/src/decisions/band-routing.spec.ts backend/src/decisions/dto.ts backend/src/decisions/decisions.service.ts backend/src/decisions/decisions.module.ts
git commit -m "feat(decisions): dual gate/band routing + shadow write at ingest"
```

---

### Task 6: Shadow-diff report API

**Files:**
- Modify: `backend/src/settings/settings.controller.ts` (or new controller; keep under settings for admin config surface)
- Create: `backend/src/settings/routing-shadow-report.ts` pure aggregator
- Create: `backend/src/settings/routing-shadow-report.spec.ts`
- Modify: inject `RoutingShadowRepository` into settings controller/service

**Interfaces:**
```ts
// GET /api/settings/routing-shadow?days=30
{
  windowDays: number
  total: number
  differs: number
  autoToReview: number   // gate confirmed → band provisional
  reviewToAuto: number   // gate provisional → band confirmed
  samples: Array<{
    shipmentId: string | null
    ingestedAt: string
    gateRouting: string
    bandRouting: string
    band: string | null
    differs: boolean
  }>  // up to 50 most recent differs, else recent
}
```

- [ ] **Step 1: Pure aggregator unit test**

```ts
import { describe, it, expect } from 'vitest'
import { aggregateRoutingShadow } from './routing-shadow-report'

describe('aggregateRoutingShadow', () => {
  it('counts totals and flip directions', () => {
    const rows = [
      { gateRouting: 'confirmed', bandRouting: 'confirmed', differs: false, shipmentId: 'a', ingestedAt: new Date(), band: 'high' },
      { gateRouting: 'provisional', bandRouting: 'confirmed', differs: true, shipmentId: 'b', ingestedAt: new Date(), band: 'high' },
      { gateRouting: 'confirmed', bandRouting: 'provisional', differs: true, shipmentId: 'c', ingestedAt: new Date(), band: 'low' },
    ]
    const r = aggregateRoutingShadow(rows, 30)
    expect(r.total).toBe(3)
    expect(r.differs).toBe(2)
    expect(r.reviewToAuto).toBe(1)
    expect(r.autoToReview).toBe(1)
  })
})
```

- [ ] **Step 2: Implement + wire GET**

```ts
@Roles('EDITOR', 'ADMIN')
@Get('routing-shadow')
async routingShadowReport(@Query('days') daysRaw?: string) {
  const days = Math.min(90, Math.max(1, Number(daysRaw) || 30))
  const since = new Date(Date.now() - days * 86400000)
  const rows = await this.routingShadow.listSince(since, 2000)
  return aggregateRoutingShadow(rows, days)
}
```

Wire repository into `SettingsModule` (import `RepositoriesModule` if not already).

- [ ] **Step 3: Run unit test + commit**

```bash
pnpm --filter backend test -- src/settings/routing-shadow-report.spec.ts
git add backend/src/settings/
git commit -m "feat(settings): GET routing-shadow shadow-diff report"
```

---

### Task 7: Band mode flip + audit reason on leg

**Files:**
- Modify: `backend/src/decisions/decisions.service.ts` (finalize mode branch + reviewReasons)
- Ensure hard-stop already in `resolveBandRouting`

**Behavior under `mode === 'band'`:**
1. If `bandRouting === 'skip'` — should not happen on commit path (skip returned early); if it did, keep skip semantics.
2. Else set `reviewStatus` from `bandRouting` (`confirmed` | `provisional`).
3. Cancel flag still wins (force provisional) — apply cancel **after** mode select, or re-apply cancel last (cancel must remain authoritative).
4. Append audit-ish reason into `reviewReasons`:
   - `band auto-confirmed` when band confirmed
   - `band held for review` when band provisional
5. Shadow row still written in both modes.

**Order of operations (lock this):**

```
1. disposition skip → early return (+ optional shadow)
2. compute gate reviewStatus (existing ternary + disposition)
3. cancel force provisional (existing)
4. gateRouting = reviewStatus
5. bandRouting = resolveBandRouting(...)
6. if mode==='band' && bandRouting in (confirmed, provisional):
     reviewStatus = bandRouting
     append band reason to reviewReasons
7. re-apply cancel force if cancelled (cancel always wins)
8. commit
9. shadow write if critic present
```

- [ ] **Step 1: Implement order above in `ingest`**
- [ ] **Step 2: Unit coverage via int tests in Task 8**
- [ ] **Step 3: Commit**

```bash
git commit -am "feat(decisions): honor critic_routing_mode=band with cancel/hard-stop guards"
```

---

### Task 8: Integration tests (acceptance + shadow proof)

**Files:**
- Modify: `backend/test/decisions.int.spec.ts`
- Update `DecisionsService` constructor in all test files that new it up (`decisions-evidence.int.spec.ts` etc.)

**Helper critic payloads:**

```ts
const criticHigh = {
  confidence: { score: 92, band: 'high', label: 'High' },
  summary: 'Clean',
  observations: [],
  priorState: { headline: 'New', fields: [] },
  proposedChanges: [],
  riskFlags: [],
  recommendedHumanAction: 'approve_ok',
  reasons: [],
}
const criticHardStop = {
  ...criticHigh,
  confidence: { score: 20, band: 'low', label: 'Low' },
  riskFlags: [{ code: 'INTRA_EMAIL_MULTI_STRONG_ID', severity: 'high', message: 'multi' }],
}
```

- [ ] **Step 1: Tests to add**

```ts
describe('Phase 2 routing shadow + mode', () => {
  it('default gate mode: autoApply false stays provisional even if recommendedRouting auto (shadow differs)', async () => {
    const res = await decisions.ingest(decision({
      confidence: 92,
      autoApply: false,
      disposition: 'review',
      recommendedRouting: 'auto',
      criticReview: criticHigh,
    }))
    expect(res.reviewStatus).toBe('provisional') // gate unchanged
    const shadows = await db.selectFrom('routingShadow').selectAll().execute()
    expect(shadows).toHaveLength(1)
    expect(shadows[0].gateRouting).toBe('provisional')
    expect(shadows[0].bandRouting).toBe('confirmed')
    expect(shadows[0].differs).toBe(true)
  })

  it('band mode: high clean recommendedRouting auto → confirmed', async () => {
    await settings.setCriticRoutingMode('band')
    const res = await decisions.ingest(decision({
      confidence: 50,
      autoApply: false,
      disposition: 'review',
      recommendedRouting: 'auto',
      criticReview: criticHigh,
    }))
    expect(res.reviewStatus).toBe('confirmed')
    const [leg] = await db.selectFrom('shipments').selectAll().execute()
    const reasons = leg.reviewReasons as string[]
    expect(reasons.some((r) => /band auto-confirm/i.test(r))).toBe(true)
  })

  it('band mode: hard-stop risk flag still provisional even if recommendedRouting auto', async () => {
    await settings.setCriticRoutingMode('band')
    const res = await decisions.ingest(decision({
      confidence: 99,
      autoApply: true,
      disposition: 'auto',
      recommendedRouting: 'auto',
      criticReview: {
        ...criticHigh,
        riskFlags: [{ code: 'BACKEND_CONFLICT', severity: 'high', message: 'conflict' }],
      },
    }))
    expect(res.reviewStatus).toBe('provisional')
  })

  it('legacy no criticReview: no shadow row; gate routing unchanged', async () => {
    const res = await decisions.ingest(decision({ confidence: 92, autoApply: true }))
    expect(res.reviewStatus).toBe('confirmed')
    expect(await db.selectFrom('routingShadow').selectAll().execute()).toHaveLength(0)
  })

  it('shadow proof: default gate outcomes identical with vs without recommendedRouting present', async () => {
    const a = await decisions.ingest(decision({
      matchKey: { so_no: 'SO-A' }, fields: { so_no: 'SO-A' },
      confidence: 92, autoApply: false, criticReview: criticHigh, recommendedRouting: 'auto',
    }))
    const b = await decisions.ingest(decision({
      matchKey: { so_no: 'SO-B' }, fields: { so_no: 'SO-B' },
      confidence: 92, autoApply: false, criticReview: criticHigh,
    }))
    expect(a.reviewStatus).toBe('provisional')
    expect(b.reviewStatus).toBe('provisional')
  })

  it('cancel still forces provisional under band mode', async () => {
    await settings.setCriticRoutingMode('band')
    const res = await decisions.ingest(decision({
      confidence: 99, autoApply: true, cancelled: true,
      recommendedRouting: 'auto', criticReview: criticHigh,
    }))
    expect(res.reviewStatus).toBe('provisional')
  })
})
```

- [ ] **Step 2: Run full decisions int suite**

```
cd D:\cobalt_track_system
$env:JWT_SECRET='test-jwt-secret-at-least-32-chars-long!!'
pnpm --filter backend test -- test/decisions.int.spec.ts
```
Expected: all PASS

- [ ] **Step 3: Lint**

```
pnpm --filter backend lint
```
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add backend/test/decisions.int.spec.ts backend/test/decisions-evidence.int.spec.ts
git commit -m "test(decisions): phase2 shadow routing + band mode safety"
```

---

## Self-review (plan vs spec)

| Spec section | Task coverage |
|---|---|
| §1 routing rule | Task 1 (`computeRecommendedRouting`), Task 5 (`resolveBandRouting`) |
| Part A queue emit | Task 2 |
| Part B dual compute | Task 5 |
| `routing_shadow` table | Task 3 |
| Shadow-diff report | Task 6 |
| Flip flag default gate | Task 4 + 5/7 |
| Hard-stop server-side | Task 5 + 7 + 8 |
| Audit under band | Task 7 (`reviewReasons` notes) |
| Legacy no critic | Task 5/8 |
| Skip stays skip | Task 1 + early-return path Task 5 |
| Shadow proof no behavior change | Task 8 |
| Phase 2b staged flip | Explicitly out of scope (open item deferred) |

**Placeholder scan:** none intentional.  
**Type consistency:** `RecommendedRouting` = `'auto'|'review'|'skip'`; review status = `'confirmed'|'provisional'|'skip'`; mode = `'gate'|'band'`.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-15-critic-review-phase2-routing.md`.

Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — execute tasks in this session with executing-plans checkpoints  

Which approach?
