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

  /** A single leg with its milestones + PO split. */
  async getOne(id: string) {
    const ship = await this.shipments.findById(id)
    if (!ship) throw new NotFoundException(`shipment ${id} not found`)
    const milestones = await this.shipments.milestonesFor(id)
    const pos = await this.shipments.posFor(id)
    return { ...ship, milestones, pos }
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
