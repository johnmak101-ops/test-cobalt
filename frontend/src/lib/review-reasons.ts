/**
 * Review reasons arrive as engineering/audit strings ("PO-linked group with an identity supersede
 * (possible over-merge of two shipments)"). Ops users need plain language. The RAW string stays as
 * the tooltip — it's the audit trail and what soul-improvement loops grep for.
 */

/** Every field name the matcher's review gate can put in a reason
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

const fieldLabel = (raw: string): string =>
  FIELD_WORDS[raw] ?? raw.replace(/_/g, ' ')

const prettifyFields = (list: string) =>
  list
    .split(/[,\s]+/)
    .filter(Boolean)
    .map(fieldLabel)
    .join(', ')

/** Last resort: replace any snake_case field tokens so ops never see DB column names. */
const scrubFieldTokens = (s: string): string =>
  s.replace(/\b([a-z]+(?:_[a-z0-9]+)+)\b/g, (tok) => FIELD_WORDS[tok] ?? tok.replace(/_/g, ' '))

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
    match: /missing cargo detail/i,
    text: () =>
      'Cargo quantity / weight / volume is missing — the booking attachment was likely never captured. Add the figures below, or fetch the original booking email.',
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
  {
    match: /referenced attachment not present on this thread/i,
    text: () =>
      'Referenced attachment is missing from this thread — packing list or cargo quantities may be incomplete',
  },
  {
    match: /body says a file was attached but no attachment was ingested/i,
    text: () =>
      'Referenced attachment is missing from this thread — packing list or cargo quantities may be incomplete',
  },
  {
    match: /email references an attachment but none was ingested/i,
    text: () =>
      'Referenced attachment is missing from this thread — packing list or cargo quantities may be incomplete',
  },
  // Master / port resolution — keep the quoted value, never the DB field name.
  {
    match: /^(\w+)\s+"([^"]+)"\s+did not exact(?:\/curated)?-match a port master/i,
    text: (m) => `${fieldLabel(m[1]!)} "${m[2]}" did not match a known port — left unlinked`,
  },
  {
    match: /^(\w+)\s+"([^"]+)"\s+did not exact-match a master/i,
    text: (m) => `${fieldLabel(m[1]!)} "${m[2]}" did not match master data — left unlinked`,
  },
  {
    match: /did not exact(?:\/curated)?-match a port master/i,
    text: () => 'A port code did not match a known port — left unlinked',
  },
  {
    match: /did not exact-match a master/i,
    text: () => 'A party name did not match master data — left unlinked',
  },
  {
    // "PO 2605358: total_quantity 692 looks like a broadcast total …"
    match: /^PO\s+(\S+):\s*total_quantity\s+(\S+)\s+looks like a broadcast total/i,
    text: (m) =>
      `PO ${m[1]}: order total ${m[2]} looks like a shared shipment total (same value on several POs) — not a per-PO quantity`,
  },
  {
    match: /total_quantity\s+(\S+)\s+looks like a broadcast total/i,
    text: (m) =>
      `Order total ${m[1]} looks like a shared shipment total (same value on several POs) — not a per-PO quantity`,
  },
  {
    match: /^PO\s+(\S+):\s*brand conflict\s+(.+?)\s+\(kept\s+(.+?)\)/i,
    text: (m) => `PO ${m[1]}: brand conflict ${m[2]} (kept ${m[3]}) — verify`,
  },
  {
    match: /broadcast total/i,
    text: () => 'A quantity was repeated across several POs (shared shipment total) — verify per-PO split',
  },
  {
    match: /sender:\s*ETD\s+(\S+)\s+is\s+(\d+)\s+days before this email/i,
    text: (m) => `ETD ${m[1]} is ${m[2]} days before this email`,
  },
  {
    match: /ETD\s+(\S+)\s+is\s+(\d+)\s+days before this email/i,
    text: (m) => `ETD ${m[1]} is ${m[2]} days before this email`,
  },
  {
    match: /mode Air but pol\s+(\S+)\s+is a seaport/i,
    text: (m) =>
      `Sender port looks wrong for air: ${m[1]} is a seaport code — for air use the airport (e.g. SZX not CNSZX) (verify)`,
  },
  {
    match: /seaport UN\/LOCODE/i,
    text: () => 'Mode is air but a seaport code was used — check airport vs seaport (verify)',
  },
  {
    match: /new booking must open a NEW email/i,
    text: () =>
      'Forwarder asked: new booking = new email thread (do not continue on the old booking mail) — check this is the right booking',
  },
  {
    match: /open a NEW email thread/i,
    text: () =>
      'Ops note in thread: open a new email for a new booking — verify booking identity',
  },
  {
    match: /ack-only.*unlabeled inline screenshot/i,
    text: () =>
      'Latest reply is only an acknowledgement (e.g. “系统已批”) — shipment details are probably in a screenshot without field labels; check OCR numbers carefully',
  },
  {
    match: /unlabeled inline screenshot/i,
    text: () =>
      'Shipment detail likely in an unlabeled screenshot — verify OCR qty/weight/ports',
  },
]

/** Plain-language version of a review reason; never surfaces raw DB field names. */
export function humanizeReason(reason: string): string {
  for (const t of TRANSLATIONS) {
    const m = reason.match(t.match)
    if (m) return t.text(m)
  }
  return scrubFieldTokens(reason)
}

export interface HumanizedReason {
  /** Original audit string (tooltip / soul loops). */
  raw: string
  /** Ops-facing text. */
  text: string
}

/** Humanize + de-duplicate (same human text once) while preserving first raw for tooltips. */
export function humanizeReasons(reasons: string[]): HumanizedReason[] {
  const out: HumanizedReason[] = []
  const seen = new Set<string>()
  for (const raw of reasons) {
    const text = humanizeReason(raw)
    if (seen.has(text)) continue
    seen.add(text)
    out.push({ raw, text })
  }
  return out
}
