import { Injectable, NotFoundException } from '@nestjs/common'
import { ShipmentRepository } from '../db/repositories/shipment.repository'
import { BookingRepository } from '../db/repositories/booking.repository'
import { FieldLockRepository } from '../db/repositories/field-lock.repository'
import { AuditRepository } from '../db/repositories/audit.repository'
import { QueueLearningClient } from './queue-learning.client'
import type { CorrectDto } from './dto'

const DATE_FIELDS = new Set([
  'cargoReadyDate', 'cfsCutoff', 'warehouseStartDate', 'warehouseEndDate', 'etd', 'atd', 'eta', 'ata', 'inDcDate',
])

const NUMERIC_FIELDS = new Set(['qty', 'grossWeight', 'measurement'])

/** Coerce a human-entered value to the shipment column's type (dates → Date, numerics → number). */
function coerce(field: string, value: unknown): unknown {
  if (value == null || value === '') return null
  if (DATE_FIELDS.has(field)) {
    const d = new Date(String(value))
    return Number.isNaN(d.getTime()) ? null : d
  }
  if (NUMERIC_FIELDS.has(field)) {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return String(value)
}
const toStr = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v))

/** Leg (camelCase) column → the queue's snake_case parse-field name (booking_no, hbl_awb_fcr_no, …). The
 *  track DB columns ARE the queue parse fields, so a plain camel→snake conversion is exact. Without this the
 *  learning feed posted leg columns (`soNo`) that never matched the parser's fields (`so_no`) — the queue's
 *  eval could not score them. */
const toQueueField = (col: string): string => col.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()

/** The parse-derived leg columns a reviewer can accept ("looks right") — the same set the review UI edits
 *  (frontend review-fields.ts). `isDate` cols are frozen as YYYY-MM-DD to match the parser's date format so
 *  the confirm actually matches on the queue's re-parse. */
const CONFIRMABLE_FIELDS: { column: string; isDate: boolean }[] = [
  { column: 'bookingNo', isDate: false }, { column: 'soNo', isDate: false }, { column: 'itemStyleNo', isDate: false },
  { column: 'qty', isDate: false }, { column: 'qtyUnit', isDate: false }, { column: 'grossWeight', isDate: false },
  { column: 'measurement', isDate: false }, { column: 'htsCode', isDate: false }, { column: 'hblAwbFcrNo', isDate: false },
  { column: 'mbl', isDate: false }, { column: 'containerNo', isDate: false }, { column: 'scacCode', isDate: false },
  { column: 'vesselName', isDate: false }, { column: 'voyageNo', isDate: false }, { column: 'consigneeName', isDate: false },
  { column: 'consigneeAddress', isDate: false }, { column: 'cargoReadyDate', isDate: true }, { column: 'cfsCutoff', isDate: true },
  { column: 'etd', isDate: true }, { column: 'atd', isDate: true }, { column: 'eta', isDate: true }, { column: 'ata', isDate: true },
  { column: 'warehouseStartDate', isDate: true }, { column: 'warehouseEndDate', isDate: true },
]

/** The value a confirm freezes: what the reviewer SAW, in the parser's own format (dates → YYYY-MM-DD so a
 *  later soul re-parse compares equal). Null/blank → not confirmable. */
function confirmValue(isDate: boolean, value: unknown): string | null {
  if (value == null || value === '') return null
  if (isDate) {
    const d = value instanceof Date ? value : new Date(String(value))
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
  }
  return String(value)
}

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
    private readonly queueLearning: QueueLearningClient,
  ) {}

  /** Provisional shipments awaiting review, lowest confidence first, with booking context. */
  async queue() {
    const legs = await this.shipments.provisionalLegs()
    // Two bulk loads (bookings + PO numbers) keyed by bookingId instead of a findById + poNumbersFor per
    // leg — the review queue was 2N round-trips; now 2, regardless of how many legs await review.
    const bookingIds = legs.map((l) => l.bookingId)
    const [bookingsById, posByBooking] = await Promise.all([
      this.bookings.findByIds(bookingIds),
      this.bookings.poNumbersByBooking(bookingIds),
    ])
    return legs.map((leg) => ({
      ...leg,
      jobNo: bookingsById.get(leg.bookingId)?.jobNo ?? null,
      pos: posByBooking.get(leg.bookingId) ?? [],
    }))
  }

  /** Accept a provisional shipment as-is. An optional reviewer note is audited (soul feedback). A "looks
   *  right" acceptance also vouches for every parse-derived field, so we emit a confirm-sentinel per field
   *  to the queue's learning feed (guards its held-out eval — a soul that starts mis-parsing a confirmed
   *  field regresses the score). Nothing was edited → the edited set is empty. */
  async confirm(shipmentId: string, actorId: string, note?: string) {
    const leg = await this.shipments.findById(shipmentId)
    if (!leg) throw new NotFoundException(`shipment ${shipmentId} not found`)
    await this.shipments.updateLeg(shipmentId, { reviewStatus: 'confirmed', reviewedBy: actorId, reviewedAt: new Date() })
    await this.audit.write({
      entityType: 'shipment', entityId: shipmentId, field: null,
      oldValue: leg.reviewStatus, newValue: 'confirmed', changeType: 'update',
      sourceType: 'manual', actorUserId: actorId, note: note?.trim() || 'review: confirmed as-is',
    })
    const messageId = (await this.shipments.sourceGraphIdFor(shipmentId)) ?? shipmentId
    const forwarder = ((leg as Record<string, unknown>).forwarderRaw as string | null) ?? null
    await this.emitConfirms(leg as Record<string, unknown>, new Set(), messageId, forwarder)
    return { shipmentId, reviewStatus: 'confirmed' }
  }

  /** Emit a "looks right" confirm-sentinel to the queue learning feed for every confirmable parse field that
   *  is non-null and was NOT just edited. Each is one POST with kind:'confirm', agentSaid == humanCorrected
   *  == the frozen value the reviewer saw (dates as YYYY-MM-DD, the parser's format, so a later soul re-parse
   *  compares equal). Best-effort — postCorrection swallows its own errors and never breaks the review save. */
  private async emitConfirms(leg: Record<string, unknown>, edited: Set<string>, messageId: string, forwarder: string | null) {
    for (const { column, isDate } of CONFIRMABLE_FIELDS) {
      if (edited.has(column)) continue
      const frozen = confirmValue(isDate, leg[column])
      if (frozen == null) continue
      await this.queueLearning.postCorrection({
        messageId, field: toQueueField(column), agentSaid: frozen, humanCorrected: frozen, forwarder, note: null, kind: 'confirm',
      })
    }
  }

  /** Correct fields on a provisional shipment: edits win, lock, are audited, and confirm the leg. */
  async correct(shipmentId: string, dto: CorrectDto, actorId: string) {
    const leg = await this.shipments.findById(shipmentId)
    if (!leg) throw new NotFoundException(`shipment ${shipmentId} not found`)
    const current = leg as Record<string, unknown>
    const corrected: string[] = []
    // Attribute the corrections to a source email (graph id → the queue resolves it to the parsed record);
    // fall back to the shipment id so the correction is still captured when no source email is linked.
    const messageId = (await this.shipments.sourceGraphIdFor(shipmentId)) ?? shipmentId
    const forwarder = ((leg as Record<string, unknown>).forwarderRaw as string | null) ?? null

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
      // Feed the correction to the queue learning loop (best-effort; never breaks the review save). Post the
      // queue's snake_case parse-field name — the leg column `soNo` is the parser's `so_no`, and the queue
      // scores on the parse field, so a camelCase name would silently never match.
      await this.queueLearning.postCorrection({
        messageId, field: toQueueField(field), agentSaid: toStr(current[field]), humanCorrected: toStr(value),
        forwarder, note: dto.reason ?? null, kind: 'correction',
      })
    }

    // The parse-derived fields the reviewer looked at and left untouched are an implicit "looks right".
    await this.emitConfirms(current, new Set(corrected), messageId, forwarder)

    await this.shipments.updateLeg(shipmentId, { reviewStatus: 'confirmed', reviewedBy: actorId, reviewedAt: new Date() })
    return { shipmentId, reviewStatus: 'confirmed', corrected }
  }

  /** Bulk "not a trackable shipment": stamp dismissed_at so the leg leaves the review queue WITHOUT
   *  vouching for its data. reviewStatus stays 'provisional' (confirmed would enter alerts/automation)
   *  and NO confirm-sentinels are posted (approving noise would poison the queue's learning feed).
   *  Sticky by design: the committer never touches dismissed_at, so a recurring portal echo does not
   *  resurface daily. Rows that are not pending provisional SHIPMENTs are skipped, not errors — the
   *  queue may have moved under a stale selection. */
  async dismiss(shipmentIds: string[], actorId: string, note?: string) {
    let dismissed = 0
    for (const id of shipmentIds) {
      const leg = await this.shipments.findById(id)
      if (!leg || leg.kind !== 'SHIPMENT' || leg.reviewStatus !== 'provisional' || leg.dismissedAt != null) continue
      await this.shipments.updateLeg(id, { dismissedAt: new Date(), reviewedBy: actorId, reviewedAt: new Date() })
      await this.audit.write({
        entityType: 'shipment', entityId: id, field: null,
        oldValue: 'provisional', newValue: 'dismissed', changeType: 'update',
        sourceType: 'manual', actorUserId: actorId,
        note: note?.trim() ? `review: dismissed — ${note.trim()}` : 'review: dismissed — not a trackable shipment',
      })
      dismissed += 1
    }
    return { dismissed }
  }

  /** Undo a dismiss: the leg returns to the pending review queue. No-op when not dismissed. */
  async restore(shipmentId: string, actorId: string) {
    const leg = await this.shipments.findById(shipmentId)
    if (!leg) throw new NotFoundException(`shipment ${shipmentId} not found`)
    if (leg.dismissedAt == null) return { shipmentId, restored: false }
    await this.shipments.updateLeg(shipmentId, { dismissedAt: null })
    await this.audit.write({
      entityType: 'shipment', entityId: shipmentId, field: null,
      oldValue: 'dismissed', newValue: 'provisional', changeType: 'update',
      sourceType: 'manual', actorUserId: actorId, note: 'review: restored to queue',
    })
    return { shipmentId, restored: true }
  }
}
