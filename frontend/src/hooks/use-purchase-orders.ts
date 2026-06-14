import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface PurchaseOrder {
  id: string
  poNumber: string
  customer?: { name: string } | null
  vendor?: { name: string } | null
  totalQuantity: number | null
  quantityUnit: string | null
  shippedQuantity?: number
  shipmentCount?: number
}

export interface LinkedShipment {
  id: string
  linkId: string
  poNumbers: string | null
  status: string
  route: string | null
  etd: string | null
  eta: string | null
  linkedQuantity: number | null
}

export interface PurchaseOrderDetail extends PurchaseOrder {
  brand: string | null
  itemStyleNo: string | null
  crd: string | null
  shippedQuantity: number
  linkedShipments: LinkedShipment[]
}

interface PosRow {
  id: string
  poNumber: string
  customerName: string | null
  vendorName: string | null
  totalQuantity: number | null
  quantityUnit: string | null
  shippedQuantity?: number
  shipmentCount?: number
}

export function usePurchaseOrders() {
  return useQuery({
    queryKey: ['purchase-orders'],
    queryFn: async () => {
      const rows = await api.get<PosRow[]>('/pos')
      const purchaseOrders: PurchaseOrder[] = rows.map((p) => ({
        id: p.id,
        poNumber: p.poNumber,
        customer: p.customerName ? { name: p.customerName } : null,
        vendor: p.vendorName ? { name: p.vendorName } : null,
        totalQuantity: p.totalQuantity,
        quantityUnit: p.quantityUnit,
        shippedQuantity: p.shippedQuantity,
        shipmentCount: p.shipmentCount,
      }))
      return { purchaseOrders }
    },
  })
}

export function usePurchaseOrder(id: string | undefined) {
  return useQuery<PurchaseOrderDetail>({
    queryKey: ['purchase-order', id],
    queryFn: () => api.get(`/pos/${id}`),
    enabled: !!id,
  })
}
