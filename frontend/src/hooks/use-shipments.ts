import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface LinkedPO {
  id: string
  poNumber: string
  quantity: number | null
  totalQuantity: number | null
  quantityUnit: string | null
  vendor?: { name: string } | null
}

export interface Shipment {
  id: string
  bookingId: string
  jobNo: string | null
  bookingNo: string | null
  soNumber: string | null
  hblNumber: string | null
  containerNo: string | null
  mblNumber: string | null
  mode: string | null
  status: string
  riskLevel: string
  reviewStatus: string
  confidence: number | null
  route: string | null
  etd: string | null
  eta: string | null
  updatedAt: string
  customer?: { id: string; name: string; code: string } | null
  forwarder?: { id: string; name: string } | null
  linkedPOs: LinkedPO[]
}

interface ShipmentsResponse {
  shipments: Shipment[]
}

export function useShipments(filters?: { status?: string }) {
  const params = new URLSearchParams()
  if (filters?.status && filters.status !== 'ALL') params.set('status', filters.status)
  const query = params.toString()
  return useQuery<ShipmentsResponse>({
    queryKey: ['shipments', filters],
    queryFn: () => api.get(`/shipments${query ? `?${query}` : ''}`),
  })
}

export function useShipment(id: string | undefined) {
  return useQuery({
    queryKey: ['shipment', id],
    queryFn: () => api.get(`/shipments/${id}`),
    enabled: !!id,
  })
}
