import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface LinkedPO {
  id: string
  poNumber: string
  quantity: number | null
  totalQuantity: number | null
  quantityUnit: string | null
  notes?: string | null
  vendor?: { id: string; name: string; code: string } | null
  customer?: { id: string; name: string; code: string } | null
}

export interface Shipment {
  id: string
  poNumbers: string
  customerId: string | null
  vendorId: string | null
  forwarderId: string | null
  route: string | null
  originCountry: string | null
  status: string
  riskLevel: string
  bookingNo: string | null
  soNumber: string | null
  itemStyleNo: string | null
  consigneeName: string | null
  consigneeAddress: string | null
  containerNo: string | null
  mblNumber: string | null
  scacCode: string | null
  crd: string | null
  cfsCutoff: string | null
  etd: string | null
  eta: string | null
  actualDeparture: string | null
  actualArrival: string | null
  warehouseStartDate: string | null
  warehouseEndDate: string | null
  inDcDate: string | null
  hblNumber: string | null
  vesselName: string | null
  voyageNumber: string | null
  warehouseAddress: string | null
  quantityShipped: number | null
  quantityUnit: string | null
  grossWeight: number | null
  measurement: number | null
  htsCode: string | null
  createdAt: string
  updatedAt: string
  customer?: { id: string; name: string; code: string } | null
  forwarder?: { id: string; name: string } | null
  vendor?: { id: string; name: string; code: string } | null
  linkedPOs: LinkedPO[]
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
  linkedPOs: LinkedPO[]
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
