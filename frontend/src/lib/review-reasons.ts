/**
 * Review reasons arrive as engineering/audit strings ("PO-linked group with an identity supersede
 * (possible over-merge of two shipments)"). Ops users need plain language. The RAW string stays as
 * the tooltip — it's the audit trail and what my soul-improvement loops grep for.
 */

/** Every field name the matcher's review gate can put in a "backend conflict on ..." reason
 *  (= FIELD_CLASS keys in the queue repo) → the label users see on screen. */
const FIELD_WORDS: Record<string, string> = {
  qty: 'Qty',
  qty_unit: 'UOM',
  gross_weight: 'Gross Weight',
  measurement: 'Measurement',
  item_style_no: 'Item/Style',
  consignee_name: 'Consignee Name',
  consignee_address: 'Consignee Address',
  booking_no: 'Booking No.',
  so_no: 'SO#',
  hbl_awb_fcr_no: 'HBL/AWB/FCR',
  mbl: 'MBL',
  container_no: 'Container No.',
  vessel_name: 'Vessel',
  voyage_no: 'Voyage',
  flight_no: 'Flight No.',
  mawb: 'MAWB',
  scac_code: 'SCAC',
  brand: 'Brand',
  hts_code: 'HTS Code',
  customer_po: 'PO#',
  customer_code: 'Customer',
  vendor_code: 'Vendor',
  forwarder_name: 'Forwarder',
  pol: 'Port of Loading',
  pod: 'Port of Discharge',
  etd: 'ETD',
  eta: 'ETA',
  atd: 'ATD',
  ata: 'ATA',
  cargo_ready_date: 'Cargo Ready Date',
  cfs_cutoff: 'CFS Cut-off',
  in_dc_date: 'In DC Date',
  warehouse_start_date: 'WH Start',
  warehouse_end_date: 'WH End',
}

const prettifyFields = (list: string) =>
  list
    .split(/[,\s]+/)
    .filter(Boolean)
    .map((f) => FIELD_WORDS[f] ?? f.replace(/_/g, ' '))
    .join(', ')

interface Translation {
  match: RegExp
  text: (m: RegExpMatchArray) => string
}

const TRANSLATIONS: Translation[] = [
  {
    match: /backend conflict on (.+)/i,
    text: (m) => `Emails disagree about: ${prettifyFields(m[1]!)} — check the highlighted fields below`,
  },
  {
    match: /(\d+) unresolved field conflict/i,
    text: (m) => `${m[1]} field(s) received different values from different emails — compare them below`,
  },
  {
    match: /matched multiple backend legs/i,
    text: () => 'This email could belong to more than one shipment — confirm it is attached to the right one',
  },
  {
    match: /a PO on this email currently belongs to a different shipment/i,
    text: () => 'A PO on this email is already linked to another shipment — approving moves/splits that PO',
  },
  {
    match: /mode change (\w+) → (\w+)/i,
    text: (m) => `Transport mode changed ${m[1]} → ${m[2]} between documents — confirm which is correct`,
  },
  {
    match: /PO-linked group with an identity supersede/i,
    text: () =>
      'These emails were grouped mainly by shared PO numbers and the booking/SO number changed along the way — make sure this is ONE shipment, not two merged by mistake',
  },
  {
    match: /≥2 distinct co-current values of one strong-id type/i,
    text: () => 'This shipment carries more than one active booking/SO number at the same time — verify they really belong together',
  },
  {
    match: /vision_pending/i,
    text: () => 'Some attachments (images/scanned PDFs) have not been read yet — data may be incomplete',
  },
  {
    match: /new shipment for an unknown \/ unresolved customer/i,
    text: () => 'Customer not recognised in master data — confirm who this shipment belongs to',
  },
  {
    match: /output_truncated|input_truncated/i,
    text: () => 'The email/attachments were too large to read fully — some records may be missing',
  },
  {
    match: /neither a strong identity key nor a PO/i,
    text: () => 'No booking/SO/HBL or PO found — too little information to track automatically',
  },
  {
    match: /content_filter/i,
    text: () => 'Some images were skipped by the AI safety filter — review them by hand',
  },
]

/** Plain-language version of a review reason; falls back to the raw string when unknown. */
export function humanizeReason(reason: string): string {
  for (const t of TRANSLATIONS) {
    const m = reason.match(t.match)
    if (m) return t.text(m)
  }
  return reason
}
