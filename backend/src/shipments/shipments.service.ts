import { Injectable, NotFoundException } from '@nestjs/common'
import { ShipmentRepository } from '../db/repositories/shipment.repository'
import { BookingRepository } from '../db/repositories/booking.repository'
import { FieldLockRepository } from '../db/repositories/field-lock.repository'
import { AuditRepository } from '../db/repositories/audit.repository'
import { strongKeys, keysOverlap, normKey, str } from '../reconcile/match-keys'
import { deriveRoute } from '../presentation/adapters/derive'

// Human-editable leg columns (DB names). Excludes computed/master-resolved fields (customer/forwarder/route/
// ports) which need lookups, and identity plumbing. Same coercion the review flow uses.
const DATE_FIELDS = new Set(['cargoReadyDate', 'cfsCutoff', 'warehouseStartDate', 'warehouseEndDate', 'etd', 'atd', 'eta', 'ata', 'inDcDate'])
const NUMERIC_FIELDS = new Set(['qty', 'grossWeight', 'measurement'])
const EDITABLE_FIELDS = new Set([
  'bookingNo', 'soNo', 'hblAwbFcrNo', 'mbl', 'containerNo', 'scacCode',
  'qty', 'qtyUnit', 'grossWeight', 'measurement', 'itemStyleNo', 'htsCode',
  'consigneeName', 'consigneeAddress', 'vesselName', 'voyageNo',
  ...DATE_FIELDS,
])
function coerceField(field: string, value: unknown): unknown {
  if (value == null || value === '') return null
  if (DATE_FIELDS.has(field)) { const d = new Date(String(value)); return Number.isNaN(d.getTime()) ? null : d }
  if (NUMERIC_FIELDS.has(field)) { const n = Number(value); return Number.isFinite(n) ? n : null }
  return String(value)
}
const asStr = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v))

@Injectable()
export class ShipmentsService {
  constructor(
    private readonly shipments: ShipmentRepository,
    private readonly bookings: BookingRepository,
    private readonly fieldLocks: FieldLockRepository,
    private readonly audit: AuditRepository,
  ) {}

  /**
   * Human edit of shipment fields from the detail page. Each edited field is written, LOCKED (human-wins,
   * so the parser/committer can never overwrite it), and audited to Change History — the same guarantees the
   * review flow gives, but for any shipment and without changing its review status. Unknown/non-editable
   * fields are ignored (whitelist). `actorId` is the acting user for the lock + audit trail.
   */
  async editFields(id: string, fields: Record<string, unknown>, actorId: string | null) {
    const leg = await this.shipments.findById(id)
    if (!leg) throw new NotFoundException(`shipment ${id} not found`)
    const current = leg as Record<string, unknown>
    const edited: string[] = []
    for (const [field, raw] of Object.entries(fields ?? {})) {
      if (!EDITABLE_FIELDS.has(field)) continue
      const value = coerceField(field, raw)
      if (asStr(current[field]) === asStr(value)) continue // no-op edit — skip lock/audit noise
      await this.shipments.updateLeg(id, { [field]: value })
      await this.fieldLocks.lock('shipment', id, field, asStr(value), actorId)
      await this.audit.write({
        entityType: 'shipment', entityId: id, field,
        oldValue: asStr(current[field]), newValue: asStr(value), changeType: 'update',
        sourceType: 'manual', actorUserId: actorId, note: 'edited on shipment detail',
      })
      edited.push(field)
    }
    return { id, edited }
  }

  /** A single leg, enriched like the tracker list (customer / forwarder / route / linked POs) + timeline. */
  async getOne(id: string) {
    const leg = await this.shipments.legDetailById(id)
    if (!leg) throw new NotFoundException(`shipment ${id} not found`)
    const [milestones, pos, identifiers] = await Promise.all([
      this.shipments.milestonesFor(id),
      this.shipments.linkedPosForBooking(leg.bookingId),
      this.shipments.identifiersFor(id),
    ])
    return {
      id: leg.id,
      bookingId: leg.bookingId,
      jobNo: leg.jobNo,
      bookingNo: leg.bookingNo ?? leg.containerNo ?? leg.hblAwbFcrNo ?? leg.soNo ?? leg.jobNo,
      soNo: leg.soNo,
      hblAwbFcrNo: leg.hblAwbFcrNo,
      mbl: leg.mbl,
      containerNo: leg.containerNo,
      mode: leg.mode,
      state: leg.state,
      legStatus: leg.legStatus,
      riskLevel: leg.riskLevel,
      reviewStatus: leg.reviewStatus,
      confidence: leg.confidence,
      reviewReasons: leg.reviewReasons,
      etd: leg.etd,
      atd: leg.atd,
      eta: leg.eta,
      updatedAt: leg.updatedAt,
      route: deriveRoute(leg.polCode ?? leg.polRaw, leg.podCode ?? leg.podRaw),
      customer: leg.customerId ? { id: leg.customerId, name: leg.customerName, code: leg.customerCode } : null,
      forwarder: leg.forwarderId ? { id: leg.forwarderId, name: leg.forwarderName } : leg.forwarderRaw ? { id: '', name: leg.forwarderRaw } : null,
      pos: pos.map((p) => ({
        id: p.id,
        poNumber: p.poNumber,
        totalQuantity: p.totalQuantity,
        quantityUnit: p.quantityUnit,
        vendor: p.vendorName ? { name: p.vendorName } : null,
      })),
      milestones,
      // every value each identity field ever held (current + superseded/conflict alternates)
      identifiers: identifiers.map((x) => ({
        type: x.type,
        value: x.value,
        docType: x.docType,
        isCurrent: x.isCurrent,
        sourceEmailId: x.sourceEmailId,
      })),
    }
  }

  /** Shipment Tracker list — active legs enriched with customer / forwarder / route / POs / risk. */
  async listForTracker(status?: string) {
    const rows = await this.shipments.legsForTracker(status && status !== 'ALL' ? status : undefined)
    const shipments = await Promise.all(
      rows.map(async (r) => {
        const pos = await this.shipments.linkedPosForBooking(r.bookingId)
        return {
          id: r.id,
          bookingId: r.bookingId,
          // the durable, human-quoted job/process number (stable across rotating forwarder IDs)
          jobNo: r.jobNo,
          // "Shipment ID" display — the most specific identifier carried by this leg
          bookingNo: r.bookingNo ?? r.containerNo ?? r.hblAwbFcrNo ?? r.soNo ?? r.jobNo,
          soNumber: r.soNo,
          hblNumber: r.hblAwbFcrNo,
          containerNo: r.containerNo,
          mblNumber: r.mbl,
          mode: r.mode,
          status: r.status,
          riskLevel: r.riskLevel,
          reviewStatus: r.reviewStatus,
          confidence: r.confidence,
          etd: r.etd,
          eta: r.eta,
          updatedAt: r.updatedAt,
          route: deriveRoute(r.polCode ?? r.polRaw, r.podCode ?? r.podRaw),
          customer: r.customerId ? { id: r.customerId, name: r.customerName, code: r.customerCode } : null,
          forwarder: r.forwarderId ? { id: r.forwarderId, name: r.forwarderName } : r.forwarderRaw ? { id: '', name: r.forwarderRaw } : null,
          linkedPOs: pos.map((p) => ({
            id: p.id,
            poNumber: p.poNumber,
            quantity: null as number | null,
            totalQuantity: p.totalQuantity,
            quantityUnit: p.quantityUnit,
            vendor: p.vendorName ? { name: p.vendorName } : null,
          })),
        }
      }),
    )
    return { shipments }
  }

  /**
   * Matcher read-API: given a strong-key bag (so_no / booking_no / hbl_awb_fcr_no / mbl /
   * container_no + optional customer_po), return candidate legs so the Agent VM can decide
   * update-vs-create and see which fields are human-locked (it must not try to overwrite those).
   * Mirrors the committer's match rule: strong-key overlap OR a shared PO.
   */
  async lookupByMatchKey(q: Record<string, unknown>) {
    const keys = {
      so_no: str(q.so_no),
      booking_no: str(q.booking_no),
      hbl_awb_fcr_no: str(q.hbl_awb_fcr_no),
      mbl: str(q.mbl),
      container_no: str(q.container_no),
      customer_po: str(q.customer_po),
    }
    const gk = strongKeys(keys)
    const poNorm = keys.customer_po ? normKey(keys.customer_po) : null
    if (gk.size === 0 && !poNorm) return { query: keys, candidates: [] as unknown[] }

    const legs = await this.shipments.allLegs()
    const candidates: unknown[] = []
    for (const leg of legs) {
      const pos = await this.bookings.poNumbersFor(leg.bookingId)
      const byKey = gk.size > 0 && keysOverlap(strongKeys(leg.matchKeys as Record<string, unknown>), gk)
      const byPo = !!poNorm && pos.map(normKey).includes(poNorm)
      if (!byKey && !byPo) continue
      const booking = await this.bookings.findById(leg.bookingId)
      const locks = await this.fieldLocks.forEntity(leg.id)
      const lockedFields = locks.filter((l) => l.entityType === 'shipment').map((l) => l.field)
      candidates.push({ ...leg, jobNo: booking?.jobNo ?? null, pos, lockedFields, matchedBy: byKey ? 'strong_key' : 'po' })
    }
    return { query: keys, candidates }
  }
}
