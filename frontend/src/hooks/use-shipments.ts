import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { CriticReview } from '../lib/critic-review'

export interface LinkedPO {
  id: string
  /** shipment_pos.id — present for shipment-linked POs; used to unlink from this shipment. */
  linkId?: string | null
  poNumber: string
  quantity: number | null
  totalQuantity: number | null
  quantityUnit: string | null
  /** Style/article from enrichment when the parser captured it on this PO. */
  itemStyleNo?: string | null
  brand?: string | null
  // Set when the shipped Qty is inconsistent with the ERP order (exceeds the total, or a different unit).
  qtyIssue?: 'exceeds_total' | 'unit_mismatch' | null
  qtyIssueDetail?: string | null
  notes?: string | null
  vendor?: { id: string; name: string; code: string } | null
  customer?: { id: string; name: string; code: string } | null
  /** Booking-level total wrongly repeated on every PO — UI shows one banner, not per-row totals. */
  sharedBroadcastTotal?: number | null
  sharedBroadcastUnit?: string | null
}

export interface Shipment {
  id: string
  poNumbers: string
  customerId: string | null
  vendorId: string | null
  forwarderId: string | null
  mode: string | null
  route: string | null
  /** Free-text ports / forwarder for detail edit (#183); route may still prefer master codes. */
  polRaw?: string | null
  podRaw?: string | null
  forwarderRaw?: string | null
  /** Free-text customer / vendor stand-in when no Mesh master resolves — editable until Mesh syncs. */
  customerRaw?: string | null
  vendorRaw?: string | null
  originCountry: string | null
  status: string
  riskLevel: string
  reviewStatus?: string | null
  reviewReasons?: string[]
  dismissedAt?: string | null
  /** #151: leg ordinal under booking when legCount > 1 */
  legNo?: number
  legCount?: number
  bookingNo: string | null
  soNumber: string | null
  /** 入仓/订仓 SO — distinct from soNumber; optional until older responses catch up. */
  warehouseSo?: string | null
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
  /** Air flight number (e.g. CA1398). Sea legs use vessel/voyage instead. */
  flightNo?: string | null
  /** Air master AWB (e.g. 999-94230150). Sea uses mblNumber. */
  mawb?: string | null
  warehouseAddress: string | null
  quantityShipped: number | null
  quantityUnit: string | null
  grossWeight: number | null
  measurement: number | null
  htsCode: string | null
  /** Full agent critic payload on detail (queue uses criticReviewCompact only). */
  criticReview?: CriticReview | null
  /** Beginning email received-at (#350) — anchors the Shipment ID month; null/absent → use createdAt. */
  firstEmailAt?: string | null
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
    /** Null when shipment_emails is orphaned (email_message wiped). */
    id: string | null
    subject: string
    sender: string | null
    receivedAt: string | null
    emailType: string | null
    /** True when body/store row is missing — open disabled. */
    bodyMissing?: boolean
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
  /** Fields where a newer email overrode a human edit (the leg column now differs from the locked
   *  value). Surfaced as a prompt to keep the new value or restore the edit. */
  contestedLocks?: Array<{ field: string; yourValue: string | null; newValue: string | null }>
  /** Raw party twin names a different company than the resolved master ("flag, don't follow") —
   *  the master keeps display; the detail row shows an amber marker with this context. */
  customerMismatch?: { raw: string; masterCode: string; masterName: string } | null
  vendorMismatch?: { raw: string; masterCode: string; masterName: string } | null
  /** Human-locked leg columns (manual/review edits) — settled answers, never masked as unconfirmed. */
  humanLockedFields?: string[]
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

/** Resolve a contested field (a newer email overrode a human edit): 'keep-new' accepts the email value,
 *  'restore' puts the human edit back. Refetches the detail + history + list on success. */
export function useResolveContestedLock(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ field, action }: { field: string; action: 'keep-new' | 'restore' }) =>
      api.post(`/shipments/${id}/locks/${encodeURIComponent(field)}/${action}`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shipment', id] })
      qc.invalidateQueries({ queryKey: ['shipment-history', id] })
      qc.invalidateQueries({ queryKey: ['shipments'] })
    },
  })
}
