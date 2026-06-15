import { Injectable, NotFoundException } from '@nestjs/common'
import { ShipmentRepository } from '../db/repositories/shipment.repository'
import { BookingRepository } from '../db/repositories/booking.repository'
import { FieldLockRepository } from '../db/repositories/field-lock.repository'
import { strongKeys, keysOverlap, normKey, str } from '../reconcile/match-keys'

@Injectable()
export class ShipmentsService {
  constructor(
    private readonly shipments: ShipmentRepository,
    private readonly bookings: BookingRepository,
    private readonly fieldLocks: FieldLockRepository,
  ) {}

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
      route: leg.polCode && leg.podCode ? `${leg.polCode}→${leg.podCode}` : (leg.polCode ?? leg.podCode ?? null),
      customer: leg.customerId ? { id: leg.customerId, name: leg.customerName, code: leg.customerCode } : null,
      forwarder: leg.forwarderId ? { id: leg.forwarderId, name: leg.forwarderName } : null,
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
          route: r.polCode && r.podCode ? `${r.polCode}→${r.podCode}` : (r.polCode ?? r.podCode ?? null),
          customer: r.customerId ? { id: r.customerId, name: r.customerName, code: r.customerCode } : null,
          forwarder: r.forwarderId ? { id: r.forwarderId, name: r.forwarderName } : null,
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
