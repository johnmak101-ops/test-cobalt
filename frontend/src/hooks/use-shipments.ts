import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface LinkedPO {
  id: string
  poNumber: string
  quantity: number | null
  totalQuantity: number | null
  quantityUnit: string | null
  // Set when the shipped Qty is inconsistent with the ERP order (exceeds the total, or a different unit).
  qtyIssue?: 'exceeds_total' | 'unit_mismatch' | null
  qtyIssueDetail?: string | null
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
  mode: string | null
  route: string | null
  originCountry: string | null
  status: string
  riskLevel: string
  reviewStatus?: string | null
  reviewReasons?: string[]
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

/** One contested identity field: ≥2 co-current values across emails, with the doc/email that stated each. */
export interface FieldConflict {
  column: string
  label: string
  values: Array<{ value: string; docType: string | null; sourceEmailId: string | null }>
}

export interface ShipmentDetail extends Shipment {
  fieldConflicts?: FieldConflict[]
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

/** A human-entered new shipment (the pipeline never saw the booking). All fields optional; at least one
 *  identity (booking/SO/HBL/MBL/container) OR a PO is required. Camel-cased keys match the backend DTO. */
export interface CreateShipmentInput {
  bookingNo?: string; soNo?: string; hblAwbFcrNo?: string; mbl?: string; containerNo?: string
  customerCode?: string; forwarderName?: string; pol?: string; pod?: string; mode?: string
  qty?: string; qtyUnit?: string; grossWeight?: string; measurement?: string
  itemStyleNo?: string; consigneeName?: string; cargoReadyDate?: string; etd?: string
  pos?: string[]; note?: string
}

/** Create a manual shipment (POST /api/shipments). It is minted through the committer, so a later agent
 *  email upserts into it (no duplicate) and the human's fields are locked. Lands in the Review queue. */
export function useCreateShipment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateShipmentInput) =>
      api.post<{ id: string; jobNo: string; state: string }>('/shipments', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shipments'] })
      qc.invalidateQueries({ queryKey: ['review-queue'] })
    },
  })
}

/** Human edit of shipment fields (detail page). Body is a { dbField: value } map; the backend locks +
 *  audits each change so the parser can never overwrite it. Refetches the detail + history on success. */
export function useUpdateShipment(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ fields, note }: { fields: Record<string, unknown>; note: string }) =>
      api.patch(`/shipments/${id}`, { fields, note }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shipment', id] })
      qc.invalidateQueries({ queryKey: ['shipment-history', id] })
      qc.invalidateQueries({ queryKey: ['shipments'] })
    },
  })
}
