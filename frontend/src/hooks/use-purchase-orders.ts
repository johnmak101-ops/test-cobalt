import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface PurchaseOrder {
  id: string
  poNumber: string
  customerId: string | null
  vendorId: string | null
  totalQuantity: number | null
  quantityUnit: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
  customer?: { id: string; name: string; code: string } | null
  vendor?: { id: string; name: string } | null
  shipmentCount?: number
  shippedQuantity?: number
  shippedUnit?: string | null
  status?: string | null
  shipmentSummary?: Array<{
    id: string
    bookingNo: string | null
    route: string | null
    containerNo: string | null
    hblNumber: string | null
    mblNumber: string | null
    scacCode: string | null
    vesselName: string | null
    status: string
    /** 'provisional' when the leg awaits human review — the list surfaces a warning */
    reviewStatus?: string | null
    /** per-shipment split from shipment_pos — feeds lifecycle-weighted progress (absent on older backends) */
    linkedQuantity?: number | null
  }>
}

export interface PurchaseOrderDetail extends PurchaseOrder {
  linkedShipments: Array<{
    id: string
    poNumbers: string
    status: string
    reviewStatus?: string | null
    route: string | null
    etd: string | null
    eta: string | null
    linkId: string
    linkedQuantity: number | null
    linkedAt: string
  }>
}

interface PurchaseOrdersResponse {
  purchaseOrders: PurchaseOrder[]
}

export function usePurchaseOrders(filters?: { customerId?: string }) {
  const params = new URLSearchParams()
  if (filters?.customerId) params.set('customerId', filters.customerId)
  const query = params.toString()

  return useQuery<PurchaseOrdersResponse>({
    queryKey: ['purchase-orders', filters],
    queryFn: () => api.get(`/purchase-orders${query ? `?${query}` : ''}`),
  })
}

export function usePurchaseOrder(id: string) {
  return useQuery<PurchaseOrderDetail>({
    queryKey: ['purchase-order', id],
    queryFn: () => api.get(`/purchase-orders/${id}`),
    enabled: !!id,
  })
}

export function useCreatePurchaseOrder() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: {
      poNumber: string
      customerId?: string
      vendorId?: string
      totalQuantity?: number
      quantityUnit?: string
      notes?: string
    }) => api.post('/purchase-orders', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] })
    },
  })
}

export function useUpdatePurchaseOrder() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & Record<string, unknown>) =>
      api.patch(`/purchase-orders/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] })
      queryClient.invalidateQueries({ queryKey: ['purchase-order'] })
    },
  })
}

export function useDeletePurchaseOrder() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => api.delete(`/purchase-orders/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] })
    },
  })
}

export function useLinkShipmentToPO() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      poId,
      shipmentId,
      quantity,
    }: {
      poId: string
      shipmentId: string
      quantity?: number
    }) => api.post(`/purchase-orders/${poId}/link-shipment`, { shipmentId, quantity }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] })
      queryClient.invalidateQueries({ queryKey: ['purchase-order'] })
      queryClient.invalidateQueries({ queryKey: ['shipments'] })
    },
  })
}

export function useUnlinkShipmentFromPO() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ poId, linkId }: { poId: string; linkId: string }) =>
      api.delete(`/purchase-orders/${poId}/link-shipment/${linkId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] })
      queryClient.invalidateQueries({ queryKey: ['purchase-order'] })
      queryClient.invalidateQueries({ queryKey: ['shipments'] })
    },
  })
}
