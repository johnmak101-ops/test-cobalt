/**
 * Flatten one ACTIVE shipment leg (+ its parent booking + resolved masters + linked POs)
 * into the flat `Shipment` shape the new UI consumes. Pure — the controller loads & assembles
 * the input; this only reshapes. The production PO→Booking→Shipment model is never exposed.
 */
import type { Band, CriticReview } from '../../decisions/critic-review.types'
import { stateToUiStatus } from '../adapters/enums'
import { deriveRoute, portLabel, deriveOriginCountry, poNumbersJson, isoOrNull } from '../adapters/derive'

export interface MasterRef {
  id: string
  name: string
  code?: string | null
}

type Dateish = Date | string | null | undefined

/** design §2.2 short AI-comment types for queue chips — not free-form riskFlag.message. */
const RISK_SHORT_LABELS: Record<string, string> = {
  INTRA_EMAIL_MULTI_STRONG_ID: 'Two strong IDs in one email',
  BACKEND_CONFLICT: 'Stored value disagrees',
  PO_REASSIGN: 'PO may belong to another shipment',
  PORTAL_ECHO: 'Portal notification only',
  AMBIGUOUS_MATCH: 'Multiple matching legs',
  FIELD_LOCK_CLASH: 'Would overwrite locked field',
}

export function shortLabelForRisk(code: string): string {
  return RISK_SHORT_LABELS[code] ?? 'Needs review'
}

/** Queue-safe projection — band/summary/topConflictType only (never raw confidence score). */
export function compactCriticReview(cr: CriticReview | null | undefined): {
  band: Band
  summary: string
  topConflictType: string
} | null {
  if (!cr?.confidence?.band) return null
  const top = cr.riskFlags?.[0]
  const topConflictType = top
    ? shortLabelForRisk(top.code)
    : cr.conflicts?.[0]?.label
      ? `${cr.conflicts[0].label} conflict`
      : 'Needs review'
  return { band: cr.confidence.band, summary: cr.summary, topConflictType }
}

export interface ShipmentLegRow {
  id: string
  forwarderId: string | null
  state: string | null
  legStatus?: string | null
  mode?: string | null
  riskLevel: string | null
  bookingNo: string | null
  soNo: string | null
  itemStyleNo: string | null
  consigneeName: string | null
  consigneeAddress: string | null
  containerNo: string | null
  mbl: string | null
  hblAwbFcrNo: string | null
  vesselName: string | null
  voyageNo: string | null
  scacCode: string | null
  originCountry: string | null
  polRaw: string | null
  podRaw: string | null
  forwarderRaw: string | null
  customerRaw: string | null
  vendorRaw: string | null
  grossWeight: number | null
  measurement: number | null
  htsCode: string | null
  cargoReadyDate: Dateish
  cfsCutoff: Dateish
  etd: Dateish
  eta: Dateish
  atd: Dateish
  ata: Dateish
  warehouseStartDate: Dateish
  warehouseEndDate: Dateish
  inDcDate: Dateish
  qty: number | null
  qtyUnit: string | null
  reviewStatus?: string | null
  reviewReasons?: string[] | null
  dismissedAt?: Dateish
  criticReview?: CriticReview | null
  createdAt: Dateish
  updatedAt: Dateish
}

export interface ShipmentMapperInput {
  leg: ShipmentLegRow
  booking: { customerId: string | null; vendorId: string | null } | null
  customer?: MasterRef | null
  vendor?: MasterRef | null
  forwarder?: MasterRef | null
  polPort?: { unlocode?: string | null; country?: string | null; iata?: string | null } | null
  podPort?: { unlocode?: string | null; country?: string | null; iata?: string | null } | null
  poNumbers?: Array<string | null | undefined>
  linkedPOs?: unknown[]
}

export interface UiShipment {
  id: string
  poNumbers: string
  customerId: string | null
  vendorId: string | null
  forwarderId: string | null
  mode: string | null
  route: string | null
  originCountry: string | null
  status: string
  cancelled: boolean
  riskLevel: string | null
  reviewStatus: string | null
  reviewReasons: string[]
  dismissedAt: string | null
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
  criticReview: CriticReview | null
  createdAt: string | null
  updatedAt: string | null
  customer: MasterRef | null
  vendor: MasterRef | null
  forwarder: MasterRef | null
  linkedPOs: unknown[]
}

export function toUiShipment(input: ShipmentMapperInput): UiShipment {
  const { leg, booking } = input
  return {
    id: leg.id,
    poNumbers: poNumbersJson(input.poNumbers ?? []),
    customerId: booking?.customerId ?? null,
    vendorId: booking?.vendorId ?? null,
    forwarderId: leg.forwarderId ?? null,
    mode: leg.mode ?? null,
    route: deriveRoute(
      portLabel(leg.mode, input.polPort?.unlocode, input.polPort?.iata) ?? leg.polRaw,
      portLabel(leg.mode, input.podPort?.unlocode, input.podPort?.iata) ?? leg.podRaw,
    ),
    originCountry: leg.originCountry ?? deriveOriginCountry(input.polPort),
    status: stateToUiStatus(leg.state, leg.legStatus),
    cancelled: leg.legStatus === 'CANCELLED',
    riskLevel: leg.riskLevel ?? null,
    reviewStatus: leg.reviewStatus ?? null,
    reviewReasons: leg.reviewReasons ?? [],
    dismissedAt: isoOrNull(leg.dismissedAt ?? null),
    bookingNo: leg.bookingNo ?? null,
    soNumber: leg.soNo ?? null,
    itemStyleNo: leg.itemStyleNo ?? null,
    consigneeName: leg.consigneeName ?? null,
    consigneeAddress: leg.consigneeAddress ?? null,
    containerNo: leg.containerNo ?? null,
    mblNumber: leg.mbl ?? null,
    scacCode: leg.scacCode ?? null,
    crd: isoOrNull(leg.cargoReadyDate),
    // The parser vocabulary equates "CFS cut-off/截仓时间" with warehouse_end_date (soul field 12) and
    // never emits a separate cfs_cutoff — so the column only fills from a human edit. Fall back to the
    // warehouse end date for display; an explicit cfs_cutoff (human-entered) still wins.
    cfsCutoff: isoOrNull(leg.cfsCutoff) ?? isoOrNull(leg.warehouseEndDate),
    etd: isoOrNull(leg.etd),
    eta: isoOrNull(leg.eta),
    actualDeparture: isoOrNull(leg.atd),
    actualArrival: isoOrNull(leg.ata),
    warehouseStartDate: isoOrNull(leg.warehouseStartDate),
    warehouseEndDate: isoOrNull(leg.warehouseEndDate),
    inDcDate: isoOrNull(leg.inDcDate),
    hblNumber: leg.hblAwbFcrNo ?? null,
    vesselName: leg.vesselName ?? null,
    voyageNumber: leg.voyageNo ?? null,
    warehouseAddress: null, // Phase 3 column
    quantityShipped: leg.qty ?? null,
    quantityUnit: leg.qtyUnit ?? null,
    grossWeight: leg.grossWeight ?? null,
    measurement: leg.measurement ?? null,
    htsCode: leg.htsCode ?? null,
    criticReview: leg.criticReview ?? null,
    createdAt: isoOrNull(leg.createdAt),
    updatedAt: isoOrNull(leg.updatedAt),
    customer: input.customer ?? (leg.customerRaw ? { id: '', name: leg.customerRaw, code: leg.customerRaw } : null),
    vendor: input.vendor ?? (leg.vendorRaw ? { id: '', name: leg.vendorRaw, code: leg.vendorRaw } : null),
    forwarder: input.forwarder ?? (leg.forwarderRaw ? { id: '', name: leg.forwarderRaw } : null),
    linkedPOs: input.linkedPOs ?? [],
  }
}
