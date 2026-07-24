import { Injectable, Logger } from '@nestjs/common'
import { deriveState, stateRank, type ShipmentState } from './state'
import { ShipmentRepository } from '../db/repositories/shipment.repository'
import { AuditRepository } from '../db/repositories/audit.repository'
import { SettingsRepository } from '../db/repositories/settings.repository'
import { loadEtdFallback } from '../settings/etd-fallback'

export type StatePromotion = {
  shipmentId: string
  bookingNo: string | null
  from: string
  to: ShipmentState
  /** Which clock-dependent rule became true. Diagnostic only — the state itself is deriveState's. */
  reason: string
}

export type StateRefreshResult = {
  scanned: number
  promotions: StatePromotion[]
  /**
   * Legs whose recompute came out LOWER than what is stored — reported, never written.
   *
   * These are the data-quality cases: the leg claims a stage its own evidence no longer supports.
   * GZL26261147 in the live data stores RELEASED with no atd and no Departure Notice among its
   * email types, so it re-derives to SAILED. Something set that state and the proof is gone.
   * Silently skipping them would hide exactly the rows worth a human's eye, and silently
   * "correcting" them downward would be the app overruling its own history.
   */
  regressions: StatePromotion[]
  applied: number
  dryRun: boolean
}

/**
 * Re-derives leg state on a clock, not on an email.
 *
 * `deriveState` reads the real system time, but the committer is the only thing that calls it — at
 * the instant an email is committed. Three of its rules become true purely by the calendar turning:
 *
 *   warehouse_start_date <= today                    -> AT_WAREHOUSE
 *   Invoice/Billing + carrier doc + etd in the past  -> RELEASED
 *   departed + eta <= today                          -> DELIVERED
 *
 * With nothing re-running the derivation, a leg freezes at whatever its LAST email could prove. A
 * shipment that went quiet in February still read "Departure" in July with an ETA five months gone.
 * This service closes that gap by re-deriving from what is already stored: the leg's own date
 * columns plus the email TYPES recorded in shipment_emails.
 *
 * PROMOTE ONLY. A recomputation can legitimately come out LOWER than the stored value — a human may
 * have cleared an ATD, or a leg committed before shipment_emails was populated may have no recorded
 * types at all — and silently walking a shipment backwards would be far worse than leaving it stale.
 * Anything that does not strictly outrank the stored state is skipped and counted, never written.
 */
@Injectable()
export class StateRefreshService {
  private readonly log = new Logger(StateRefreshService.name)

  constructor(
    private readonly shipments: ShipmentRepository,
    private readonly audit: AuditRepository,
    private readonly settings: SettingsRepository,
  ) {}

  async refresh(now: Date = new Date(), opts: { dryRun?: boolean } = {}): Promise<StateRefreshResult> {
    const dryRun = opts.dryRun === true
    const legs = await this.shipments.legsForStateRefresh()
    const typesByShipment = await this.shipments.emailTypesForShipments(legs.map((l) => l.id))
    // Loaded once per run — the Settings-page transit allowances for the no-arrival-data fallback.
    const etdFallback = await loadEtdFallback(this.settings)

    const promotions: StatePromotion[] = []
    const regressions: StatePromotion[] = []
    for (const leg of legs) {
      const emailTypes = typesByShipment.get(leg.id) ?? new Set<string>()
      const fields = legFields(leg)
      const next = deriveState(emailTypes, fields, now, { etdFallback })
      const delta = stateRank(next) - stateRank(leg.state)
      if (delta === 0) continue
      const row: StatePromotion = {
        shipmentId: leg.id,
        bookingNo: leg.bookingNo ?? leg.soNo ?? leg.hblAwbFcrNo ?? null,
        from: leg.state,
        to: next,
        reason: delta > 0 ? reasonFor(next, fields, emailTypes, now) : 'stored state no longer supported by the leg’s own evidence',
      }
      if (delta > 0) promotions.push(row)
      else regressions.push(row)
    }
    if (regressions.length > 0) {
      this.log.warn(`state refresh: ${regressions.length} leg(s) store a state their evidence no longer proves`)
    }

    if (dryRun) {
      return { scanned: legs.length, promotions, regressions, applied: 0, dryRun: true }
    }

    let applied = 0
    for (const p of promotions) {
      await this.shipments.setState(p.shipmentId, p.to)
      // Change History gets the same shape a committed email would leave, so the story reads
      // continuously. sourceType 'system' and no actorUserId — nobody clicked this.
      await this.audit.write({
        entityType: 'shipment',
        entityId: p.shipmentId,
        changeType: 'update',
        sourceType: 'system',
        field: 'state',
        oldValue: p.from,
        newValue: p.to,
        note: `Lifecycle re-derived on schedule (${p.reason})`,
      })
      applied += 1
    }
    if (applied > 0) this.log.log(`state refresh promoted ${applied}/${legs.length} leg(s)`)
    return { scanned: legs.length, promotions, regressions, applied, dryRun: false }
  }
}

/**
 * Leg columns -> the snake_case bag deriveState reads.
 *
 * Dates MUST be ISO strings. The driver hands back JS Dates, and deriveState's day compare does
 * `String(value).slice(0, 10)` then tests /^\d{4}-\d{2}-\d{2}$/ — `String(new Date())` is
 * "Wed Jul 23 2026 …", which fails that regex, so every date rule would silently never fire.
 */
function legFields(leg: Record<string, unknown>): Record<string, unknown> {
  return {
    so_no: leg.soNo ?? null,
    mbl: leg.mbl ?? null,
    hbl_awb_fcr_no: leg.hblAwbFcrNo ?? null,
    warehouse_start_date: iso(leg.warehouseStartDate),
    etd: iso(leg.etd),
    atd: iso(leg.atd),
    eta: iso(leg.eta),
    ata: iso(leg.ata),
    in_dc_date: iso(leg.inDcDate),
  }
}

function iso(value: unknown): string | null {
  if (value == null || value === '') return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  return String(value)
}

/** Best-effort label for WHY a promotion happened — for the audit note and the dry-run report. */
function reasonFor(
  next: string,
  fields: Record<string, unknown>,
  emailTypes: Set<string>,
  now: Date,
): string {
  if (next === 'DELIVERED') {
    if (fields.ata) return 'ATA recorded'
    if (fields.in_dc_date) return 'in-DC date recorded'
    if (fields.eta) return 'ETA has passed'
    return 'no arrival data — departure older than the transit allowance'
  }
  if (next === 'RELEASED') {
    if (fields.atd) return 'ATD recorded'
    if (emailTypes.has('Departure Notice')) return 'Departure Notice on file'
    return 'invoice + carrier document with a past ETD'
  }
  if (next === 'AT_WAREHOUSE') {
    if (emailTypes.has('Draft B/L')) return 'Draft B/L on file'
    return 'warehouse start date has arrived'
  }
  void now
  return 'evidence on file now outranks the stored state'
}
