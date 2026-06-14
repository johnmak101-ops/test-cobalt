import { Injectable, NotFoundException } from '@nestjs/common'
import { ShipmentRepository } from '../db/repositories/shipment.repository'
import { BookingRepository } from '../db/repositories/booking.repository'
import { FieldLockRepository } from '../db/repositories/field-lock.repository'
import { AuditRepository } from '../db/repositories/audit.repository'
import type { CorrectDto } from './dto'

const DATE_FIELDS = new Set([
  'cargoReadyDate', 'cfsCutoff', 'warehouseStartDate', 'warehouseEndDate', 'etd', 'atd', 'eta', 'ata', 'inDcDate',
])

/** Coerce a human-entered value to the shipment column's type (dates → Date, qty → number). */
function coerce(field: string, value: unknown): unknown {
  if (value == null || value === '') return null
  if (DATE_FIELDS.has(field)) {
    const d = new Date(String(value))
    return Number.isNaN(d.getTime()) ? null : d
  }
  if (field === 'qty') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return String(value)
}
const toStr = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v))

/**
 * The human review workflow over the commit-first model: provisional shipments are listed here,
 * and a reviewer either confirms them as-is or corrects fields. A correction LOCKS each edited field
 * (human-wins) so the agent can never overwrite it, records the reason, and audits every change.
 */
@Injectable()
export class ReviewService {
  constructor(
    private readonly shipments: ShipmentRepository,
    private readonly bookings: BookingRepository,
    private readonly fieldLocks: FieldLockRepository,
    private readonly audit: AuditRepository,
  ) {}

  /** Provisional shipments awaiting review, lowest confidence first, with booking context. */
  async queue() {
    const legs = await this.shipments.provisionalLegs()
    return Promise.all(
      legs.map(async (leg) => {
        const booking = await this.bookings.findById(leg.bookingId)
        const pos = await this.bookings.poNumbersFor(leg.bookingId)
        return { ...leg, jobNo: booking?.jobNo ?? null, pos }
      }),
    )
  }

  /** Accept a provisional shipment as-is. */
  async confirm(shipmentId: string, actorId: string) {
    const leg = await this.shipments.findById(shipmentId)
    if (!leg) throw new NotFoundException(`shipment ${shipmentId} not found`)
    await this.shipments.updateLeg(shipmentId, { reviewStatus: 'confirmed', reviewedBy: actorId, reviewedAt: new Date() })
    await this.audit.write({
      entityType: 'shipment', entityId: shipmentId, field: null,
      oldValue: leg.reviewStatus, newValue: 'confirmed', changeType: 'update',
      sourceType: 'manual', actorUserId: actorId, note: 'review: confirmed as-is',
    })
    return { shipmentId, reviewStatus: 'confirmed' }
  }

  /** Correct fields on a provisional shipment: edits win, lock, are audited, and confirm the leg. */
  async correct(shipmentId: string, dto: CorrectDto, actorId: string) {
    const leg = await this.shipments.findById(shipmentId)
    if (!leg) throw new NotFoundException(`shipment ${shipmentId} not found`)
    const current = leg as Record<string, unknown>
    const corrected: string[] = []

    for (const [field, raw] of Object.entries(dto.fields ?? {})) {
      const value = coerce(field, raw)
      await this.shipments.updateLeg(shipmentId, { [field]: value })
      await this.fieldLocks.lock('shipment', shipmentId, field, toStr(value), actorId)
      await this.audit.write({
        entityType: 'shipment', entityId: shipmentId, field,
        oldValue: toStr(current[field]), newValue: toStr(value), changeType: 'update',
        sourceType: 'manual', actorUserId: actorId, note: dto.reason ?? 'review: corrected',
      })
      corrected.push(field)
    }

    await this.shipments.updateLeg(shipmentId, { reviewStatus: 'confirmed', reviewedBy: actorId, reviewedAt: new Date() })
    return { shipmentId, reviewStatus: 'confirmed', corrected }
  }
}
