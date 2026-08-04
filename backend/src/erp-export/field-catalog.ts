/**
 * ERP export field catalog — the "menu" of everything `GET /api/erp-export/pos` can emit.
 *
 * The ERP (Mesh) is PO-based, so the output grain is: one object per PO, with the shipment legs
 * that carry it nested under `shipments`. The catalog therefore has two tiers:
 *   - `level: 'po'`       → extracted once per PO group (keys prefixed `po_` to avoid colliding
 *                            with same-named shipment columns, e.g. item_style_no exists on both)
 *   - `level: 'shipment'` → extracted per nested leg
 *
 * Keys are snake_case (ERP-facing, matching the physical column naming). Identity fields are
 * marked `always` and cannot be deselected — without them the consumer cannot key the rows.
 *
 * Pipeline-internal data (critic review, review reasons, committer trail, match keys, confidence)
 * is deliberately NOT in this catalog: it must never leave the system through this seam.
 *
 * Dates pass through `isoOrNull` verbatim — raw column values only, none of the UI's display
 * fallbacks (e.g. the tracker shows warehouse_end_date when cfs_cutoff is empty; the export does
 * not, so the ERP always receives what is actually stored).
 */
import { stateToUiStatus } from '../presentation/adapters/enums'
import { deriveRoute, journeyRoute, portLabel, isoOrNull } from '../presentation/adapters/derive'

type Dateish = Date | string | null | undefined

/** PO-tier context: the PO master row (+ resolved customer/vendor codes) shared by one PO group. */
export interface ExportPoCtx {
  poNumber: string
  brand: string | null
  itemStyleNo: string | null
  totalQuantity: number | null
  quantityUnit: string | null
  crd: Dateish
  customerCode: string | null
  customerName: string | null
  vendorCode: string | null
  vendorName: string | null
}

/** Master ref as the export needs it (code is what the ERP keys on; name is for humans/bots). */
export interface ExportMasterRef {
  code: string | null
  name: string | null
}

export interface ExportPortRef {
  unlocode: string | null
  iata: string | null
  name: string | null
  country: string | null
}

/** The leg columns the shipment-tier extractors read (structural — assembled by the service). */
export interface ExportLegRow {
  id: string
  legNo: number | null
  state: string | null
  legStatus: string | null
  reviewStatus: string | null
  riskLevel: string | null
  mode: string | null
  journey?: unknown
  bookingNo: string | null
  soNo: string | null
  warehouseSo?: string | null
  hblAwbFcrNo: string | null
  mbl: string | null
  mawb?: string | null
  containerNo: string | null
  vesselName: string | null
  voyageNo: string | null
  flightNo?: string | null
  scacCode: string | null
  polRaw: string | null
  podRaw: string | null
  originCountry: string | null
  cargoReadyDate: Dateish
  cfsCutoff: Dateish
  warehouseStartDate: Dateish
  warehouseEndDate: Dateish
  etd: Dateish
  atd: Dateish
  eta: Dateish
  ata: Dateish
  inDcDate: Dateish
  qty: number | null
  qtyUnit: string | null
  cartons?: number | null
  grossWeight: number | null
  netWeight?: number | null
  measurement: number | null
  cargoDescription?: string | null
  htsCode: string | null
  itemStyleNo: string | null
  customerRaw?: string | null
  vendorRaw?: string | null
  forwarderRaw: string | null
  consigneeName: string | null
  consigneeAddress: string | null
  createdAt: Dateish
  updatedAt: Dateish
}

/** Shipment-tier context: one nested leg + everything resolved for it. */
export interface ExportShipmentCtx {
  leg: ExportLegRow
  jobNo: string | null
  customer: ExportMasterRef | null
  vendor: ExportMasterRef | null
  forwarder: ExportMasterRef | null
  polPort: ExportPortRef | null
  podPort: ExportPortRef | null
  carrierName: string | null
  /** This PO's link to this leg (shipment_pos), or the booking-level legacy fallback. */
  link: {
    quantity: number | null
    quantityUnit: string | null
    /** true/false from shipment_pos.inferred; null when the link is booking-level (no per-leg row). */
    inferred: boolean | null
    level: 'shipment' | 'booking'
  }
  milestones: { milestoneType: string; occurredAt: Dateish }[]
}

interface FieldBase {
  key: string
  group: string
  description: string
  /** Identity fields — always emitted, never deselectable. */
  always?: true
}
export interface PoField extends FieldBase {
  level: 'po'
  extract: (ctx: ExportPoCtx) => unknown
}
export interface ShipmentField extends FieldBase {
  level: 'shipment'
  extract: (ctx: ExportShipmentCtx) => unknown
}
export type ErpExportField = PoField | ShipmentField

const po = (
  key: string,
  group: string,
  description: string,
  extract: (ctx: ExportPoCtx) => unknown,
  always?: true,
): PoField => ({ key, level: 'po', group, description, extract, ...(always ? { always } : {}) })

const ship = (
  key: string,
  group: string,
  description: string,
  extract: (ctx: ExportShipmentCtx) => unknown,
  always?: true,
): ShipmentField => ({ key, level: 'shipment', group, description, extract, ...(always ? { always } : {}) })

export const ERP_EXPORT_FIELDS: ErpExportField[] = [
  // ---- PO tier ----
  po('po_number', 'identity', 'Purchase order number — the ERP key for this record', (c) => c.poNumber, true),
  po('po_brand', 'po', 'Brand on the PO master', (c) => c.brand ?? null),
  po('po_item_style_no', 'po', 'Item/style number on the PO master', (c) => c.itemStyleNo ?? null),
  po('po_total_quantity', 'po', 'Ordered quantity on the PO master (all shipments combined)', (c) => c.totalQuantity ?? null),
  po('po_quantity_unit', 'po', 'Unit of po_total_quantity', (c) => c.quantityUnit ?? null),
  po('po_crd', 'po', 'Cargo-ready date on the PO master (ISO)', (c) => isoOrNull(c.crd)),
  po('po_customer_code', 'po', 'Customer code from the PO master (Mesh code)', (c) => c.customerCode ?? null),
  po('po_customer_name', 'po', 'Customer name from the PO master', (c) => c.customerName ?? null),
  po('po_vendor_code', 'po', 'Vendor code from the PO master (Mesh code)', (c) => c.vendorCode ?? null),
  po('po_vendor_name', 'po', 'Vendor name from the PO master', (c) => c.vendorName ?? null),

  // ---- Shipment tier: identity ----
  ship('shipment_id', 'identity', 'Internal shipment leg id (stable UUID)', (c) => c.leg.id, true),
  ship('job_no', 'identity', 'Booking job number the leg belongs to', (c) => c.jobNo, true),
  ship('leg_no', 'identity', 'Leg ordinal within the booking (multi-leg journeys)', (c) => c.leg.legNo ?? 1, true),

  // ---- Shipment tier: status ----
  ship('state', 'status', 'Raw lifecycle state: BOOKED/CONFIRMED/AT_WAREHOUSE/SAILED/RELEASED/DELIVERED', (c) => c.leg.state ?? null),
  ship('status_label', 'status', 'Business status label (e.g. RELEASED→DEPARTED, SAILED=final B/L stage)', (c) =>
    stateToUiStatus(c.leg.state, c.leg.legStatus)),
  ship('review_status', 'status', 'Data trust: confirmed (reviewed/auto-accepted) or provisional (awaiting review)', (c) => c.leg.reviewStatus ?? null),
  ship('risk_level', 'status', 'ON_TRACK / AT_RISK / DELAYED', (c) => c.leg.riskLevel ?? null),
  ship('cancelled', 'status', 'true when the leg was cancelled', (c) => c.leg.legStatus === 'CANCELLED'),

  // ---- Shipment tier: references ----
  ship('booking_no', 'references', 'Forwarder booking number', (c) => c.leg.bookingNo ?? null),
  ship('so_no', 'references', 'Shipping order number', (c) => c.leg.soNo ?? null),
  ship('warehouse_so', 'references', 'Warehouse (入仓/订仓) SO number — distinct from so_no', (c) => c.leg.warehouseSo ?? null),
  ship('hbl_awb_fcr_no', 'references', 'House B/L, air waybill, or FCR number', (c) => c.leg.hblAwbFcrNo ?? null),
  ship('mbl', 'references', 'Master B/L number (sea)', (c) => c.leg.mbl ?? null),
  ship('mawb', 'references', 'Master air waybill (air)', (c) => c.leg.mawb ?? null),
  ship('container_no', 'references', 'Container number', (c) => c.leg.containerNo ?? null),

  // ---- Shipment tier: transport ----
  ship('mode', 'transport', 'SEA or AIR', (c) => c.leg.mode ?? null),
  ship('vessel_name', 'transport', 'Vessel name (sea)', (c) => c.leg.vesselName ?? null),
  ship('voyage_no', 'transport', 'Voyage number (sea)', (c) => c.leg.voyageNo ?? null),
  ship('flight_no', 'transport', 'Flight number (air)', (c) => c.leg.flightNo ?? null),
  ship('scac_code', 'transport', 'Carrier SCAC code', (c) => c.leg.scacCode ?? null),
  ship('carrier_name', 'transport', 'Carrier name resolved from the SCAC (carriers master)', (c) => c.carrierName ?? null),
  ship('route', 'transport', 'Route string, multi-stop when a journey chain is known (e.g. PVG→DEL→LHR)', (c) =>
    journeyRoute(c.leg.journey) ??
    deriveRoute(
      portLabel(c.leg.mode, c.polPort?.unlocode, c.polPort?.iata) ?? c.leg.polRaw,
      portLabel(c.leg.mode, c.podPort?.unlocode, c.podPort?.iata) ?? c.leg.podRaw,
    )),

  // ---- Shipment tier: ports ----
  ship('pol_code', 'ports', 'Port of loading — UN/LOCODE (sea) or IATA (air), resolved master; null when unresolved', (c) =>
    portLabel(c.leg.mode, c.polPort?.unlocode, c.polPort?.iata)),
  ship('pol_name', 'ports', 'Port of loading name (resolved master)', (c) => c.polPort?.name ?? null),
  ship('pol_raw', 'ports', 'Port of loading as stated in the source email (unresolved text)', (c) => c.leg.polRaw ?? null),
  ship('pod_code', 'ports', 'Port of discharge — UN/LOCODE (sea) or IATA (air), resolved master; null when unresolved', (c) =>
    portLabel(c.leg.mode, c.podPort?.unlocode, c.podPort?.iata)),
  ship('pod_name', 'ports', 'Port of discharge name (resolved master)', (c) => c.podPort?.name ?? null),
  ship('pod_raw', 'ports', 'Port of discharge as stated in the source email (unresolved text)', (c) => c.leg.podRaw ?? null),
  ship('origin_country', 'ports', 'Origin country', (c) => c.leg.originCountry ?? null),

  // ---- Shipment tier: dates (raw column values, ISO — no display fallbacks) ----
  ship('cargo_ready_date', 'dates', 'Cargo ready date (ISO)', (c) => isoOrNull(c.leg.cargoReadyDate)),
  ship('cfs_cutoff', 'dates', 'CFS cut-off as stored (human-entered only; the parser maps 截仓 to warehouse_end_date)', (c) => isoOrNull(c.leg.cfsCutoff)),
  ship('warehouse_start_date', 'dates', 'Warehouse window start (ISO)', (c) => isoOrNull(c.leg.warehouseStartDate)),
  ship('warehouse_end_date', 'dates', 'Warehouse window end / 截仓 (ISO)', (c) => isoOrNull(c.leg.warehouseEndDate)),
  ship('etd', 'dates', 'Estimated departure (ISO)', (c) => isoOrNull(c.leg.etd)),
  ship('atd', 'dates', 'Actual departure (ISO)', (c) => isoOrNull(c.leg.atd)),
  ship('eta', 'dates', 'Estimated arrival (ISO)', (c) => isoOrNull(c.leg.eta)),
  ship('ata', 'dates', 'Actual arrival (ISO)', (c) => isoOrNull(c.leg.ata)),
  ship('in_dc_date', 'dates', 'In-DC / delivered-to-DC date (ISO)', (c) => isoOrNull(c.leg.inDcDate)),

  // ---- Shipment tier: this PO on this leg (the shipment_pos link) ----
  ship('quantity_shipped', 'po_link', 'Quantity of THIS PO on THIS leg (partial-shipment split); null when the split is unknown', (c) =>
    c.link.quantity ?? null),
  ship('quantity_shipped_unit', 'po_link', 'Unit of quantity_shipped', (c) => c.link.quantityUnit ?? c.leg.qtyUnit ?? null),
  ship('link_inferred', 'po_link', 'true when the PO↔shipment link was inferred (swept up with the group) rather than stated by an email; null for booking-level legacy links', (c) =>
    c.link.level === 'booking' ? null : c.link.inferred ?? false),
  ship('link_level', 'po_link', "'shipment' (per-leg link) or 'booking' (legacy booking-level link, no per-leg quantity)", (c) => c.link.level),

  // ---- Shipment tier: whole-leg cargo figures (all POs on the leg combined) ----
  ship('shipment_total_qty', 'cargo', 'Total quantity on the leg (ALL POs combined — not per-PO)', (c) => c.leg.qty ?? null),
  ship('shipment_total_qty_unit', 'cargo', 'Unit of shipment_total_qty', (c) => c.leg.qtyUnit ?? null),
  ship('cartons', 'cargo', 'Carton count for the whole leg', (c) => c.leg.cartons ?? null),
  ship('gross_weight', 'cargo', 'Gross weight (KGS) for the whole leg', (c) => c.leg.grossWeight ?? null),
  ship('net_weight', 'cargo', 'Net weight (KGS) for the whole leg', (c) => c.leg.netWeight ?? null),
  ship('measurement', 'cargo', 'Measurement (CBM) for the whole leg', (c) => c.leg.measurement ?? null),
  ship('cargo_description', 'cargo', 'Cargo description', (c) => c.leg.cargoDescription ?? null),
  ship('hts_code', 'cargo', 'HTS code(s)', (c) => c.leg.htsCode ?? null),
  ship('item_style_no', 'cargo', 'Item/style number(s) stated on the shipment documents', (c) => c.leg.itemStyleNo ?? null),

  // ---- Shipment tier: parties ----
  ship('customer_code', 'parties', 'Customer code (booking-resolved Mesh master)', (c) => c.customer?.code ?? null),
  ship('customer_name', 'parties', 'Customer name (booking-resolved Mesh master)', (c) => c.customer?.name ?? null),
  ship('customer_raw', 'parties', 'Customer as stated in the source email (unresolved text)', (c) => c.leg.customerRaw ?? null),
  ship('vendor_code', 'parties', 'Vendor code (booking-resolved Mesh master)', (c) => c.vendor?.code ?? null),
  ship('vendor_name', 'parties', 'Vendor name (booking-resolved Mesh master)', (c) => c.vendor?.name ?? null),
  ship('vendor_raw', 'parties', 'Vendor as stated in the source email (unresolved text)', (c) => c.leg.vendorRaw ?? null),
  ship('forwarder_code', 'parties', 'Forwarder code (resolved master)', (c) => c.forwarder?.code ?? null),
  ship('forwarder_name', 'parties', 'Forwarder name (resolved master)', (c) => c.forwarder?.name ?? null),
  ship('forwarder_raw', 'parties', 'Forwarder as stated in the source email (unresolved text)', (c) => c.leg.forwarderRaw ?? null),
  ship('consignee_name', 'parties', 'Consignee name', (c) => c.leg.consigneeName ?? null),
  ship('consignee_address', 'parties', 'Consignee address', (c) => c.leg.consigneeAddress ?? null),

  // ---- Shipment tier: milestones + meta ----
  ship('milestones', 'milestones', 'Dated event history: [{milestone_type, occurred_at}] in time order', (c) =>
    c.milestones.map((m) => ({ milestone_type: m.milestoneType, occurred_at: isoOrNull(m.occurredAt) }))),
  ship('created_at', 'meta', 'When the leg was first created in ShipTrack (ISO)', (c) => isoOrNull(c.leg.createdAt)),
  ship('updated_at', 'meta', 'When the leg last changed in ShipTrack (ISO) — drives incremental pulls', (c) => isoOrNull(c.leg.updatedAt)),
]

export const FIELD_BY_KEY: ReadonlyMap<string, ErpExportField> = new Map(
  ERP_EXPORT_FIELDS.map((f) => [f.key, f]),
)

/**
 * Resolve a requested key list to concrete fields, catalog order, identity fields merged in.
 * `requested` null/empty → the full catalog. Unknown keys are reported, not silently dropped.
 */
export function resolveSelection(requested?: string[] | null): {
  fields: ErpExportField[]
  unknown: string[]
} {
  if (!requested || requested.length === 0) return { fields: ERP_EXPORT_FIELDS, unknown: [] }
  const want = new Set(requested)
  const unknown = requested.filter((k) => !FIELD_BY_KEY.has(k))
  const fields = ERP_EXPORT_FIELDS.filter((f) => f.always || want.has(f.key))
  return { fields, unknown }
}
