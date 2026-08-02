/**
 * Pure field→leg-column mapping extracted from committer.service.ts. Given a parsed `fields` bag, produce the
 * subset of leg columns that are a DIRECT function of those fields (no DB / no cross-field context). The
 * context-derived columns — mode/state/kind, resolved forwarder/POL/POD ids, originCountry, matchKeys — stay
 * in the committer, which overlays them onto this result. Keeping the mapping pure makes its subtle rules
 * (scac fallback, poi/pol alias, CSV dedupe, string/number/date coercion) fast to unit-test in isolation.
 */
import { str, num, date } from './match-keys'
import { dedupeCsv } from './committer-helpers'

/**
 * Map the parsed `fields` bag to the leg columns that derive purely from it. Excludes the columns the committer
 * computes with external context (mode/state/kind, resolved ids, originCountry, matchKeys) — those are spread
 * over this result at the call site.
 */
export function mapFieldsToLegColumns(f: Record<string, unknown>): Record<string, unknown> {
  return {
    forwarderRaw: str(f.forwarder_name), // raw — surfaced when forwarderId doesn't resolve
    customerRaw: str(f.customer_code), // raw — surfaced when customerId doesn't resolve (see shipment_parties: it only writes when the PRIMARY code resolves, so it can't serve as this fallback)
    vendorRaw: str(f.vendor_code), // raw — surfaced when vendorId doesn't resolve to a master vendor
    polRaw: str(f.poi ?? f.pol), // raw — surfaced when polId doesn't resolve; alias: parser still emits `pol`
    podRaw: str(f.pod),
    bookingNo: str(f.booking_no),
    soNo: str(f.so_no),
    warehouseSo: str(f.warehouse_so), // 入仓/订仓号 — never alias of so_no
    hblAwbFcrNo: str(f.hbl_awb_fcr_no),
    mbl: str(f.mbl),
    containerNo: str(f.container_no),
    scacCode: str(f.scac_code ?? f.scac), // alias `scac` — the parser owns SCAC; no MBL-prefix guessing
    vesselName: str(f.vessel_name),
    voyageNo: str(f.voyage_no),
    flightNo: str(f.flight_no),
    mawb: str(f.mawb),
    cargoReadyDate: date(f.cargo_ready_date),
    // The column has existed since 0000 and the detail page edits it, but nothing mapped it here — so
    // the committer could never write it and the human create form had no way to record it.
    cfsCutoff: date(f.cfs_cutoff),
    warehouseStartDate: date(f.warehouse_start_date),
    warehouseEndDate: date(f.warehouse_end_date),
    etd: date(f.etd),
    atd: date(f.atd),
    eta: date(f.eta),
    ata: date(f.ata),
    inDcDate: date(f.in_dc_date),
    qty: num(f.qty),
    qtyUnit: str(f.qty_unit),
    // The carton count, present only when a table stated BOTH cartons and pieces — `qty` then holds
    // the pieces (#197), so this is the only place the carton count survives.
    cartons: num(f.cartons),
    grossWeight: num(f.gross_weight),
    // net weight is the goods WITHOUT the carton (customs reads net, freight reads gross); a booking
    // sheet states the two in adjacent columns, so both survive rather than one overwriting the other
    netWeight: num(f.net_weight),
    cargoDescription: str(f.cargo_description),
    measurement: num(f.measurement),
    htsCode: dedupeCsv(str(f.hts_code)),
    // The MANUFACTURER (list class - an LCL consol carries one factory per shipper). BACKEND DATA ONLY
    // by decision 2026-08-03: stored for queries/audit, not shown by the frontend. Never a fallback for
    // vendorRaw - the labelling ground truth makes a factory a legitimate vendor_code in its own right.
    factoryCode: dedupeCsv(str(f.factory_code)),
    itemStyleNo: dedupeCsv(str(f.item_style_no)),
    consigneeName: str(f.consignee_name),
    consigneeAddress: str(f.consignee_address),
  }
}

/**
 * Schedule columns the queue merge EXPLICITLY retracted — the field is PRESENT in the decision's
 * fields bag with value null (the lone-ATD contradiction guard / a coherence pass that found no
 * keepable statement). Only these may CLEAR a stored value; an ABSENT field stays "no statement"
 * (mapFieldsToLegColumns flattens both shapes to null, so the distinction must be derived here,
 * before the mapping). Deliberately schedule-only: identity/entity/quantity retraction stays a
 * human decision.
 */
const SCHEDULE_RETRACTABLE: readonly (readonly [src: string, col: string])[] = [
  ['cargo_ready_date', 'cargoReadyDate'],
  ['warehouse_start_date', 'warehouseStartDate'],
  ['warehouse_end_date', 'warehouseEndDate'],
  ['etd', 'etd'],
  ['atd', 'atd'],
  ['eta', 'eta'],
  ['ata', 'ata'],
  ['in_dc_date', 'inDcDate'],
]
export function scheduleRetractionColumns(f: Record<string, unknown>): string[] {
  return SCHEDULE_RETRACTABLE.filter(([src]) => src in f && f[src] === null).map(([, col]) => col)
}
