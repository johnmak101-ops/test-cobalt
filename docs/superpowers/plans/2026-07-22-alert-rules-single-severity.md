# Alert Rules Single-Severity Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the paired warning/critical alert rules (A1+A2, A3+A4) into two single-severity rules (A1 draft, A3 final), each with one editable days-after-ETD threshold, a user-chosen severity, five-country overrides, and a true "Reset to defaults" — rendered mockup-style in Settings → Alert Rules.

**Architecture:** The alert engine is untouched. Changes are: a data migration retiring A2/A4, a shared factory-defaults module, a validated DTO + de-pinned save path + reset endpoint in the presentation layer, a non-clobbering seed, a rewritten `AlertRulesSettings` panel, and removal of two stale surfaces (standalone rules page, ungoverned rules GET).

**Tech Stack:** NestJS 11 + Kysely/MSSQL + class-validator (backend), React 19 + TanStack Query + Tailwind v4 (frontend), Vitest both sides.

## Global Constraints

- Spec: [docs/superpowers/specs/2026-07-22-alert-rules-single-severity-design.md](../specs/2026-07-22-alert-rules-single-severity-design.md). UI must match the approved mockup: id chip · name · severity Badge · toggle / description / "Threshold — days after ETD" stepper + "Severity" select (NO State field) / 5-country override panel / header buttons "Reset to defaults" + "Save changes" (no Discard).
- **Never `pnpm -C <pkg>`.** Run binaries from the package's own `node_modules\.bin` with cwd set to that package (project memory: divergent hoisting breaks otherwise).
- Working tree has unrelated dirt (README.md, docker files, `backend/_q.ts`, `backend/data/`, `backend/src/dev/`). Stage ONLY files named in commit steps — never `git add -A`.
- Every commit ends with trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Branch `feat/alert-rules-single-severity` off `main`; PR to `main` on `johnmak101-ops/cobalt-shiptrack` at the end.
- Severity vocabulary everywhere: `CRITICAL | WARNING | INFO`. Country codes everywhere: `CN BD KH VN IN`. Threshold bounds: default 0–30 days; country override 1–30 days. DB stores HOURS (days × 24); UI works in DAYS.
- Global `ValidationPipe({ transform: true, whitelist: true })` is active ([main.ts:26](../../backend/src/main.ts)). NEVER put `@Type(() => Object)` on a free-form `Record` DTO field — it wipes the keys (see [backend/src/review/dto.ts:6](../../backend/src/review/dto.ts)).
- The dev backend on :3000 runs COMPILED code (`node dist\main`) — backend changes need `nest build` + restart to be visible (frontend :5173 is vite with HMR).

## File map

| File | Action | Why |
|------|--------|-----|
| `backend/src/alerts/alert-rule-defaults.ts` | create | factory catalogue + country codes, shared by seed & reset |
| `backend/src/db/kysely-migrations/0018_retire_alert_rule_pairs.ts` | create | retire A2/A4, resolve their open alerts |
| `backend/src/presentation/alert-rules.dto.ts` (+ `.spec.ts`) | create | validated PUT body |
| `backend/src/presentation/presentation.service.ts:658-716` | modify | de-pin severity, server-side lock check, sanitize countries, add `resetAlertRules` |
| `backend/src/presentation/ui.controllers.ts:43-57` | modify | typed PUT body + POST reset |
| `backend/src/presentation/presentation.service.spec.ts` / `ui.controllers.spec.ts` | modify | new save/reset coverage |
| `backend/src/db/seed.ts:147-249` | modify | 2-row catalog, retire-lock others, structural-only sync |
| `backend/src/alerts/alerts.controller.ts:19-21` | modify | delete ungoverned `GET /alerts/rules` |
| `frontend/src/components/settings/AlertRulesSettings.tsx` (+ `.test.tsx`) | rewrite | single-rule cards per mockup |
| `frontend/src/App.tsx:13,134` · `frontend/src/pages/AlertRulesPage.tsx` · `frontend/src/pages/AlertsPage.tsx:~193-204` | modify/delete | remove stale standalone editor |

---

### Task 1: Branch, docs, shared factory defaults, retirement migration

**Files:**
- Create: `backend/src/alerts/alert-rule-defaults.ts`
- Create: `backend/src/db/kysely-migrations/0018_retire_alert_rule_pairs.ts`
- Commit also: `docs/superpowers/specs/2026-07-22-alert-rules-single-severity-design.md`, `docs/superpowers/plans/2026-07-22-alert-rules-single-severity.md` (already written)

**Interfaces:**
- Produces: `ALERT_RULE_FACTORY_DEFAULTS: AlertRuleFactoryRow[]` (ids `A1`,`A3`; fields id/name/description/state/triggerType/triggerReference/watchFor/thresholdHours/countryThresholds/severity/computeTz/enabled/locked) and `ALERT_COUNTRY_CODES = ['CN','BD','KH','VN','IN']` — consumed by Tasks 3 and 4.

- [ ] **Step 1: Create the branch**

```powershell
Set-Location D:\cobalt_track_system
git checkout -b feat/alert-rules-single-severity main
```

- [ ] **Step 2: Write `backend/src/alerts/alert-rule-defaults.ts`**

```ts
/**
 * Factory catalogue for the two single-severity customer rules (Settings → Alert Rules).
 * Shared by seed.ts (fresh installs + structural sync) and POST /alert-rules/reset so
 * "Reset to defaults" and a fresh install can never drift apart.
 */
export interface AlertRuleFactoryRow {
  id: string
  name: string
  description: string
  state: null
  triggerType: 'days_after'
  triggerReference: 'etd'
  watchFor: 'draft_bl' | 'final_bl'
  thresholdHours: number
  countryThresholds: null
  severity: 'WARNING'
  computeTz: 'server'
  enabled: true
  locked: false
}

export const ALERT_RULE_FACTORY_DEFAULTS: AlertRuleFactoryRow[] = [
  {
    id: 'A1',
    name: 'No Draft BOL received',
    description: 'Fires after ETD when Draft B/L is still missing',
    state: null,
    triggerType: 'days_after',
    triggerReference: 'etd',
    watchFor: 'draft_bl',
    thresholdHours: 24,
    countryThresholds: null,
    severity: 'WARNING',
    computeTz: 'server',
    enabled: true,
    locked: false,
  },
  {
    id: 'A3',
    name: 'No Final BOL received',
    description: 'Fires after ETD when Final B/L is still missing',
    state: null,
    triggerType: 'days_after',
    triggerReference: 'etd',
    watchFor: 'final_bl',
    thresholdHours: 72,
    countryThresholds: null,
    severity: 'WARNING',
    computeTz: 'server',
    enabled: true,
    locked: false,
  },
]

export const ALERT_COUNTRY_CODES = ['CN', 'BD', 'KH', 'VN', 'IN'] as const

/** The critical tiers of the old warn/critical pairs — retired (disabled + locked), never deleted. */
export const RETIRED_ALERT_RULE_IDS = ['A2', 'A4'] as const
```

- [ ] **Step 3: Write the migration `backend/src/db/kysely-migrations/0018_retire_alert_rule_pairs.ts`**

Mirror the raw-SQL style of `0017_alert_rule_refs_draft_eta_delivered.ts`. The dedup-key rewrite copies `AlertRepository.resolveAllActiveForRule` (frees the UNIQUE `dedup_key` so a future re-fire can insert). SNOOZED is included because retirement is permanent — a snoozed alert of a dead rule must not resurface.

```ts
/**
 * Collapse the warn/critical pairs to single-severity rules: A1 (draft) and A3 (final) carry the
 * one threshold + user-chosen severity; the critical tiers A2/A4 are retired — disabled + locked,
 * their open alerts resolved. Rows are kept (alerts.rule_id FK + history), never deleted.
 */
import { type Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `UPDATE alerts SET status = 'RESOLVED', resolved_at = SYSUTCDATETIME(), dedup_key = CONCAT(COALESCE(dedup_key, id), ':resolved:', id) WHERE rule_id IN ('A2','A4') AND status IN ('ACTIVE','SNOOZED')`,
    )
    .execute(db)
  await sql
    .raw(`UPDATE alert_rules SET enabled = 0, locked = 1, updated_at = SYSUTCDATETIME() WHERE id IN ('A2','A4')`)
    .execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(`UPDATE alert_rules SET enabled = 1, locked = 0, updated_at = SYSUTCDATETIME() WHERE id IN ('A2','A4')`)
    .execute(db)
}
```

- [ ] **Step 4: Run the migration against the dev DB**

```powershell
Set-Location D:\cobalt_track_system\backend
.\node_modules\.bin\ts-node -P tsconfig.json src\db\migrate-cli.ts
```

Expected: output lists `0018_retire_alert_rule_pairs` as executed, no errors. (If the CLI needs an explicit direction argument, check `src/db/migrate-cli.ts` usage header first.)

- [ ] **Step 5: Commit**

```powershell
Set-Location D:\cobalt_track_system
git add backend/src/alerts/alert-rule-defaults.ts backend/src/db/kysely-migrations/0018_retire_alert_rule_pairs.ts docs/superpowers/specs/2026-07-22-alert-rules-single-severity-design.md docs/superpowers/plans/2026-07-22-alert-rules-single-severity.md
git commit -m "feat(alerts): retire A2/A4 critical tiers + shared factory defaults

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Validated DTO for PUT /alert-rules

**Files:**
- Create: `backend/src/presentation/alert-rules.dto.ts`
- Test: `backend/src/presentation/alert-rules.dto.spec.ts`

**Interfaces:**
- Produces: `SaveAlertRulesDto { rules: AlertRuleUpdateDto[] }`, `AlertRuleUpdateDto { id: string; thresholdDays?: number; severity?: string; enabled?: boolean; countryThresholds?: Record<string, number> | null }`, `ALERT_SEVERITIES = ['CRITICAL','WARNING','INFO']` — consumed by Task 3.

- [ ] **Step 1: Write the failing spec `backend/src/presentation/alert-rules.dto.spec.ts`** (modeled on `backend/src/review/dto.spec.ts`)

```ts
import { describe, it, expect } from 'vitest'
import { ValidationPipe, BadRequestException } from '@nestjs/common'
import { SaveAlertRulesDto } from './alert-rules.dto'

const pipe = new ValidationPipe({ transform: true, whitelist: true })
const meta = { type: 'body' as const, metatype: SaveAlertRulesDto }

describe('SaveAlertRulesDto + global ValidationPipe(transform, whitelist)', () => {
  it('keeps countryThresholds keys and strips unknown rule fields', async () => {
    const out = (await pipe.transform(
      {
        rules: [
          {
            id: 'A1',
            thresholdDays: 2,
            severity: 'INFO',
            enabled: true,
            countryThresholds: { CN: 3, VN: 4 },
            name: 'client junk',
            locked: false,
            state: 'BOOKED',
          },
        ],
      },
      meta,
    )) as SaveAlertRulesDto
    expect(out.rules[0].countryThresholds).toEqual({ CN: 3, VN: 4 })
    expect(out.rules[0]).not.toHaveProperty('name')
    expect(out.rules[0]).not.toHaveProperty('locked')
    expect(out.rules[0]).not.toHaveProperty('state')
  })

  it('rejects an unknown severity', async () => {
    await expect(
      pipe.transform({ rules: [{ id: 'A1', severity: 'BANANA' }] }, meta),
    ).rejects.toThrow(BadRequestException)
  })

  it('rejects thresholdDays outside 0-30', async () => {
    await expect(pipe.transform({ rules: [{ id: 'A1', thresholdDays: 31 }] }, meta)).rejects.toThrow(
      BadRequestException,
    )
    await expect(pipe.transform({ rules: [{ id: 'A1', thresholdDays: -1 }] }, meta)).rejects.toThrow(
      BadRequestException,
    )
  })

  it('accepts a minimal payload (only id) and an explicit null countryThresholds', async () => {
    const out = (await pipe.transform(
      { rules: [{ id: 'A3', countryThresholds: null }] },
      meta,
    )) as SaveAlertRulesDto
    expect(out.rules[0].id).toBe('A3')
    expect(out.rules[0].countryThresholds).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```powershell
Set-Location D:\cobalt_track_system\backend
.\node_modules\.bin\vitest run src/presentation/alert-rules.dto.spec.ts
```

Expected: FAIL — `Cannot find module './alert-rules.dto'`.

- [ ] **Step 3: Write `backend/src/presentation/alert-rules.dto.ts`**

```ts
import { Type } from 'class-transformer'
import {
  Allow,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator'

export const ALERT_SEVERITIES = ['CRITICAL', 'WARNING', 'INFO'] as const

/**
 * One editable rule in PUT /alert-rules. Identity/anchor fields (name, state, trigger*) are
 * server-owned — the whitelist pipe strips them if a client echoes them back. countryThresholds
 * stays a free-form map here (no @Type(() => Object) — see review/dto.ts for why) and is
 * sanitized in PresentationService.saveAlertRules (codes CN/BD/KH/VN/IN, days 1-30).
 */
export class AlertRuleUpdateDto {
  @IsString() id!: string
  @IsOptional() @IsInt() @Min(0) @Max(30) thresholdDays?: number
  @IsOptional() @IsIn(ALERT_SEVERITIES as unknown as string[]) severity?: string
  @IsOptional() @IsBoolean() enabled?: boolean
  @Allow() countryThresholds?: Record<string, number> | null
}

export class SaveAlertRulesDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => AlertRuleUpdateDto) rules!: AlertRuleUpdateDto[]
}
```

- [ ] **Step 4: Run to verify it passes**

```powershell
.\node_modules\.bin\vitest run src/presentation/alert-rules.dto.spec.ts
```

Expected: 4 PASS.

- [ ] **Step 5: Commit**

```powershell
Set-Location D:\cobalt_track_system
git add backend/src/presentation/alert-rules.dto.ts backend/src/presentation/alert-rules.dto.spec.ts
git commit -m "feat(alerts): class-validator DTO for alert-rule saves

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: De-pinned save path + reset endpoint

**Files:**
- Modify: `backend/src/presentation/presentation.service.ts:658-716` (`saveAlertRules`), add `resetAlertRules` + `sanitizeCountryThresholds` helper, add imports
- Modify: `backend/src/presentation/ui.controllers.ts:43-57`
- Test: `backend/src/presentation/presentation.service.spec.ts` (extend `describe('PresentationService.alerts + alertRules')` at :361), `backend/src/presentation/ui.controllers.spec.ts` (extend `describe('UiAlertRulesController')` at :45)

**Interfaces:**
- Consumes: `SaveAlertRulesDto`/`AlertRuleUpdateDto` (Task 2), `ALERT_RULE_FACTORY_DEFAULTS`/`ALERT_COUNTRY_CODES` (Task 1), existing `AlertRepository.allRules/updateRule/resolveAllActiveForRule/syncActivePresentation`.
- Produces: `PresentationService.saveAlertRules(input: SaveAlertRulesDto)`, `PresentationService.resetAlertRules()` (both return `{ rules, eval }`), `POST /alert-rules/reset` — consumed by Task 5's frontend.

- [ ] **Step 1: Write the failing service tests.** In `presentation.service.spec.ts`, inside `describe('PresentationService.alerts + alertRules')` (after the `it('maps alert rules with hours->days')` case at :375), add — reusing the file's existing fixture style; build a LOCAL service instance whose fake `alertRepo` captures calls (copy the constructor-arg pattern from the `PresentationService.dashboard` describe at :412-449, replacing only `alertRepo`):

```ts
  function buildSaveHarness(serverRules: Array<Record<string, unknown>>) {
    const calls = {
      updateRule: [] as Array<{ id: string; patch: Record<string, unknown> }>,
      resolved: [] as string[],
      synced: [] as Array<{ id: string; patch: { severity: string; message: string } }>,
    }
    const alertRepo = {
      list: async () => [],
      allRules: async () => serverRules,
      updateRule: async (id: string, patch: Record<string, unknown>) => {
        calls.updateRule.push({ id, patch })
        return null
      },
      resolveAllActiveForRule: async (id: string) => {
        calls.resolved.push(id)
        return 0
      },
      syncActivePresentation: async (id: string, patch: { severity: string; message: string }) => {
        calls.synced.push({ id, patch })
      },
    }
    const svc = new PresentationService(
      shipmentRepo as any, bookingRepo as any, mastersRepo as any, alertRepo as any,
      { listForEntity: async () => [] } as any,
      { unreadCount: async () => 0, ingestionStatus: async () => ({ count: 0, lastAt: null }), ingestState: async () => null, emailsForShipment: async () => [] } as any,
      { forMessages: async () => [], allWithMessage: async () => [] } as any,
      { lookupByMatchKey: async () => ({ query: {}, candidates: [] }) } as any,
      { evaluate: async () => ({ evaluated: 0, fired: 0, resolved: 0 }) } as any,
    )
    return { svc, calls }
  }

  const serverRule = (over: Record<string, unknown> = {}) => ({
    id: 'A1', name: 'No Draft BOL received', description: 'Fires after ETD when Draft B/L is still missing',
    state: null, triggerType: 'days_after', triggerReference: 'etd', thresholdHours: 24,
    countryThresholds: null, severity: 'WARNING', enabled: true, locked: false, ...over,
  })

  it('saveAlertRules honors the client severity (pinning removed) and syncs active alerts', async () => {
    const { svc, calls } = buildSaveHarness([serverRule()])
    await svc.saveAlertRules({ rules: [{ id: 'A1', thresholdDays: 2, severity: 'INFO', enabled: true, countryThresholds: null }] })
    expect(calls.updateRule).toHaveLength(1)
    expect(calls.updateRule[0].patch.severity).toBe('INFO')
    expect(calls.updateRule[0].patch.thresholdHours).toBe(48)
    expect(calls.synced[0]).toEqual({
      id: 'A1',
      patch: { severity: 'INFO', message: 'Fires after ETD when Draft B/L is still missing' },
    })
  })

  it('saveAlertRules skips rules locked ON THE SERVER even if the client claims otherwise', async () => {
    const { svc, calls } = buildSaveHarness([serverRule({ id: 'A2', locked: true })])
    await svc.saveAlertRules({ rules: [{ id: 'A2', severity: 'INFO', enabled: true }] })
    expect(calls.updateRule).toHaveLength(0)
  })

  it('saveAlertRules sanitizes country overrides (codes CN/BD/KH/VN/IN, 1-30 days, stored in hours)', async () => {
    const { svc, calls } = buildSaveHarness([serverRule()])
    await svc.saveAlertRules({
      rules: [{ id: 'A1', countryThresholds: { CN: 3, BD: 7, XX: 5, VN: 0, IN: 31 } as Record<string, number> }],
    })
    expect(JSON.parse(String(calls.updateRule[0].patch.countryThresholds))).toEqual({ CN: 72, BD: 168 })
  })

  it('saveAlertRules leaves stored overrides alone when countryThresholds is absent', async () => {
    const { svc, calls } = buildSaveHarness([serverRule()])
    await svc.saveAlertRules({ rules: [{ id: 'A1', thresholdDays: 1 }] })
    expect(calls.updateRule[0].patch).not.toHaveProperty('countryThresholds')
  })

  it('saveAlertRules resolves all active alerts when a rule is disabled', async () => {
    const { svc, calls } = buildSaveHarness([serverRule()])
    await svc.saveAlertRules({ rules: [{ id: 'A1', enabled: false }] })
    expect(calls.resolved).toEqual(['A1'])
  })

  it('resetAlertRules restores factory defaults for A1 and A3', async () => {
    const { svc, calls } = buildSaveHarness([serverRule(), serverRule({ id: 'A3', watchFor: 'final_bl', thresholdHours: 72, description: 'Fires after ETD when Final B/L is still missing' })])
    await svc.resetAlertRules()
    const byId = Object.fromEntries(calls.updateRule.map((c) => [c.id, c.patch]))
    expect(byId.A1).toMatchObject({ thresholdHours: 24, severity: 'WARNING', enabled: true, countryThresholds: null })
    expect(byId.A3).toMatchObject({ thresholdHours: 72, severity: 'WARNING', enabled: true, countryThresholds: null })
  })
```

- [ ] **Step 2: Run to verify the new cases fail**

```powershell
Set-Location D:\cobalt_track_system\backend
.\node_modules\.bin\vitest run src/presentation/presentation.service.spec.ts
```

Expected: the 6 new cases FAIL (severity pinned to WARNING, `resetAlertRules` not a function, countryThresholds always set); pre-existing cases still pass.

- [ ] **Step 3: Rework `presentation.service.ts`.** Add imports at the top of the file:

```ts
import { SaveAlertRulesDto } from './alert-rules.dto'
import { ALERT_COUNTRY_CODES, ALERT_RULE_FACTORY_DEFAULTS } from '../alerts/alert-rule-defaults'
```

Add a module-level helper (outside the class, near the other helpers):

```ts
const ALERT_COUNTRY_CODE_SET = new Set<string>(ALERT_COUNTRY_CODES)

/** UI days map -> stored hours map. Drops unknown codes and out-of-range values (1-30 days). */
function sanitizeCountryThresholds(
  ct: Record<string, number> | null | undefined,
): Record<string, number> | null {
  if (!ct || typeof ct !== 'object') return null
  const out: Record<string, number> = {}
  for (const [code, days] of Object.entries(ct)) {
    const d = Math.round(Number(days))
    if (ALERT_COUNTRY_CODE_SET.has(code) && Number.isFinite(d) && d >= 1 && d <= 30) out[code] = d * 24
  }
  return Object.keys(out).length > 0 ? out : null
}
```

Replace the body of `saveAlertRules` (lines 658-716; keep the surrounding doc comment, updating its pinning sentence):

```ts
  /** Persist edited alert rules. The UI works in DAYS; we store HOURS. Locked rules stay immutable
   *  (checked against the SERVER row — the client copy is never trusted). Severity is user-chosen
   *  per rule (single-severity model; the old A1-A4 warn/critical pinning is gone). After save,
   *  re-evaluate every active confirmed leg immediately so new thresholds apply now
   *  (scheduler still re-runs every ~15 minutes as a safety net). */
  async saveAlertRules(input: SaveAlertRulesDto) {
    const existing = new Map((await this.alertRepo.allRules()).map((r: { id: string }) => [r.id, r]))
    for (const r of input?.rules ?? []) {
      const current = existing.get(r.id) as
        | { id: string; name: string; description: string | null; locked: boolean }
        | undefined
      if (!current || current.locked) continue
      const patch: Record<string, unknown> = {}
      if (typeof r.thresholdDays === 'number') patch.thresholdHours = Math.round(r.thresholdDays * 24)
      if (typeof r.severity === 'string') patch.severity = r.severity
      if (typeof r.enabled === 'boolean') patch.enabled = r.enabled
      if (r.countryThresholds !== undefined) {
        // country_thresholds is nvarchar(max) JSON — must stringify for tedious/MSSQL
        // ("Validation failed for parameter … Invalid string" if an object is bound).
        const hoursMap = sanitizeCountryThresholds(r.countryThresholds)
        patch.countryThresholds = hoursMap != null ? JSON.stringify(hoursMap) : null
      }
      await this.alertRepo.updateRule(r.id, patch)

      // Push severity/message onto existing ACTIVE alert rows NOW (do not wait for re-fire).
      // Alerts store a copy of severity at first fire; without this, Settings→Info leaves cards CRITICAL.
      if (r.enabled === false) {
        await this.alertRepo.resolveAllActiveForRule(r.id)
      } else if (typeof patch.severity === 'string') {
        await this.alertRepo.syncActivePresentation(r.id, {
          severity: String(patch.severity),
          message: current.description || current.name || r.id,
        })
      }
    }
    let evalStats: { evaluated: number; fired: number; resolved: number } | null = null
    try {
      evalStats = await this.alertEvaluator.evaluate()
      this.logger.log(
        `alert rules saved — immediate eval evaluated=${evalStats.evaluated} fired=${evalStats.fired} resolved=${evalStats.resolved}`,
      )
    } catch (err) {
      // Thresholds + presentation already persisted; a failed re-eval must not roll back the save.
      this.logger.warn(
        `alert rules saved but immediate eval failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
    const { rules } = await this.alertRules()
    return { rules, eval: evalStats }
  }

  /** True factory reset for the customer rules — thresholds, severity, country overrides, enabled.
   *  Reuses the save path so active-alert presentation sync + immediate re-eval apply here too. */
  async resetAlertRules() {
    return this.saveAlertRules({
      rules: ALERT_RULE_FACTORY_DEFAULTS.map((d) => ({
        id: d.id,
        thresholdDays: Math.round(d.thresholdHours / 24),
        severity: d.severity,
        enabled: d.enabled,
        countryThresholds: null,
      })),
    })
  }
```

- [ ] **Step 4: Update `ui.controllers.ts`.** Add `Post` to the `@nestjs/common` import if missing, import the DTO, and replace the controller (lines 43-57):

```ts
import { SaveAlertRulesDto } from './alert-rules.dto'

@Controller('alert-rules')
export class UiAlertRulesController {
  constructor(private readonly ui: PresentationService) {}

  @PageRead('alert_rules')
  @Get() get() {
    return this.ui.alertRules()
  }
  // Governed by the configurable Access Control matrix (page 'alert_rules'): reading needs View,
  // saving needs Edit; superadmin always passes. Paired with the frontend PageAccessRoute + canEdit.
  @PageWrite('alert_rules')
  @Put() save(@Body() body: SaveAlertRulesDto) {
    return this.ui.saveAlertRules(body)
  }
  @PageWrite('alert_rules')
  @Post('reset') reset() {
    return this.ui.resetAlertRules()
  }
}
```

- [ ] **Step 5: Extend `ui.controllers.spec.ts`.** Add `resetAlertRules: vi.fn().mockResolvedValue({ rules: [], eval: null })` and `saveAlertRules: vi.fn().mockResolvedValue({ rules: [], eval: null })` to `fakeSvc()` (:12-20), then inside `describe('UiAlertRulesController')` add:

```ts
  it('delegates POST /alert-rules/reset to the service', async () => {
    const svc = fakeSvc()
    await new UiAlertRulesController(svc as any).reset()
    expect(svc.resetAlertRules).toHaveBeenCalledOnce()
  })

  it('governs POST /alert-rules/reset with @PageWrite(alert_rules)', () => {
    expect(new Reflector().get<string>(PAGE_WRITE_KEY, UiAlertRulesController.prototype.reset)).toBe('alert_rules')
  })
```

- [ ] **Step 6: Run both spec files**

```powershell
.\node_modules\.bin\vitest run src/presentation/presentation.service.spec.ts src/presentation/ui.controllers.spec.ts
```

Expected: all PASS (including the 6 new service cases + 2 new controller cases).

- [ ] **Step 7: Commit**

```powershell
Set-Location D:\cobalt_track_system
git add backend/src/presentation/presentation.service.ts backend/src/presentation/ui.controllers.ts backend/src/presentation/presentation.service.spec.ts backend/src/presentation/ui.controllers.spec.ts
git commit -m "feat(alerts): single-severity save path + POST /alert-rules/reset

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Seed rework (2-row catalog, non-clobbering sync)

**Files:**
- Modify: `backend/src/db/seed.ts:147-249`

**Interfaces:**
- Consumes: `ALERT_RULE_FACTORY_DEFAULTS` (Task 1). Import at the top of seed.ts: `import { ALERT_RULE_FACTORY_DEFAULTS } from '../alerts/alert-rule-defaults'`.

- [ ] **Step 1: Replace the alert-rules block (lines 147-249) with:**

```ts
  // ---- Alert rules (ALWAYS) — customer: 2 single-severity rules (A1 draft, A3 final) ----
  // One threshold + user-chosen severity per rule; A2/A4 (old critical tiers) and everything
  // else (A5/A6/A7/legacy) are retired: disabled + locked so the UI hides them and PUT skips them.
  // Tunables (thresholdHours/severity/enabled/countryThresholds) are USER-OWNED after install —
  // the structural sync below must never clobber them on redeploy.
  const KEEP_RULE_IDS = new Set(ALERT_RULE_FACTORY_DEFAULTS.map((r) => r.id))
  await db
    .updateTable('alertRules')
    .set({ enabled: false, locked: true, updatedAt: new Date() })
    .where('id', 'not in', [...KEEP_RULE_IDS])
    .execute()
  const haveRules = new Set((await db.selectFrom('alertRules').select('id').execute()).map((r) => r.id))
  const newRules = ALERT_RULE_FACTORY_DEFAULTS.filter((r) => !haveRules.has(r.id)).map(
    (r) => ({ ...r }) as Insertable<DB['alertRules']>,
  )
  if (newRules.length) {
    try {
      await db.insertInto('alertRules').values(newRules).execute()
    } catch (e) {
      if (!isUniqueViolation(e)) throw e
    }
  }
  // Structural identity sync only (names/descriptions/anchors) — never thresholds/severity/enabled/countries.
  for (const row of ALERT_RULE_FACTORY_DEFAULTS) {
    await db
      .updateTable('alertRules')
      .set({
        name: row.name,
        description: row.description,
        state: row.state,
        triggerType: row.triggerType,
        triggerReference: row.triggerReference,
        watchFor: row.watchFor,
        computeTz: row.computeTz,
        locked: false,
      })
      .where('id', '=', row.id)
      .execute()
  }
```

- [ ] **Step 2: Run the seed against the dev DB, twice (idempotency check)**

```powershell
Set-Location D:\cobalt_track_system\backend
.\node_modules\.bin\ts-node -P tsconfig.json src\db\seed.ts
.\node_modules\.bin\ts-node -P tsconfig.json src\db\seed.ts
```

Expected: both runs complete without error.

- [ ] **Step 3: Verify the DB state through the app layer** — run the full backend suite as a regression net:

```powershell
.\node_modules\.bin\vitest run
```

Expected: full suite PASS (project green baseline; no seed-dependent tests break).

- [ ] **Step 4: Commit**

```powershell
Set-Location D:\cobalt_track_system
git add backend/src/db/seed.ts
git commit -m "feat(alerts): seed the 2-rule single-severity catalog, stop clobbering tuned values

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Frontend — rewrite AlertRulesSettings per the approved mockup

**Files:**
- Rewrite: `frontend/src/components/settings/AlertRulesSettings.tsx`
- Rewrite: `frontend/src/components/settings/AlertRulesSettings.test.tsx`

**Interfaces:**
- Consumes: `GET /alert-rules` (unchanged shape), `PUT /alert-rules` with trimmed rule objects `{ id, thresholdDays, severity, enabled, countryThresholds }`, `POST /alert-rules/reset` (Task 3); existing `DaysStepper` (`value: number|null, onChange, min, max, optional, emptyLabel, disabled, size`), `Badge variant="severity"`, `Card`, `toast`, `usePageAccess`.

- [ ] **Step 1: Rewrite the test file** `AlertRulesSettings.test.tsx`. Keep the existing harness (mock modules, `renderWithClient`) but replace `baseRules` and all cases:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AlertRulesSettings } from './AlertRulesSettings'
import { api } from '../../lib/api'

const rule = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'A1',
  name: 'No Draft BOL received',
  description: 'Fires after ETD when Draft B/L is still missing',
  state: null,
  triggerType: 'days_after',
  triggerReference: 'etd',
  thresholdDays: 1,
  countryThresholds: null as Record<string, number> | null,
  severity: 'WARNING',
  enabled: true,
  locked: false,
  ...over,
})

const baseRules = [
  rule(),
  rule({ id: 'A3', name: 'No Final BOL received', description: 'Fires after ETD when Final B/L is still missing', thresholdDays: 3 }),
  rule({ id: 'A2', name: 'No Draft BOL received', severity: 'CRITICAL', enabled: false, locked: true }),
  rule({ id: 'A7', name: 'CRD revision not reflected', enabled: false, locked: true }),
]

vi.mock('../../lib/api', () => ({
  api: { get: vi.fn(), put: vi.fn(), post: vi.fn() },
}))

vi.mock('../../hooks/use-page-access', () => ({
  usePageAccess: () => ({ canEdit: () => true, canView: () => true }),
}))

vi.mock('../ui/Toast', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
  vi.mocked(api.get).mockResolvedValue({ rules: baseRules })
  vi.mocked(api.put).mockResolvedValue({ rules: baseRules, eval: null })
  vi.mocked(api.post).mockResolvedValue({ rules: baseRules, eval: null })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

describe('AlertRulesSettings — single-severity cards', () => {
  it('renders one card per non-locked rule and hides retired/locked rows', async () => {
    renderWithClient(<AlertRulesSettings />)
    expect(await screen.findByText('No Draft BOL received')).toBeInTheDocument()
    expect(screen.getByText('No Final BOL received')).toBeInTheDocument()
    expect(screen.queryByText('CRD revision not reflected')).toBeNull()
    // retired A2 is locked -> only ONE draft-BOL card
    expect(screen.getAllByText('No Draft BOL received')).toHaveLength(1)
    // no State field in the new layout
    expect(screen.queryByText(/^state$/i)).toBeNull()
  })

  it('saves a trimmed payload with the chosen severity', async () => {
    const user = userEvent.setup()
    renderWithClient(<AlertRulesSettings />)
    await screen.findByText('No Draft BOL received')
    await user.selectOptions(screen.getByLabelText('No Draft BOL received severity'), 'CRITICAL')
    await user.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() => expect(api.put).toHaveBeenCalledOnce())
    const body = vi.mocked(api.put).mock.calls[0][1] as { rules: Array<Record<string, unknown>> }
    const a1 = body.rules.find((r) => r.id === 'A1')!
    expect(a1.severity).toBe('CRITICAL')
    expect(Object.keys(a1).sort()).toEqual(['countryThresholds', 'enabled', 'id', 'severity', 'thresholdDays'])
    // locked rows are not sent at all
    expect(body.rules.map((r) => r.id).sort()).toEqual(['A1', 'A3'])
  })

  it('sets a per-rule country override and sends it in days', async () => {
    const user = userEvent.setup()
    renderWithClient(<AlertRulesSettings />)
    await screen.findByText('No Final BOL received')
    const finalCard = screen.getByTestId('alert-rule-card-A3')
    const vn = within(finalCard).getByLabelText('Vietnam days after ETD')
    await user.click(within(vn.parentElement as HTMLElement).getByRole('button', { name: /increase/i }))
    await user.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() => expect(api.put).toHaveBeenCalledOnce())
    const body = vi.mocked(api.put).mock.calls[0][1] as { rules: Array<Record<string, unknown>> }
    expect((body.rules.find((r) => r.id === 'A3') as { countryThresholds: Record<string, number> }).countryThresholds).toEqual({ VN: 1 })
    expect((body.rules.find((r) => r.id === 'A1') as { countryThresholds: null }).countryThresholds).toBeNull()
  })

  it('Reset to defaults asks for confirmation then POSTs the reset endpoint', async () => {
    const user = userEvent.setup()
    renderWithClient(<AlertRulesSettings />)
    await screen.findByText('No Draft BOL received')
    await user.click(screen.getByRole('button', { name: /reset to defaults/i }))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/alert-rules/reset', {}))
  })

  it('does not reset when the confirm dialog is declined', async () => {
    vi.mocked(window.confirm).mockReturnValue(false)
    const user = userEvent.setup()
    renderWithClient(<AlertRulesSettings />)
    await screen.findByText('No Draft BOL received')
    await user.click(screen.getByRole('button', { name: /reset to defaults/i }))
    expect(api.post).not.toHaveBeenCalled()
  })
})
```

Note for the DaysStepper interaction in test 3: `DaysStepper` renders −/＋ buttons; check the component's actual aria-labels (`frontend/src/components/settings/DaysStepper.tsx`) and adjust the `getByRole('button', { name: /increase/i })` query to its real accessible name (e.g. `/\+|increase|plus/i`) — the assertion contract that matters is the saved payload `{ VN: 1 }` (＋ from null starts at min = 1).

- [ ] **Step 2: Run to verify the new tests fail**

```powershell
Set-Location D:\cobalt_track_system\frontend
.\node_modules\.bin\vitest run src/components/settings/AlertRulesSettings.test.tsx
```

Expected: FAIL (current component renders pair cards, has no severity select / reset button / `alert-rule-card-A3` testid).

- [ ] **Step 3: Rewrite `AlertRulesSettings.tsx`:**

```tsx
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useId, useMemo, useState } from 'react'
import { api } from '../../lib/api'
import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { cn } from '../../lib/utils'
import { usePageAccess } from '../../hooks/use-page-access'
import { toast } from '../ui/Toast'
import { DaysStepper } from './DaysStepper'

interface AlertRule {
  id: string
  name: string
  description: string | null
  state: string | null
  triggerType: string
  triggerReference: string
  thresholdDays: number
  countryThresholds: Record<string, number> | null
  severity: string
  enabled: boolean
  locked: boolean
}

const SEVERITY_OPTIONS = [
  { value: 'CRITICAL', label: 'Critical' },
  { value: 'WARNING', label: 'Warning' },
  { value: 'INFO', label: 'Info' },
]

const ALERT_COUNTRY_LIST = [
  { code: 'CN', label: 'China' },
  { code: 'BD', label: 'Bangladesh' },
  { code: 'KH', label: 'Cambodia' },
  { code: 'VN', label: 'Vietnam' },
  { code: 'IN', label: 'India' },
]

function normalizeRules(rules: AlertRule[]): AlertRule[] {
  return rules.map((r) => ({
    ...r,
    countryThresholds: r.countryThresholds
      ? typeof r.countryThresholds === 'string'
        ? (JSON.parse(r.countryThresholds as unknown as string) as Record<string, number>)
        : r.countryThresholds
      : null,
  }))
}

function apiError(e: unknown, fallback: string) {
  const msg = e instanceof Error ? e.message.replace(/^API error \d+:\s*/i, '') : fallback
  return msg || fallback
}

export function AlertRulesSettings() {
  const id = useId()
  const { data, isLoading } = useQuery<{ rules: AlertRule[] }>({
    queryKey: ['alertRules'],
    queryFn: () => api.get('/alert-rules'),
  })
  const qc = useQueryClient()
  const { canEdit: canEditPage } = usePageAccess()
  const canEdit = canEditPage('alert_rules')
  const serverRules = useMemo(() => (data?.rules ? normalizeRules(data.rules) : null), [data])
  const [draft, setDraft] = useState<AlertRule[] | null>(null)
  const [serverSnap, setServerSnap] = useState(serverRules)
  if (serverRules !== serverSnap) {
    setServerSnap(serverRules)
    setDraft(null)
  }
  const allRules = draft ?? serverRules ?? []
  // Locked rows are invisible here: A7 (built-in) and the retired A2/A4 critical tiers.
  const visibleRules = allRules.filter((r) => !r.locked)
  const dirty = draft !== null

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['alertRules'] })
    qc.invalidateQueries({ queryKey: ['alerts'] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
  }

  const saveRules = useMutation({
    // Server owns identity fields; send only what is editable (whitelist pipe strips the rest anyway).
    mutationFn: (rules: AlertRule[]) =>
      api.put('/alert-rules', {
        rules: rules
          .filter((r) => !r.locked)
          .map((r) => ({
            id: r.id,
            thresholdDays: r.thresholdDays,
            severity: r.severity,
            enabled: r.enabled,
            countryThresholds: r.countryThresholds,
          })),
      }),
    onSuccess: () => {
      setDraft(null)
      toast.success('Saved')
      invalidate()
    },
    onError: (e) => toast.error(apiError(e, 'Save failed')),
  })

  const resetRules = useMutation({
    mutationFn: () => api.post('/alert-rules/reset', {}),
    onSuccess: () => {
      setDraft(null)
      toast.success('Defaults restored')
      invalidate()
    },
    onError: (e) => toast.error(apiError(e, 'Reset failed')),
  })

  const updateRule = (ruleId: string, patch: Partial<AlertRule>) => {
    setDraft((prev) => (prev ?? serverRules ?? []).map((r) => (r.id === ruleId ? { ...r, ...patch } : r)))
  }

  /** Per-rule absolute days-after-ETD for that origin; null/0 clears the override. */
  const updateCountryDays = (ruleId: string, code: string, days: number | null) => {
    setDraft((prev) =>
      (prev ?? serverRules ?? []).map((r) => {
        if (r.id !== ruleId) return r
        const ct = { ...(r.countryThresholds ?? {}) }
        if (days == null || days <= 0) delete ct[code]
        else ct[code] = days
        return { ...r, countryThresholds: Object.keys(ct).length > 0 ? ct : null }
      }),
    )
  }

  if (isLoading) {
    return <div className="text-sm text-text-muted">Loading alert rules…</div>
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-text-primary">Alert rules</h2>
          <p className="mt-0.5 text-sm text-text-secondary">
            Both rules fire a set number of days after ETD — pick the threshold and severity.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (!window.confirm('Restore factory defaults for all alert rules? This overwrites thresholds, severities, country overrides, and enabled states.')) return
              resetRules.mutate()
            }}
            disabled={!canEdit || resetRules.isPending || saveRules.isPending}
            className="rounded-lg px-3 py-2 text-sm text-text-secondary hover:bg-surface-700 hover:text-text-primary disabled:opacity-40"
          >
            {resetRules.isPending ? 'Resetting…' : 'Reset to defaults'}
          </button>
          <button
            type="button"
            onClick={() => saveRules.mutate(allRules)}
            disabled={!canEdit || !dirty || saveRules.isPending || resetRules.isPending}
            className="rounded-lg bg-cobalt-primary px-4 py-2 text-sm font-medium text-white hover:bg-cobalt-primary-light disabled:opacity-50"
          >
            {saveRules.isPending ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>

      {!canEdit && <p className="text-xs text-text-muted">You have view-only access to Alert Rules.</p>}

      {visibleRules.length === 0 && (
        <p className="rounded-lg border border-status-warning/40 bg-status-warning/10 px-4 py-3 text-sm text-status-warning">
          No editable alert rules found. Run the backend seed, then reload.
        </p>
      )}

      <div className="space-y-4">
        {visibleRules.map((rule) => (
          <Card key={rule.id} className="overflow-hidden" data-testid={`alert-rule-card-${rule.id}`}>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-4">
              <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                <span className="font-mono text-xs text-text-muted">{rule.id}</span>
                <h3 className="text-sm font-semibold text-text-primary">{rule.name}</h3>
                <Badge variant="severity" value={rule.severity} />
              </div>
              <button
                type="button"
                aria-label={`Toggle ${rule.name} enabled`}
                onClick={() => canEdit && updateRule(rule.id, { enabled: !rule.enabled })}
                disabled={!canEdit}
                className={cn(
                  'relative h-6 w-11 shrink-0 rounded-full transition-colors',
                  rule.enabled ? 'bg-cobalt-primary' : 'bg-surface-600',
                  !canEdit && 'cursor-not-allowed opacity-50',
                )}
              >
                <span
                  className={cn(
                    'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform',
                    rule.enabled ? 'left-[22px]' : 'left-0.5',
                  )}
                />
              </button>
            </div>

            {rule.description && (
              <p className="mt-3 text-xs leading-relaxed text-text-muted">{rule.description}</p>
            )}

            <div className="mt-4 flex flex-wrap items-end gap-8">
              <div>
                <label
                  htmlFor={`${id}-${rule.id}-days`}
                  className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-text-secondary"
                >
                  Threshold — days after ETD
                </label>
                <DaysStepper
                  id={`${id}-${rule.id}-days`}
                  aria-label={`${rule.name} days after ETD`}
                  value={rule.thresholdDays}
                  min={0}
                  max={30}
                  disabled={!canEdit}
                  onChange={(next) => updateRule(rule.id, { thresholdDays: next ?? 0 })}
                />
              </div>
              <div>
                <label
                  htmlFor={`${id}-${rule.id}-severity`}
                  className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-text-secondary"
                >
                  Severity
                </label>
                <select
                  id={`${id}-${rule.id}-severity`}
                  aria-label={`${rule.name} severity`}
                  value={rule.severity}
                  disabled={!canEdit}
                  onChange={(e) => updateRule(rule.id, { severity: e.target.value })}
                  className="h-9 rounded-lg border border-border bg-surface-700 px-3 text-sm text-text-primary focus:border-cobalt-primary focus:outline-none disabled:opacity-50"
                >
                  {SEVERITY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-5 rounded-xl border border-border bg-surface-900/40 p-4">
              <div className="mb-3">
                <p className="text-xs font-semibold text-text-secondary">Country of origin (custom days)</p>
                <p className="mt-0.5 text-[11px] text-text-muted">
                  Overrides this rule’s days-after-ETD threshold when the shipment’s origin matches. Tap −
                  until <span className="font-medium">Default</span> to inherit.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {ALERT_COUNTRY_LIST.map((country) => {
                  const raw = rule.countryThresholds?.[country.code]
                  const days = typeof raw === 'number' && raw > 0 ? raw : null
                  const active = days != null
                  return (
                    <div
                      key={country.code}
                      className={cn(
                        'flex items-center justify-between gap-4 rounded-2xl border px-4 py-3 transition-colors',
                        active ? 'border-cobalt-primary/40 bg-cobalt-primary/10' : 'border-border bg-surface-800/50',
                      )}
                    >
                      <span className="min-w-0 truncate">
                        <span className="block text-sm font-semibold text-text-primary">{country.code}</span>
                        <span className="block text-xs text-text-muted">{country.label}</span>
                      </span>
                      <DaysStepper
                        size="sm"
                        optional
                        emptyLabel="Default"
                        aria-label={`${country.label} days after ETD`}
                        value={days}
                        min={1}
                        max={30}
                        disabled={!canEdit}
                        onChange={(next) => updateCountryDays(rule.id, country.code, next)}
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
```

Check that `Card` forwards `data-testid` (see `frontend/src/components/ui/Card.tsx`) — if it doesn't spread extra props, wrap the Card in a `<div data-testid={...}>` instead.

- [ ] **Step 4: Run the component tests**

```powershell
.\node_modules\.bin\vitest run src/components/settings/AlertRulesSettings.test.tsx
```

Expected: all 5 PASS (adjust the stepper button query per the note in Step 1 if needed).

- [ ] **Step 5: Commit**

```powershell
Set-Location D:\cobalt_track_system
git add frontend/src/components/settings/AlertRulesSettings.tsx frontend/src/components/settings/AlertRulesSettings.test.tsx
git commit -m "feat(ui): single-severity alert-rule cards with reset to defaults

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Remove stale surfaces (standalone page + ungoverned GET)

**Files:**
- Delete: `frontend/src/pages/AlertRulesPage.tsx`
- Modify: `frontend/src/App.tsx:13` (import) and `:134` (route)
- Modify: `frontend/src/pages/AlertsPage.tsx:~193-204` (the header button whose onClick is `navigate('/alerts/rules')` at :199)
- Modify: `backend/src/alerts/alerts.controller.ts:19-21`; `backend/src/alerts/alerts.service.ts` (its `rules()` method, if unreferenced)

- [ ] **Step 1: Frontend removal.** Delete `frontend/src/pages/AlertRulesPage.tsx`. In `App.tsx` remove line 13 (`import AlertRulesPage from './pages/AlertRulesPage'`) and line 134 (the `/alerts/rules` Route; leave a redirect comment consistent with the removed-page pattern used at App.tsx:138-143):

```tsx
        {/* /alerts/rules removed — Settings → Alert Rules is the single editor */}
        <Route path="/alerts/rules" element={<Navigate to="/settings/alerts" replace />} />
```

In `AlertsPage.tsx`, replace the button that navigates to `/alerts/rules` (block around :193-204) so the entry point survives but lands on the governed editor:

```tsx
          onClick={() => navigate('/settings/alerts')}
```

(Keep the button label "Alert Rules"; only the destination changes. If `Navigate` is not imported in App.tsx, add it to the react-router-dom import.)

- [ ] **Step 2: Verify nothing else references the deleted page or old route**

```powershell
Set-Location D:\cobalt_track_system\frontend
findstr /s /n "AlertRulesPage" src\*.tsx src\*.ts
findstr /s /n "alerts/rules" src\*.tsx src\*.ts
```

Expected: only `App.tsx` (the redirect comment/route) remains; no `AlertRulesPage` hits.

- [ ] **Step 3: Backend removal.** First check consumers of the ungoverned read:

```powershell
Set-Location D:\cobalt_track_system\backend
findstr /s /n "alerts.rules\|\.rules()" src\*.ts
```

If `AlertsService.rules()` is called only by `AlertsController.rules()`: delete the `@Get('rules') rules()` handler (alerts.controller.ts:19-21) and the `rules()` method in `alerts.service.ts`. If a spec covers them (`findstr /s /n "rules" src\alerts\*.spec.ts`), delete those cases too. If something else consumes it, leave the service method and delete only the controller route.

- [ ] **Step 4: Run both suites**

```powershell
Set-Location D:\cobalt_track_system\backend
.\node_modules\.bin\vitest run
Set-Location D:\cobalt_track_system\frontend
.\node_modules\.bin\vitest run
```

Expected: both PASS.

- [ ] **Step 5: Commit**

```powershell
Set-Location D:\cobalt_track_system
git add -u frontend/src backend/src
git status --short
git commit -m "chore(alerts): remove standalone rules page and ungoverned GET /alerts/rules

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(`git add -u` scoped to `frontend/src backend/src` picks up the deletion + edits without touching unrelated dirt — confirm with the `git status --short` output that only intended files are staged.)

---

### Task 7: Full gates, live verification, PR

- [ ] **Step 1: Typecheck + full suites both packages**

```powershell
Set-Location D:\cobalt_track_system\backend
.\node_modules\.bin\vitest run
.\node_modules\.bin\tsc --noEmit -p tsconfig.json
Set-Location D:\cobalt_track_system\frontend
.\node_modules\.bin\vitest run
.\node_modules\.bin\tsc
```

Expected: all green, tsc exits 0 twice.

- [ ] **Step 2: Rebuild + restart the dev backend** (it runs compiled `dist`):

```powershell
Set-Location D:\cobalt_track_system\backend
.\node_modules\.bin\nest build
```

Then stop the `node --enable-source-maps dist\main` process on :3000 and start it again the same way (or via the user's usual stack-start flow from the "Run the full system" note).

- [ ] **Step 3: Live verification on http://localhost:5173/settings/alerts** (login super@cobalt.hk / password):
  1. Two cards only — A1 "No Draft BOL received", A3 "No Final BOL received"; each shows id chip, severity badge, toggle, one "Threshold — days after ETD" stepper, Severity select, five country tiles. No State field anywhere.
  2. Change A1 severity to Info + threshold to 2 → Save changes → toast "Saved"; reload → values persisted; severity badge shows INFO.
  3. Set A3 VN override to 4 → Save → reload → VN tile shows 4, others "Default".
  4. Disable A1 → Save → any active A1 alerts on /alerts disappear (resolved).
  5. Reset to defaults → confirm dialog → toast "Defaults restored" → A1 back to 1 day WARNING enabled, A3 to 3 days WARNING, no country overrides.
  6. /alerts page: no dead "Alert Rules" navigation (button lands on Settings → Alert Rules); direct visit to /alerts/rules redirects to /settings/alerts.
  7. `GET http://localhost:3000/api/alerts/rules` returns 404.

- [ ] **Step 4: Push and open the PR**

```powershell
Set-Location D:\cobalt_track_system
git push -u origin feat/alert-rules-single-severity
gh pr create --base main --title "feat(alerts): single-severity alert rules with editable severity + reset to defaults" --body "## Summary
- Collapses the warn/critical pairs (A1+A2 / A3+A4) into two single-severity rules: A1 No Draft BOL, A3 No Final BOL — one days-after-ETD threshold + user-chosen severity each (auto-escalation dropped, per product decision)
- Migration 0018 retires A2/A4 (disabled + locked, open alerts resolved; rows kept for history/FK)
- PUT /alert-rules now has a class-validator DTO; severity pinning removed; locked-rule check moved server-side; country overrides sanitized (CN/BD/KH/VN/IN, 1-30 days)
- New POST /alert-rules/reset — true factory reset (shared catalogue module keeps seed and reset in lockstep)
- Seed: 2-rule catalog, retires everything else, and STOPS clobbering user-tuned thresholds/severity/overrides on redeploy
- Settings → Alert Rules rewritten per approved mockup: id chip / severity badge / toggle / threshold stepper / severity select / 5-country overrides; Reset to defaults + Save changes
- Removed the stale standalone /alerts/rules editor and the ungoverned GET /alerts/rules

## Test plan
- [x] DTO validation spec (whitelist pipe keeps country map, rejects bad severity/threshold)
- [x] 6 new saveAlertRules/resetAlertRules service cases + reset controller governance cases
- [x] Rewritten AlertRulesSettings component tests (5 cases)
- [x] Full backend + frontend suites, tsc both packages
- [x] Live: save/persist severity + overrides, disable-resolves, reset flow, redirects, 404 on removed endpoint

Spec: docs/superpowers/specs/2026-07-22-alert-rules-single-severity-design.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

---

## Self-review notes (done at plan time)

- **Spec coverage:** catalog collapse → Tasks 1/4; DTO + de-pinning + server-side lock + sanitize → Tasks 2/3; reset endpoint → Task 3; seed non-clobbering → Task 4; mockup UI (no state, 5 countries, two header buttons) → Task 5; stale-surface cleanup → Task 6; engine untouched → no task touches `backend/src/alerts/alert-rules.ts` or the evaluator.
- **Behavioral risk called out:** dropping auto-escalation was explicitly user-approved; the migration resolves (not deletes) A2/A4 alerts and is reversible via `down()`.
- **Known judgment points for the implementer:** DaysStepper button accessible names (Task 5 Step 1 note), `Card` prop forwarding (Task 5 Step 3 note), `migrate-cli` invocation signature (Task 1 Step 4 note), and whether `AlertsService.rules()` has other consumers (Task 6 Step 3 grep gate).
- **Type consistency:** `SaveAlertRulesDto`/`AlertRuleUpdateDto` names match between Tasks 2/3; `resetAlertRules` naming consistent across service/controller/spec; payload key set in frontend Task 5 matches the DTO fields exactly.
