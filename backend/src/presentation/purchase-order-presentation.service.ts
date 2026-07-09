/**
 * Purchase-order UI presentation (app-owned POs): the PO list + detail, each with its linked-shipment
 * summary rows (container/SCAC/booking#/vessel + lifecycle-weighted progress). Read-only.
 */
import { Injectable, NotFoundException } from '@nestjs/common'
import { PurchaseOrderRepository } from '../db/repositories/purchase-order.repository'
import { toUiPurchaseOrder, toUiPurchaseOrderDetail } from './mappers/po.mapper'
import { type ShipmentMapperInput, type ShipmentLegRow } from './mappers/shipment.mapper'
import { deriveRoute, portLabel } from './adapters/derive'
import { stateToUiStatus } from './adapters/enums'

@Injectable()
export class PurchaseOrderPresentationService {
  constructor(private readonly poRepo: PurchaseOrderRepository) {}

  // PO → one linked-shipment row, in the shape the PO list/detail search over (container/SCAC/booking#/vessel).
  // linkedQuantity + cancelled-aware status feed the UI's lifecycle-weighted PO progress.
  private toPoShipmentRow(s: {
    shipmentId: string
    bookingNo: string | null
    status: string | null
    legStatus?: string | null
    reviewStatus?: string | null
    linkedQuantity?: number | null
    containerNo: string | null
    hbl: string | null
    mbl: string | null
    scacCode: string | null
    vesselName: string | null
    mode?: string | null
    polCode: string | null
    podCode: string | null
    polIata?: string | null
    podIata?: string | null
  }) {
    return {
      id: s.shipmentId,
      bookingNo: s.bookingNo ?? null,
      route: deriveRoute(portLabel(s.mode, s.polCode, s.polIata), portLabel(s.mode, s.podCode, s.podIata)),
      containerNo: s.containerNo ?? null,
      hblNumber: s.hbl ?? null,
      mblNumber: s.mbl ?? null,
      scacCode: s.scacCode ?? null,
      vesselName: s.vesselName ?? null,
      status: stateToUiStatus(s.status, s.legStatus),
      reviewStatus: s.reviewStatus ?? null,
      linkedQuantity: s.linkedQuantity ?? null,
    }
  }

  async purchaseOrders(filter?: { customerId?: string; open?: boolean }) {
    const [rows, summaryRows] = await Promise.all([
      this.poRepo.listPos(filter?.open ?? false),
      this.poRepo.shipmentSummariesByPo(),
    ])
    const summariesByPo = new Map<string, unknown[]>()
    for (const s of summaryRows) {
      const arr = summariesByPo.get(s.poId) ?? []
      arr.push(this.toPoShipmentRow(s))
      summariesByPo.set(s.poId, arr)
    }
    const out = rows
      .filter((r) => !filter?.customerId || r.customerId === filter.customerId)
      .map((r) =>
        toUiPurchaseOrder({
          po: {
            id: r.id, poNumber: r.poNumber, customerId: r.customerId ?? null, vendorId: r.vendorId ?? null,
            totalQuantity: r.totalQuantity ?? null, quantityUnit: r.quantityUnit ?? null, notes: r.notes ?? null,
            createdAt: r.createdAt, updatedAt: r.updatedAt,
          },
          customer: r.customerName || r.customerCode ? { id: r.customerId ?? '', name: r.customerName ?? '', code: r.customerCode ?? null } : null,
          vendor: r.vendorName || r.vendorCode ? { id: r.vendorId ?? '', name: r.vendorName ?? '', code: r.vendorCode ?? null } : null,
          shipmentCount: r.shipmentCount,
          shippedQuantity: r.shippedQuantity,
          shippedUnit: r.shippedUnit,
          status: r.status,
          shipmentSummary: summariesByPo.get(r.id) ?? [],
        }),
      )
    return { purchaseOrders: out }
  }

  async purchaseOrder(id: string) {
    const detail = await this.poRepo.poDetail(id)
    if (!detail) throw new NotFoundException('purchase order not found')
    const { po, links } = detail
    return toUiPurchaseOrderDetail({
      po: {
        id: po.id, poNumber: po.poNumber, customerId: po.customerId ?? null, vendorId: po.vendorId ?? null,
        totalQuantity: po.totalQuantity ?? null, quantityUnit: po.quantityUnit ?? null, notes: po.notes ?? null,
        createdAt: po.createdAt, updatedAt: po.updatedAt,
      },
      customer: po.customerName || po.customerCode ? { id: po.customerId ?? '', name: po.customerName ?? '', code: po.customerCode ?? null } : null,
      vendor: po.vendorName || po.vendorCode ? { id: po.vendorId ?? '', name: po.vendorName ?? '', code: po.vendorCode ?? null } : null,
      shipmentCount: links.length,
      // null (unknown) when no linked shipment carries a quantity — a false "0 shipped" is misleading.
      // Cancelled legs don't count toward the quantity on shipments.
      shippedQuantity: links.some((l) => l.legStatus !== 'CANCELLED' && l.linkedQuantity != null)
        ? links.reduce((s, l) => (l.legStatus !== 'CANCELLED' ? s + (l.linkedQuantity ?? 0) : s), 0)
        : null,
      shipmentSummary: links.map((l) =>
        this.toPoShipmentRow({
          shipmentId: l.shipmentId, bookingNo: l.bookingNo, status: l.status, legStatus: l.legStatus,
          reviewStatus: l.reviewStatus, linkedQuantity: l.linkedQuantity, containerNo: l.containerNo,
          hbl: l.hbl, mbl: l.mbl, scacCode: l.scacCode, vesselName: l.vesselName,
          mode: l.mode, polCode: l.polCode, podCode: l.podCode, polIata: l.polIata, podIata: l.podIata,
        }),
      ),
      linkedShipments: links.map((l) => ({
        shipment: {
          leg: {
            id: l.shipmentId, state: l.status, legStatus: l.legStatus, reviewStatus: l.reviewStatus,
            bookingNo: l.bookingNo, soNo: l.so, hblAwbFcrNo: l.hbl, mode: l.mode,
            etd: l.etd, eta: l.eta, containerNo: l.containerNo, mbl: l.mbl, scacCode: l.scacCode, vesselName: l.vesselName,
          } as unknown as ShipmentLegRow,
          booking: null,
          polPort: l.polCode ? { unlocode: l.polCode, iata: l.polIata } : null,
          podPort: l.podCode ? { unlocode: l.podCode, iata: l.podIata } : null,
          poNumbers: [po.poNumber],
        } as ShipmentMapperInput,
        linkedQuantity: l.linkedQuantity,
        linkId: l.linkId,
        linkedAt: l.linkedAt,
      })),
    })
  }
}
