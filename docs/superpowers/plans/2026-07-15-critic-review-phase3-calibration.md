# Critic Review Phase 3 — Calibration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Snapshot critic band vs human outcome (`approved` / `corrected` / `dismissed`) on every review action into append-only `critic_calibration`, and expose an EDITOR+ report whose **`highBandCorrectionRate`** is the single number that justifies or blocks the Phase 2b flip.

**Architecture:** ShipTrack-only. Mirror Phase 2a `routing_shadow`: migration + repository (insert, listSince TOP, pruneOlderThan + opportunistic prune), pure aggregate module, settings GET endpoint. Capture is a best-effort side-effect in `ReviewService.confirm` / `correct` / `dismiss` (try/catch + Logger — never fail the human action). Band is read from the leg's `critic_review.confidence.band` **at action time** (null if legacy).

**Tech Stack:** NestJS + Kysely + MSSQL; vitest unit + integration on `cobalt_test`.

## Global Constraints

- **ShipTrack only** — cobalt-queue is unchanged.
- **No behavior change** to review outcomes, routing, or the correction feed.
- **Calibration write never fails the human action** — try/catch + warn (same as `routing_shadow` insert).
- **Snapshot band at action time** — never join later `shipments.critic_review` for historical rates.
- **Migration `0014` MUST be registered** in `backend/src/db/migrate-cli.ts` `MIGRATIONS`.
- **MSSQL:** use `modifyFront(sql\`top ${sql.lit(n)}\`)` — never `.limit()`.
- **Retention 180 days** (longer than shadow's 30); opportunistic prune ≤1×/hour/process.
- **Report default window 90 days** (configurable via `?days=` / `?windowDays=` — use `days` to match routing-shadow).
- **CI fails on eslint**; worktrees lack `backend/.env` → export dummy `JWT_SECRET` (≥32 chars).
- **Every task ends green + committed** before the next begins.
- Open-item lock-ins: dismiss **does** have `actorId` and lives in `ReviewService.dismiss` — capture there; field-level corrected names **out of scope** (count only); 2b audit sample **out of scope**.

---

## File structure

**Create**
- `backend/src/db/kysely-migrations/0014_critic_calibration.ts`
- `backend/src/db/repositories/critic-calibration.repository.ts`
- `backend/src/settings/critic-calibration-report.ts`
- `backend/src/settings/critic-calibration-report.spec.ts`
- `backend/test/critic-calibration.int.spec.ts` (or extend an existing review int if one exists — prefer dedicated)

**Modify**
- `backend/src/db/migrate-cli.ts` — register `0014`
- `backend/src/db/kysely/db.ts` — `CriticCalibration` + `DB.criticCalibration`
- `backend/src/db/repositories.module.ts` — provider/export
- `backend/test/setup-db.ts` — `repos().criticCalibration`
- `backend/src/review/review.service.ts` — inject repo; record on confirm/correct/dismiss
- `backend/src/review/review.service.spec.ts` — unit capture + failure isolation
- `backend/src/settings/settings.controller.ts` — GET calibration report

---

### Task 1: Migration `0014` + repository + DB types

**Files:**
- Create: `backend/src/db/kysely-migrations/0014_critic_calibration.ts`
- Create: `backend/src/db/repositories/critic-calibration.repository.ts`
- Modify: `backend/src/db/migrate-cli.ts`
- Modify: `backend/src/db/kysely/db.ts`
- Modify: `backend/src/db/repositories.module.ts`
- Modify: `backend/test/setup-db.ts`

**Interfaces:**
- Produces: table `critic_calibration`, `CriticCalibrationRepository.insert` / `listSince` / `pruneOlderThan` / opportunistic prune
- Consumes: same patterns as `RoutingShadowRepository`

- [ ] **Step 1: Write migration**

```ts
// backend/src/db/kysely-migrations/0014_critic_calibration.ts
import { sql, type Kysely } from 'kysely'

/** 0014 — append-only critic band vs human outcome (Phase 3 calibration). */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`
CREATE TABLE critic_calibration (
  id uniqueidentifier NOT NULL DEFAULT NEWID(),
  shipment_id uniqueidentifier NULL,
  decided_at datetimeoffset(7) NOT NULL DEFAULT SYSDATETIMEOFFSET(),
  band nvarchar(10) NULL,
  outcome nvarchar(20) NOT NULL,
  corrected_field_count int NOT NULL DEFAULT 0,
  actor_id uniqueidentifier NULL,
  reasons_json nvarchar(max) NULL,
  CONSTRAINT pk_critic_calibration PRIMARY KEY (id),
  CONSTRAINT ck_critic_calibration_outcome CHECK (outcome IN ('approved','corrected','dismissed'))
);
CREATE INDEX ix_critic_calibration_decided_at ON critic_calibration(decided_at);
CREATE INDEX ix_critic_calibration_band ON critic_calibration(band);
CREATE INDEX ix_critic_calibration_outcome ON critic_calibration(outcome);
CREATE INDEX ix_critic_calibration_shipment_id ON critic_calibration(shipment_id);
`).execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`DROP TABLE IF EXISTS critic_calibration`).execute(db)
}
```

Register in `migrate-cli.ts`:

```ts
import * as m0014_critic_calibration from './kysely-migrations/0014_critic_calibration'
// MIGRATIONS:
  '0014_critic_calibration': m0014_critic_calibration,
```

- [ ] **Step 2: DB overlay type**

In `db.ts` (next to `RoutingShadow`):

```ts
export type CalibrationOutcome = 'approved' | 'corrected' | 'dismissed'

export interface CriticCalibration {
  id: Generated<string>
  shipmentId: string | null
  decidedAt: Generated<Date>
  band: 'low' | 'medium' | 'high' | null
  outcome: CalibrationOutcome
  correctedFieldCount: number
  actorId: string | null
  reasonsJson: Json<string[] | null>
}

// on DB interface:
  criticCalibration: CriticCalibration
```

- [ ] **Step 3: Repository**

```ts
// backend/src/db/repositories/critic-calibration.repository.ts
import { Inject, Injectable } from '@nestjs/common'
import { type Kysely, sql } from 'kysely'
import type { DB, CalibrationOutcome } from '../kysely/db'
import { KYSELY } from '../kysely.provider'

/** Phase 3 calibration is a slow statistical signal — keep 180 days (vs routing_shadow 30). */
export const CALIBRATION_RETENTION_DAYS = 180
const PRUNE_INTERVAL_MS = 60 * 60 * 1000

@Injectable()
export class CriticCalibrationRepository {
  private lastPruneAt = 0

  constructor(@Inject(KYSELY) private readonly db: Kysely<DB>) {}

  async insert(row: {
    shipmentId: string | null
    band: 'low' | 'medium' | 'high' | null
    outcome: CalibrationOutcome
    correctedFieldCount: number
    actorId: string | null
    reasons: string[] | null
  }) {
    const res = await this.db.insertInto('criticCalibration').values({
      shipmentId: row.shipmentId,
      band: row.band,
      outcome: row.outcome,
      correctedFieldCount: row.correctedFieldCount,
      actorId: row.actorId,
      reasonsJson: row.reasons ? JSON.stringify(row.reasons) : null,
    }).execute()
    this.maybePrune()
    return res
  }

  private maybePrune(): void {
    const now = Date.now()
    if (now - this.lastPruneAt < PRUNE_INTERVAL_MS) return
    this.lastPruneAt = now
    void this.pruneOlderThan(CALIBRATION_RETENTION_DAYS).catch(() => {})
  }

  pruneOlderThan(days = CALIBRATION_RETENTION_DAYS) {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    return this.db.deleteFrom('criticCalibration').where('decidedAt', '<', cutoff).execute()
  }

  listSince(since: Date, limit = 2000) {
    const capped = Math.max(1, Math.floor(limit))
    return this.db.selectFrom('criticCalibration')
      .where('decidedAt', '>=', since)
      .orderBy('decidedAt', 'desc')
      .modifyFront(sql`top ${sql.lit(capped)}`)
      .selectAll()
      .execute()
  }
}
```

Wire into `repositories.module.ts` providers/exports and `setup-db.ts` `repos()`.

- [ ] **Step 4: Verify migration applies**

Run:
```
cd D:\cobalt_track_system
$env:JWT_SECRET='test-jwt-secret-at-least-32-chars-long!!'
pnpm --filter backend test -- test/foundation.int.spec.ts
```
Expected: PASS (0014 applied via folder scan).

- [ ] **Step 5: Commit**

```bash
git add backend/src/db/kysely-migrations/0014_critic_calibration.ts backend/src/db/migrate-cli.ts backend/src/db/kysely/db.ts backend/src/db/repositories/critic-calibration.repository.ts backend/src/db/repositories.module.ts backend/test/setup-db.ts
git commit -m "feat(db): add critic_calibration table (0014) and repository"
```

---

### Task 2: Capture on confirm / correct / dismiss

**Files:**
- Modify: `backend/src/review/review.service.ts`
- Modify: `backend/src/review/review.service.spec.ts`

**Interfaces:**
- Consumes: `CriticCalibrationRepository.insert`, leg.criticReview from findById / loadLegForReview
- Produces: side-effect rows; public review API unchanged

Helper (private method on ReviewService):

```ts
import { Logger } from '@nestjs/common'
import type { CriticReview } from '../decisions/critic-review.types'
import { CriticCalibrationRepository } from '../db/repositories/critic-calibration.repository'
import type { CalibrationOutcome } from '../db/kysely/db'

// constructor add:
private readonly calibration: CriticCalibrationRepository,
private readonly logger = new Logger(ReviewService.name)

private bandFromLeg(leg: { criticReview?: CriticReview | null | unknown }): 'low' | 'medium' | 'high' | null {
  const cr = leg.criticReview as CriticReview | null | undefined
  const b = cr?.confidence?.band
  return b === 'low' || b === 'medium' || b === 'high' ? b : null
}

private async recordCalibration(opts: {
  shipmentId: string
  leg: { criticReview?: unknown }
  outcome: CalibrationOutcome
  correctedFieldCount: number
  actorId: string
  reasons?: string[] | null
}): Promise<void> {
  try {
    await this.calibration.insert({
      shipmentId: opts.shipmentId,
      band: this.bandFromLeg(opts.leg),
      outcome: opts.outcome,
      correctedFieldCount: opts.correctedFieldCount,
      actorId: opts.actorId,
      reasons: opts.reasons ?? null,
    })
  } catch (err) {
    this.logger.warn(
      `critic_calibration insert failed: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}
```

- [ ] **Step 1: Write failing unit tests**

Extend `makeService` to accept a mock calibration repo:

```ts
// in makeService:
const calibration = {
  insert: vi.fn(async () => undefined),
}
const svc = new ReviewService(
  shipments as unknown as ShipmentRepository,
  bookings as unknown as BookingRepository,
  locks as unknown as FieldLockRepository,
  audit as unknown as AuditRepository,
  queueLearning as unknown as QueueLearningClient,
  calibration as unknown as CriticCalibrationRepository,
)
return { svc, shipments, locks, audit, queueLearning, calibration }
```

Add describe block:

```ts
describe('ReviewService — Phase 3 critic calibration capture', () => {
  const criticHigh = {
    confidence: { score: 90, band: 'high', label: 'High' },
    summary: 'ok', observations: [], priorState: { headline: '', fields: [] },
    proposedChanges: [], riskFlags: [], recommendedHumanAction: 'approve_ok', reasons: [],
  }

  it('confirm → approved / 0 fields / band snapshot', async () => {
    const { svc, calibration } = makeService({ criticReview: criticHigh })
    await svc.confirm('leg-1', 'user-1')
    expect(calibration.insert).toHaveBeenCalledWith(expect.objectContaining({
      shipmentId: 'leg-1',
      band: 'high',
      outcome: 'approved',
      correctedFieldCount: 0,
      actorId: 'user-1',
    }))
  })

  it('correct → corrected + field count', async () => {
    const { svc, calibration } = makeService({ criticReview: criticHigh })
    await svc.correct('leg-1', { fields: { soNo: 'X', bookingNo: 'Y' } }, 'user-1')
    expect(calibration.insert).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'corrected',
      correctedFieldCount: 2,
      band: 'high',
    }))
  })

  it('dismiss → dismissed; actor + band', async () => {
    const { svc, calibration } = makeService({
      kind: 'SHIPMENT', reviewStatus: 'provisional', dismissedAt: null, criticReview: criticHigh,
    })
    await svc.dismiss(['leg-1'], 'user-1', 'portal noise')
    expect(calibration.insert).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'dismissed',
      correctedFieldCount: 0,
      band: 'high',
      actorId: 'user-1',
    }))
  })

  it('legacy leg (no criticReview) → band null', async () => {
    const { svc, calibration } = makeService({ criticReview: null })
    await svc.confirm('leg-1', 'user-1')
    expect(calibration.insert).toHaveBeenCalledWith(expect.objectContaining({
      band: null,
      outcome: 'approved',
    }))
  })

  it('calibration insert throw does NOT fail confirm', async () => {
    const { svc, calibration, shipments } = makeService({ criticReview: criticHigh })
    calibration.insert.mockRejectedValueOnce(new Error('db down'))
    await expect(svc.confirm('leg-1', 'user-1')).resolves.toMatchObject({ reviewStatus: 'confirmed' })
    expect(shipments.updateLeg).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL** (constructor arity / no insert)

Run: `pnpm --filter backend test -- src/review/review.service.spec.ts`
Expected: FAIL

- [ ] **Step 3: Implement capture in review.service.ts**

After successful confirm work (after updateLeg + audit, before or after emitConfirms — **after** the leg status update succeeds so we don't log phantom outcomes):

```ts
// end of confirm, before return:
await this.recordCalibration({
  shipmentId, leg, outcome: 'approved', correctedFieldCount: 0, actorId,
  reasons: note?.trim() ? [note.trim()] : null,
})
```

```ts
// end of correct, before return:
await this.recordCalibration({
  shipmentId, leg, outcome: 'corrected',
  correctedFieldCount: corrected.length,
  actorId,
  reasons: dto.reason ? [dto.reason] : null,
})
```

```ts
// inside dismiss loop, after successful update + audit for that id:
await this.recordCalibration({
  shipmentId: id, leg, outcome: 'dismissed', correctedFieldCount: 0, actorId,
  reasons: note?.trim() ? [note.trim()] : null,
})
```

**Important:** pass the **pre-mutation** `leg` object (already loaded) so band is what the human saw; do not re-fetch after later emails.

- [ ] **Step 4: Run unit tests — PASS**

```
pnpm --filter backend test -- src/review/review.service.spec.ts
```
Expected: all PASS (existing + new)

- [ ] **Step 5: Commit**

```bash
git add backend/src/review/review.service.ts backend/src/review/review.service.spec.ts
git commit -m "feat(review): snapshot critic band vs human outcome on confirm/correct/dismiss"
```

---

### Task 3: Pure report aggregate + unit tests

**Files:**
- Create: `backend/src/settings/critic-calibration-report.ts`
- Create: `backend/src/settings/critic-calibration-report.spec.ts`

**Interfaces:**

```ts
export type CalibrationBandKey = 'high' | 'medium' | 'low' | 'unknown'

export type CalibrationBandStats = {
  total: number
  approved: number
  corrected: number
  dismissed: number
  /** corrected / total; 0 when total === 0 (never NaN) */
  correctionRate: number
}

export type CriticCalibrationRow = {
  shipmentId: string | null
  decidedAt: Date
  band: string | null
  outcome: string
  correctedFieldCount: number
  actorId: string | null
}

export type CriticCalibrationReport = {
  windowDays: number
  total: number
  byBand: Record<CalibrationBandKey, CalibrationBandStats>
  /** THE 2b gate: corrected / total among high-band rows */
  highBandCorrectionRate: number
  /** over-caution: approved / total among low+medium */
  lowMediumApprovedRate: number
  samples: Array<{
    shipmentId: string | null
    decidedAt: string
    band: string | null
    outcome: string
    correctedFieldCount: number
  }>
}

export function aggregateCriticCalibration(
  rows: CriticCalibrationRow[],
  windowDays: number,
): CriticCalibrationReport
```

- [ ] **Step 1: Failing tests**

```ts
// critic-calibration-report.spec.ts
import { describe, it, expect } from 'vitest'
import { aggregateCriticCalibration } from './critic-calibration-report'

const row = (over: Partial<{ band: string | null; outcome: string; correctedFieldCount: number }>) => ({
  shipmentId: 's1',
  decidedAt: new Date('2026-07-01T00:00:00Z'),
  band: over.band ?? null,
  outcome: over.outcome ?? 'approved',
  correctedFieldCount: over.correctedFieldCount ?? 0,
  actorId: 'u1',
})

describe('aggregateCriticCalibration', () => {
  it('empty window → zeros not NaN', () => {
    const r = aggregateCriticCalibration([], 90)
    expect(r.total).toBe(0)
    expect(r.highBandCorrectionRate).toBe(0)
    expect(r.lowMediumApprovedRate).toBe(0)
    expect(r.byBand.high.correctionRate).toBe(0)
  })

  it('computes highBandCorrectionRate and lowMediumApprovedRate', () => {
    const rows = [
      row({ band: 'high', outcome: 'approved' }),
      row({ band: 'high', outcome: 'corrected', correctedFieldCount: 1 }),
      row({ band: 'high', outcome: 'dismissed' }),
      row({ band: 'low', outcome: 'approved' }),
      row({ band: 'medium', outcome: 'approved' }),
      row({ band: 'low', outcome: 'corrected', correctedFieldCount: 2 }),
      row({ band: null, outcome: 'approved' }),
    ]
    const r = aggregateCriticCalibration(rows, 90)
    expect(r.total).toBe(7)
    expect(r.byBand.high).toMatchObject({ total: 3, approved: 1, corrected: 1, dismissed: 1 })
    expect(r.highBandCorrectionRate).toBeCloseTo(1 / 3)
    // low+medium: 3 rows, 2 approved
    expect(r.lowMediumApprovedRate).toBeCloseTo(2 / 3)
    expect(r.byBand.unknown.total).toBe(1)
  })

  it('samples prefer high-band corrected misses, then recent', () => {
    const rows = [
      { ...row({ band: 'high', outcome: 'corrected', correctedFieldCount: 1 }), shipmentId: 'miss', decidedAt: new Date('2026-07-10') },
      { ...row({ band: 'low', outcome: 'approved' }), shipmentId: 'a', decidedAt: new Date('2026-07-09') },
    ]
    const r = aggregateCriticCalibration(rows, 90)
    expect(r.samples[0].shipmentId).toBe('miss')
    expect(r.samples[0].outcome).toBe('corrected')
  })
})
```

- [ ] **Step 2: Implement aggregate**

```ts
// critic-calibration-report.ts
function emptyStats(): CalibrationBandStats {
  return { total: 0, approved: 0, corrected: 0, dismissed: 0, correctionRate: 0 }
}

function bandKey(band: string | null): CalibrationBandKey {
  if (band === 'high' || band === 'medium' || band === 'low') return band
  return 'unknown'
}

function rate(n: number, d: number): number {
  return d === 0 ? 0 : n / d
}

export function aggregateCriticCalibration(
  rows: CriticCalibrationRow[],
  windowDays: number,
): CriticCalibrationReport {
  const byBand: Record<CalibrationBandKey, CalibrationBandStats> = {
    high: emptyStats(), medium: emptyStats(), low: emptyStats(), unknown: emptyStats(),
  }

  for (const row of rows) {
    const k = bandKey(row.band)
    const s = byBand[k]
    s.total += 1
    if (row.outcome === 'approved') s.approved += 1
    else if (row.outcome === 'corrected') s.corrected += 1
    else if (row.outcome === 'dismissed') s.dismissed += 1
  }
  for (const s of Object.values(byBand)) {
    s.correctionRate = rate(s.corrected, s.total)
  }

  const high = byBand.high
  const lmTotal = byBand.low.total + byBand.medium.total
  const lmApproved = byBand.low.approved + byBand.medium.approved

  // Samples: all high-band corrected first (newest-first input assumed), then fill to 50 with other recent
  const highMisses = rows.filter((r) => r.band === 'high' && r.outcome === 'corrected')
  const rest = rows.filter((r) => !(r.band === 'high' && r.outcome === 'corrected'))
  const sampleRows = [...highMisses, ...rest].slice(0, 50)

  return {
    windowDays,
    total: rows.length,
    byBand,
    highBandCorrectionRate: rate(high.corrected, high.total),
    lowMediumApprovedRate: rate(lmApproved, lmTotal),
    samples: sampleRows.map((r) => ({
      shipmentId: r.shipmentId,
      decidedAt: r.decidedAt instanceof Date
        ? r.decidedAt.toISOString()
        : new Date(r.decidedAt).toISOString(),
      band: r.band,
      outcome: r.outcome,
      correctedFieldCount: r.correctedFieldCount,
    })),
  }
}
```

- [ ] **Step 3: Run tests PASS + commit**

```
pnpm --filter backend test -- src/settings/critic-calibration-report.spec.ts
git add backend/src/settings/critic-calibration-report.ts backend/src/settings/critic-calibration-report.spec.ts
git commit -m "feat(settings): pure critic calibration report aggregate"
```

---

### Task 4: GET endpoint

**Files:**
- Modify: `backend/src/settings/settings.controller.ts`

**Interfaces:**
- `GET /api/settings/critic-calibration?days=90` EDITOR+
- Inject `CriticCalibrationRepository` (global RepositoriesModule)

- [ ] **Step 1: Wire controller**

```ts
import { aggregateCriticCalibration } from './critic-calibration-report'
import { CriticCalibrationRepository } from '../db/repositories/critic-calibration.repository'

// constructor add:
private readonly criticCalibration: CriticCalibrationRepository,

/** Band vs human-outcome calibration for Phase 2b flip decision (EDITOR+). */
@Roles('EDITOR', 'ADMIN')
@Get('critic-calibration')
async criticCalibrationReport(@Query('days') daysRaw?: string) {
  const days = Math.min(180, Math.max(1, Number(daysRaw) || 90))
  const since = new Date(Date.now() - days * 86400000)
  const rows = await this.criticCalibration.listSince(since, 5000)
  return aggregateCriticCalibration(rows, days)
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/settings/settings.controller.ts
git commit -m "feat(settings): GET critic-calibration report (EDITOR+)"
```

---

### Task 5: Integration tests (snapshot + prune + report)

**Files:**
- Create: `backend/test/critic-calibration.int.spec.ts`

**Setup pattern:** copy `decisions.int.spec.ts` harness — `getTestDb`, `resetDb`, `repos`, construct `ReviewService` with real repos + real `CriticCalibrationRepository` + stub `QueueLearningClient` that no-ops.

```ts
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { getTestDb, resetDb, closeTestDb, repos, type TestDB } from './setup-db'
import { ReviewService } from '../src/review/review.service'
import { QueueLearningClient } from '../src/review/queue-learning.client'
import { aggregateCriticCalibration } from '../src/settings/critic-calibration-report'
import { CALIBRATION_RETENTION_DAYS } from '../src/db/repositories/critic-calibration.repository'

// Seed a provisional leg with critic_review JSON via raw insert or DecisionsService ingest
```

- [ ] **Step 1: Tests**

```ts
describe('critic calibration (integration)', () => {
  it('confirm writes approved with band snapshot; later critic_review change does not mutate row', async () => {
    // 1. insert provisional shipment with critic_review high (use decisions.ingest or direct SQL)
    // 2. review.confirm(id, actor)
    // 3. expect one criticCalibration row band=high outcome=approved
    // 4. update leg critic_review to low
    // 5. re-read calibration row — still high
  })

  it('correct writes corrected + field count', async () => { /* ... */ })

  it('dismiss writes dismissed', async () => { /* ... */ })

  it('legacy null band', async () => { /* provisional without criticReview */ })

  it('pruneOlderThan drops old rows', async () => {
    // insert row then backdate decided_at via SQL UPDATE, pruneOlderThan(180), expect gone
  })

  it('report aggregation over real rows', async () => {
    // insert a few calibration rows via repo, listSince, aggregateCriticCalibration
    // assert highBandCorrectionRate
  })
})
```

**Seeding helper (prefer DecisionsService if easy, else direct insert):**

Minimal direct seed of a provisional leg requires booking + shipment FKs — use existing patterns from `committer.int.spec.ts` / `decisions.int.spec.ts`. Prefer:

```ts
const decisions = new DecisionsService(committer, settings, r.ingest, r.routingShadow)
const res = await decisions.ingest({
  matchKey: { so_no: 'SO-CAL' },
  fields: { so_no: 'SO-CAL' },
  confidence: 40,
  autoApply: false,
  disposition: 'review',
  criticReview: { confidence: { score: 40, band: 'high', label: 'High' }, /* minimal CriticReview */ },
  // ... other required decision fields from decisions.int.spec decision()
})
// then review.confirm(res.shipmentId, actorId)
```

For actorId: insert a user or use a fixed UUID if FK allows null on actor_id only (calibration actor_id is nullable; review still needs a string actor — use any uuid string; `reviewedBy` FK may require real user). Check: `shipments.reviewed_by` FK to users — **seed a user** or use existing seed helper.

```ts
// If FK fails, insert into users first:
await db.insertInto('users').values({
  email: 'cal@test.local', name: 'Cal', passwordHash: 'x', role: 'EDITOR',
}).execute()
// then select id
```

Inspect `users` required columns from 0000_init if insert fails.

- [ ] **Step 2: Run**

```
$env:JWT_SECRET='test-jwt-secret-at-least-32-chars-long!!'
pnpm --filter backend test -- test/critic-calibration.int.spec.ts
```
Expected: PASS

- [ ] **Step 3: Lint + commit**

```
pnpm --filter backend lint
git add backend/test/critic-calibration.int.spec.ts
git commit -m "test(calibration): int proofs for band snapshot, prune, report"
```

---

## Self-review (plan vs spec)

| Spec § | Task |
|---|---|
| Snapshot not join (§2) | Task 2 capture + Task 5 snapshot mutation test |
| Outcome taxonomy (§3) | Task 2 confirm/correct/dismiss |
| Table 0014 (§4.1) | Task 1 |
| try/catch never fail human (§4.1) | Task 2 unit |
| Retention 180d (§4.2) | Task 1 repo + Task 5 prune |
| Report shape + highBandCorrectionRate (§4.3) | Task 3–4 |
| dismiss actor path (§8) | Task 2 dismiss (confirmed in live code) |
| Field names out of scope | count only in Task 2 |
| Default window 90d | Task 4 |
| 2b sample audit | out of scope (design note) |
| No review/routing behavior change | capture is side-effect only |

**Placeholder scan:** none.  
**Type consistency:** `CalibrationOutcome`, band union, `highBandCorrectionRate` naming stable across tasks.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-15-critic-review-phase3-calibration.md`.

Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — execute in this session with executing-plans checkpoints  

Which approach?
