import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface Shipment {
  id: string
  poNumbers: string
  customerId: string | null
  forwarderId: string | null
  route: string | null
  status: string
  riskLevel: string
  crd: string | null
  cfsCutoff: string | null
  etd: string | null
  eta: string | null
  actualDeparture: string | null
  actualArrival: string | null
  hblNumber: string | null
  vesselName: string | null
  voyageNumber: string | null
  warehouseAddress: string | null
  createdAt: string
  updatedAt: string
  customer?: { id: string; name: string; code: string } | null
  forwarder?: { id: string; name: string } | null
}

export interface ShipmentDetail extends Shipment {
  milestones: Array<{
    id: string
    milestoneType: string
    occurredAt: string
    notes: string | null
  }>
  emails: Array<{
    id: string
    subject: string
    sender: string
    receivedAt: string
    emailType: string | null
  }>
  alerts: Array<{
    id: string
    ruleId: string
    severity: string
    message: string
    status: string
    triggeredAt: string
  }>
}

interface ShipmentsResponse {
  shipments: Shipment[]
}

export function useShipments(filters?: {
  status?: string
  customerId?: string
  forwarderId?: string
}) {
  const params = new URLSearchParams()
  if (filters?.status && filters.status !== 'ALL') params.set('status', filters.status)
  if (filters?.customerId) params.set('customerId', filters.customerId)
  if (filters?.forwarderId) params.set('forwarderId', filters.forwarderId)
  const query = params.toString()

  return useQuery<ShipmentsResponse>({
    queryKey: ['shipments', filters],
    queryFn: () => api.get(`/shipments${query ? `?${query}` : ''}`),
  })
}

export function useShipment(id: string) {
  return useQuery<ShipmentDetail>({
    queryKey: ['shipment', id],
    queryFn: () => api.get(`/shipments/${id}`),
    enabled: !!id,
  })
}
