/**
 * Purchase Order (app-owned; the ERP/Mesh has no POs) + its fulfilment aggregates -> UI shape.
 * Detail reuses the shipment mapper so linked shipments carry the full flat field set (CSV export).
 */
import { isoOrNull } from '../adapters/derive'
import { toUiShipment, type MasterRef, type ShipmentMapperInput, type UiShipment } from './shipment.mapper'

type Dateish = Date | string | null | undefined

export interface PoRow {
  id: string
  poNumber: string
  customerId: string | null
  vendorId: string | null
  totalQuantity: number | null
  quantityUnit: string | null
  notes?: string | null
  createdAt: Dateish
  updatedAt: Dateish
}

export interface PoMapperInput {
  po: PoRow
  customer?: MasterRef | null
  vendor?: MasterRef | null
  shipmentCount?: number
  shippedQuantity?: number | null
  shipmentSummary?: unknown[]
}

export interface PoDetailInput extends PoMapperInput {
  linkedShipments?: Array<{ shipment: ShipmentMapperInput; linkedQuantity?: number | null }>
}

export interface UiPurchaseOrder {
  id: string
  poNumber: string
  customerId: string | null
  vendorId: string | null
  totalQuantity: number | null
  quantityUnit: string | null
  notes: string | null
  createdAt: string | null
  updatedAt: string | null
  customer: MasterRef | null
  vendor: MasterRef | null
  shipmentCount: number
  shippedQuantity: number | null
  shipmentSummary: unknown[]
}

export interface UiLinkedShipment extends UiShipment {
  linkedQuantity: number | null
}

export interface UiPurchaseOrderDetail extends UiPurchaseOrder {
  linkedShipments: UiLinkedShipment[]
}

export function toUiPurchaseOrder(input: PoMapperInput): UiPurchaseOrder {
  const { po } = input
  return {
    id: po.id,
    poNumber: po.poNumber,
    customerId: po.customerId ?? null,
    vendorId: po.vendorId ?? null,
    totalQuantity: po.totalQuantity ?? null,
    quantityUnit: po.quantityUnit ?? null,
    notes: po.notes ?? null,
    createdAt: isoOrNull(po.createdAt),
    updatedAt: isoOrNull(po.updatedAt),
    customer: input.customer ?? null,
    vendor: input.vendor ?? null,
    shipmentCount: input.shipmentCount ?? 0,
    shippedQuantity: input.shippedQuantity ?? null,
    shipmentSummary: input.shipmentSummary ?? [],
  }
}

export function toUiPurchaseOrderDetail(input: PoDetailInput): UiPurchaseOrderDetail {
  return {
    ...toUiPurchaseOrder(input),
    linkedShipments: (input.linkedShipments ?? []).map((ls) => ({
      ...toUiShipment(ls.shipment),
      linkedQuantity: ls.linkedQuantity ?? null,
    })),
  }
}
