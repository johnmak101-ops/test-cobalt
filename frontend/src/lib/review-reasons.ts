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

export interface HumanizeOpts {
  /**
   * When true (default), conflict copy may point at a field table / highlights "below".
   * Pass false when the card has no critic conflict breakdown so we do not promise UI that is not there (#146).
   */
  fieldDetailAvailable?: boolean
}

interface Translation {
  match: RegExp
  text: (m: RegExpMatchArray, opts?: HumanizeOpts) => string
}

const TRANSLATIONS: Translation[] = [
  {
    match: /backend conflict on (.+)/i,
    text: (m, opts) => {
      const fields = prettifyFields(m[1]!)
      if (opts?.fieldDetailAvailable === false) {
        return `Emails disagree about: ${fields} — open the full shipment to compare values (no field breakdown on this card)`
      }
      return `Emails disagree about: ${fields} — check the highlighted fields below`
    },
  },
  {
    match: /(\d+) unresolved field conflict/i,
    text: (m, opts) => {
      if (opts?.fieldDetailAvailable === false) {
        return `${m[1]} field(s) received different values from different emails — open the full shipment to compare`
      }
      return `${m[1]} field(s) received different values from different emails — compare them below`
    },
  },
  {
    // Gate wording (queue review-gate): "3 field conflict(s)" — #168 must humanize + categorize as conflict
    match: /(\d+)\s*field conflict\(s\)/i,
    text: (m, opts) => {
      if (opts?.fieldDetailAvailable === false) {
        return `${m[1]} field(s) received different values from different emails — open the full shipment to compare values`
      }
      return `${m[1]} field(s) received different values from different emails — see the conflict table for which fields and values`
    },
  },
  {
    match: /matched multiple backend legs/i,
    text: () =>
      'This email matched more than one existing leg — pick the right shipment below (multiple legs / 拼柜 is often normal)',
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
    // #152 ops notes from queue master-matcher seam
    match: /Cannot match .+ master candidates API was unreachable/i,
    text: () =>
      'Master data API was unreachable when matching a party — rematch after recovery (do not add a duplicate in Mesh yet)',
  },
  {
    // Keep the token so multi-port misses stay distinct (Needs attention expand/collapse).
    match: /Cannot match "([^"]+)" as a port/i,
    text: (m) =>
      `Port "${m[1]}" not in UN/LOCODE masters — add or alias, then rematch`,
  },
  {
    match: /Cannot match .+ as a port/i,
    text: () => 'Port not in UN/LOCODE masters — add or alias, then rematch',
  },
  {
    match: /Cannot match "([^"]+)" in the (?:forwarder|customer|vendor|consignee) list/i,
    text: (m) => `"${m[1]}" not found in Mesh Database — advise add in Mesh.`,
  },
  {
    match: /Cannot match .+ Cobalt Fashion Data Mesh System/i,
    text: () =>
      'Party not found in Mesh Database — advise add in Mesh.',
  },
  {
    match: /^(\w+)\s+"([^"]+)"\s+did not exact-match a master/i,
    text: (m) => `"${m[2]}" not found in Mesh Database — advise add in Mesh.`,
  },
  {
    match: /Cannot match .+ masters catalog is empty/i,
    text: () => 'Master catalog is empty for this party type — sync Mesh/masters, then rematch',
  },
  {
    // Model JSON cut mid-generation (output token ceiling / salvage) — NOT "email was too big".
    match: /output_truncated/i,
    text: () => 'Model output was cut short — some POs or fields may be missing; verify the extract',
  },
  {
    // Input attachment/body text cut to fit context before the model ran.
    match: /input_truncated/i,
    text: () => 'Email text was cut to fit the model — some attachment content may be missing',
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
    text: () => 'Referenced attachment is missing from this thread — data may be incomplete',
  },
  {
    match: /body says a file was attached but no attachment was ingested/i,
    text: () => 'Referenced attachment is missing from this thread — data may be incomplete',
  },
  {
    match: /email references an attachment but none was ingested/i,
    text: () => 'Referenced attachment is missing from this thread — data may be incomplete',
  },
  // Master / port resolution — keep the quoted value, never the DB field name.
  {
    match: /^(\w+)\s+"([^"]+)"\s+did not exact(?:\/curated)?-match a port master/i,
    text: (m) => `${fieldLabel(m[1]!)} "${m[2]}" did not match a known port — left unlinked`,
  },
  {
    // Port-specific handled above; party master miss uses Mesh copy (earlier rule also matches).
    match: /^(\w+)\s+"([^"]+)"\s+did not exact-match a master/i,
    text: (m) => `"${m[2]}" not found in Mesh Database — advise add in Mesh.`,
  },
  {
    match: /did not exact(?:\/curated)?-match a port master/i,
    text: () => 'A port code did not match a known port — left unlinked',
  },
  {
    match: /did not exact-match a master/i,
    text: () => 'Party not found in Mesh Database — advise add in Mesh.',
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
  // T2 style conflict (new) + legacy item_style_no conflict dump
  {
    match: /^PO\s+(\S+):\s*item\/style\s+(.+)$/i,
    text: (m) => `PO ${m[1]}: item/style ${m[2]}`,
  },
  {
    match: /^PO\s+(\S+):\s*item_style_no conflict\s+(.+?)\s+\(kept\s+(.+?)\)/i,
    text: (m) => `PO ${m[1]}: item/style conflict (kept ${m[3]}) — verify`,
  },
  {
    match: /^PO\s+(\S+):\s*item\/style looks copied across all\s+(\d+)\s+POs/i,
    text: (m) =>
      `PO ${m[1]}: the same item/style list was copied onto all ${m[2]} POs in one email — check each PO's style`,
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
    match: /cutoff:\s*warehouse end set from CY cut-off\s+(.+?)\s*\(cargo/i,
    text: (m) => `Warehouse end set from CY cargo cut-off ${m[1]} (not the SI/documentation deadline)`,
  },
  {
    match: /cutoff:\s*warehouse start set from\s+(.+)/i,
    text: (m) => `Warehouse start set from ${m[1]}`,
  },
  {
    match: /cutoff:\s*CY open is ETD-(\d+)\s+days but ETD is missing/i,
    text: (m) => `CY open is ETD-${m[1]} days but ETD is missing — set warehouse start once ETD is confirmed`,
  },
  {
    match: /cutoff note:\s*SI cut-off\s+(.+?)\s*\(shipping instruction/i,
    text: (m) => `SI (shipping instruction) cut-off: ${m[1]} — documentation only, not warehouse end`,
  },
  {
    match: /cutoff note:\s*VGM submission deadline\s+(.+)/i,
    text: (m) => `VGM submission deadline: ${m[1]}`,
  },
  {
    match: /cutoff note:\s*MDGF deadline\s+(.+)/i,
    text: (m) => `MDGF deadline: ${m[1]}`,
  },
  {
    match: /cutoff note:\s*empty container pickup latest\s+(.+)/i,
    text: (m) => `Empty container pickup latest: ${m[1]}`,
  },
  {
    match: /cutoff note:\s*voucher cut\s+(.+)/i,
    text: (m) => `Voucher cut: ${m[1]}`,
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
export function humanizeReason(reason: string, opts?: HumanizeOpts): string {
  for (const t of TRANSLATIONS) {
    const m = reason.match(t.match)
    if (m) return t.text(m, opts)
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
export function humanizeReasons(reasons: string[], opts?: HumanizeOpts): HumanizedReason[] {
  const out: HumanizedReason[] = []
  const seen = new Set<string>()
  for (const raw of reasons) {
    const text = humanizeReason(raw, opts)
    if (seen.has(text)) continue
    seen.add(text)
    out.push({ raw, text })
  }
  return out
}

// ---- Reason categories (#133) — drive the Review Queue filter chips + bulk triage. ----

export type ReasonCategory =
  | 'portal'
  | 'conflict'
  | 'multi_id'
  | 'no_identity'
  | 'master_miss'
  | 'extraction'
  | 'other'

export const CATEGORY_LABEL: Record<ReasonCategory, string> = {
  portal: 'Portal echo',
  conflict: 'Field conflict',
  multi_id: 'Multiple identities',
  no_identity: 'No identity',
  master_miss: 'Master-data miss',
  extraction: 'Extraction issue',
  other: 'Other',
}

export const CATEGORY_ORDER: ReasonCategory[] = [
  'portal', 'conflict', 'multi_id', 'no_identity', 'master_miss', 'extraction', 'other',
]

/** First match wins — portal before no_identity (the portal hint also mentions missing carrier id),
 *  conflict before multi_id (a "backend conflict on booking_no" is a field conflict, not a merge risk). */
const CATEGORY_RULES: Array<{ match: RegExp; category: ReasonCategory }> = [
  { match: /platform\/portal email without carrier identity/i, category: 'portal' },
  { match: /only a portal alert/i, category: 'portal' },
  { match: /backend conflict on /i, category: 'conflict' },
  { match: /unresolved field conflict/i, category: 'conflict' },
  // Gate emits "N field conflict(s)" without "unresolved" — must still be conflict (#168)
  { match: /\d+\s*field conflict\(s\)/i, category: 'conflict' },
  // Humanized / collapsed conflict prose ("1 field(s) received different values…")
  { match: /received different values/i, category: 'conflict' },
  { match: /disagrees with what.s already on the shipment/i, category: 'conflict' },
  { match: /mode change \S+ → \S+/i, category: 'conflict' },
  { match: /transport switched between sea and air/i, category: 'conflict' },
  { match: /brand conflict/i, category: 'conflict' },
  { match: /item(?:_style_no conflict|\/style)/i, category: 'conflict' },
  { match: /item\/style looks copied/i, category: 'extraction' },
  { match: /identity supersede/i, category: 'multi_id' },
  { match: /distinct co-current values/i, category: 'multi_id' },
  { match: /matched multiple backend legs/i, category: 'multi_id' },
  { match: /belongs to a different shipment|already belongs to another shipment/i, category: 'multi_id' },
  { match: /moved or reassigned/i, category: 'multi_id' },
  { match: /no booking\/SO\/HBL identity/i, category: 'no_identity' },
  { match: /neither a strong identity key nor a PO/i, category: 'no_identity' },
  { match: /no booking, bill of lading, AWB, or container number/i, category: 'no_identity' },
  { match: /there.s no purchase order/i, category: 'no_identity' },
  { match: /insufficient identity/i, category: 'no_identity' },
  { match: /did not exact(?:\/curated)?-match/i, category: 'master_miss' },
  { match: /customer is new or not recognized/i, category: 'master_miss' },
  { match: /unknown \/ unresolved customer/i, category: 'master_miss' },
  { match: /customer not known/i, category: 'master_miss' },
  { match: /Cannot match/i, category: 'master_miss' },
  { match: /Cobalt Fashion Data Mesh/i, category: 'master_miss' },
  { match: /UN\/LOCODE/i, category: 'master_miss' },
  // Synonym spam / collapse prose (customer, port city, Mesh humanize)
  { match: /no\s+4-?char\s+customer\s+code|no\s+customer\s+code|sourcing house, not a/i, category: 'master_miss' },
  { match: /shipment ref, not a customer code/i, category: 'master_miss' },
  { match: /not in master data|raw value kept/i, category: 'master_miss' },
  { match: /Party name not in master list/i, category: 'master_miss' },
  { match: /Port name did not match UN\/LOCODE/i, category: 'master_miss' },
  { match: /vision_pending|output_truncated|input_truncated|content_filter/i, category: 'extraction' },
  { match: /attachment|missing cargo detail|screenshot|broadcast total/i, category: 'extraction' },
  // Vendor/consignee missing from email (incomplete extract, not Mesh master miss)
  { match: /no\s+vendor\s+code|factory not identified/i, category: 'extraction' },
  { match: /consignee not stated/i, category: 'extraction' },
]

/** Bucket one raw review reason for the queue's filter chips. Unknown strings → 'other'. */
export function categorizeReason(raw: string): ReasonCategory {
  for (const r of CATEGORY_RULES) if (r.match.test(raw)) return r.category
  return 'other'
}

/** A shipment's category set = union over its reasons; a reason-less row files under 'other'. */
export function categoriesOf(reasons: string[]): Set<ReasonCategory> {
  const s = new Set<ReasonCategory>()
  for (const r of reasons) s.add(categorizeReason(r))
  return s.size ? s : new Set<ReasonCategory>(['other'])
}
