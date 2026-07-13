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
    polRaw: str(f.poi ?? f.pol), // raw — surfaced when polId doesn't resolve; alias: parser still emits `pol`
    podRaw: str(f.pod),
    bookingNo: str(f.booking_no),
    soNo: str(f.so_no),
    hblAwbFcrNo: str(f.hbl_awb_fcr_no),
    mbl: str(f.mbl),
    containerNo: str(f.container_no),
    scacCode: str(f.scac_code ?? f.scac), // alias `scac` — the parser owns SCAC; no MBL-prefix guessing
    vesselName: str(f.vessel_name),
    voyageNo: str(f.voyage_no),
    flightNo: str(f.flight_no),
    mawb: str(f.mawb),
    cargoReadyDate: date(f.cargo_ready_date),
    warehouseStartDate: date(f.warehouse_start_date),
    warehouseEndDate: date(f.warehouse_end_date),
    etd: date(f.etd),
    atd: date(f.atd),
    eta: date(f.eta),
    ata: date(f.ata),
    inDcDate: date(f.in_dc_date),
    qty: num(f.qty),
    qtyUnit: str(f.qty_unit),
    grossWeight: num(f.gross_weight),
    measurement: num(f.measurement),
    htsCode: dedupeCsv(str(f.hts_code)),
    itemStyleNo: dedupeCsv(str(f.item_style_no)),
    consigneeName: str(f.consignee_name),
    consigneeAddress: str(f.consignee_address),
  }
}
