import { Injectable } from '@nestjs/common'
import { BookingRepository } from '../db/repositories/booking.repository'

/** PO master read for the Matcher + the Purchase Orders UI. */
@Injectable()
export class PosService {
  constructor(private readonly bookings: BookingRepository) {}

  /** open=true drops POs whose linked bookings are all terminal (CLOSED/CANCELLED). */
  list(open = false) {
    return this.bookings.listPos(open)
  }

  /** A single PO + the shipments it rides on (for the PO detail page). */
  async detail(id: string) {
    const res = await this.bookings.poDetail(id)
    if (!res) return null
    const { po, links } = res
    return {
      id: po.id,
      poNumber: po.poNumber,
      brand: po.brand,
      itemStyleNo: po.itemStyleNo,
      totalQuantity: po.totalQuantity,
      quantityUnit: po.quantityUnit,
      crd: po.crd,
      customer: po.customerName ? { name: po.customerName } : null,
      vendor: po.vendorName ? { name: po.vendorName } : null,
      shippedQuantity: links.reduce((n, l) => n + (l.linkedQuantity ?? 0), 0),
      linkedShipments: links.map((l) => ({
        id: l.shipmentId,
        linkId: l.linkId,
        poNumbers: l.bookingNo ?? l.hbl ?? l.so ?? l.shipmentId.slice(0, 8),
        status: l.status,
        route: l.polCode && l.podCode ? `${l.polCode}→${l.podCode}` : (l.polCode ?? l.podCode ?? null),
        etd: l.etd,
        eta: l.eta,
        linkedQuantity: l.linkedQuantity,
      })),
    }
  }
}
