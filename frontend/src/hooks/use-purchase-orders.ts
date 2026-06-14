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

interface PosRow {
  id: string
  poNumber: string
  customerName: string | null
  vendorName: string | null
  totalQuantity: number | null
  quantityUnit: string | null
}

/** Maps the PO master (/api/pos) into the Purchase Orders page shape. */
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
      }))
      return { purchaseOrders }
    },
  })
}
