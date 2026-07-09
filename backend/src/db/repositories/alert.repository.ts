import { Inject, Injectable } from '@nestjs/common'
import { type Kysely } from 'kysely'
import type { DB } from '../kysely/db'
import { KYSELY } from '../kysely.provider'
import type { SHIPMENT_STATE, ALERT_TRIGGER_TYPE, ALERT_TRIGGER_REF, ALERT_WATCH_FOR, ALERT_SEVERITY, COMPUTE_TZ } from '../enums'

/** Insert shape for a fired alert instance (the `alerts` table). `dedupKey` is always set by the evaluator. */
export interface AlertInsert {
  ruleId: string
  bookingId?: string | null
  shipmentId?: string | null
  severity: string
  status?: string
  message: string
  dedupKey?: string | null
  firedAt?: Date
}

/** Insert shape for a built-in alert rule row (PK = the stable code, e.g. 'A7'). */
export interface AlertRuleInsert {
  id: string
  name: string
  description: string
  state?: (typeof SHIPMENT_STATE)[number] | null
  triggerType: (typeof ALERT_TRIGGER_TYPE)[number]
  triggerReference: (typeof ALERT_TRIGGER_REF)[number]
  watchFor: (typeof ALERT_WATCH_FOR)[number]
  thresholdHours: number
  countryThresholds?: Record<string, number> | null
  severity: (typeof ALERT_SEVERITY)[number]
  computeTz?: (typeof COMPUTE_TZ)[number]
  enabled?: boolean
  locked?: boolean
}

/** Kysely/SQL Server port of AlertRepository. Alert-rule catalogue reads + fired-alert CRUD/dedup.
 *
 *  Postgres → MSSQL notes:
 *  - `onConflictDoNothing` (dedup_key unique + rule PK) → check-then-insert catching the unique violation.
 *    `dedupKey` is ALWAYS set by the evaluator (`${rule.id}:${leg.id}`), so the SQL Server single-NULL
 *    unique-index gotcha (one NULL allowed, vs Postgres's many) does not bite here.
 *  - `returning` → `OUTPUT` (`.output`/`.outputAll`).
 *  - The `alerts` Postgres table is named `alertInstances` in the Drizzle schema; the codegen'd Kysely
 *    table is `alerts` (snake_case `alerts`). `alertRules` → `alert_rules`. */
@Injectable()
export class AlertRepository {
  constructor(@Inject(KYSELY) private readonly db: Kysely<DB>) {}

  enabledRules() {
    return this.db.selectFrom('alertRules').where('enabled', '=', true).selectAll().execute()
  }

  allRules() {
    return this.db.selectFrom('alertRules').orderBy('id').selectAll().execute()
  }

  list(status?: string) {
    let q = this.db.selectFrom('alerts')
    if (status) q = q.where('status', '=', status)
    return q.orderBy('firedAt', 'desc').selectAll().execute()
  }

  /** Insert a fired alert; returns true only if it was new (dedup_key unique absorbs replays). */
  async insertDeduped(values: AlertInsert): Promise<boolean> {
    try {
      const inserted = await this.db
        .insertInto('alerts')
        .values(values)
        .output('inserted.id')
        .executeTakeFirst()
      return !!inserted
    } catch (e) {
      // unique violation on dedup_key → a duplicate firing (same rule + shipment + window), not an error
      if (!/unique|duplicate/i.test((e as Error).message)) throw e
      return false
    }
  }

  /** Idempotently register a rule row — built-in checks need a rule id to hang their alerts on. */
  async ensureRule(values: AlertRuleInsert): Promise<void> {
    try {
      await this.db
        .insertInto('alertRules')
        .values({
          ...values,
          // country_thresholds is a JSON nvarchar(max) column in SQL Server (Drizzle typed it Record<…>)
          countryThresholds: values.countryThresholds != null ? JSON.stringify(values.countryThresholds) : null,
        })
        .execute()
    } catch (e) {
      // unique violation on the PK (id) → the rule already exists; idempotent
      if (!/unique|duplicate/i.test((e as Error).message)) throw e
    }
  }

  async setStatus(id: string, status: string, extra: Record<string, unknown>) {
    const row = await this.db
      .updateTable('alerts')
      .set({ status, ...extra })
      .where('id', '=', id)
      .outputAll('inserted')
      .executeTakeFirst()
    return row ?? null
  }

  /** Stamp/clear read_at without touching status (an ACTIVE alert can still be read). */
  async setReadAt(id: string, readAt: Date | null) {
    const row = await this.db
      .updateTable('alerts')
      .set({ readAt })
      .where('id', '=', id)
      .outputAll('inserted')
      .executeTakeFirst()
    return row ?? null
  }

  /** Patch an alert rule (threshold/severity/enabled/country overrides). */
  async updateRule(id: string, patch: Record<string, unknown>) {
    const row = await this.db
      .updateTable('alertRules')
      .set(patch)
      .where('id', '=', id)
      .outputAll('inserted')
      .executeTakeFirst()
    return row ?? null
  }
}
