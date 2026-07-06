/**
 * Recover the CONTESTED fields for the review UI from the persisted identifier set.
 *
 * The agent gate reports disagreements as a COUNT ("1 unresolved field conflict(s)") that names no
 * field, so the review page can't tell the user WHICH field to compare or highlight. But the competing
 * values are persisted: a field conflict = one identity type carrying ≥2 DISTINCT co-current values
 * (two emails each stated a current, different value — e.g. two different SO numbers). Superseded
 * alternates (is_current=false — a Draft B/L number replaced by the Final) are a lifecycle supersede,
 * NOT a conflict, and are excluded. We map each contested identity type to its editable leg column so
 * the form can highlight it and list "what each email said".
 */

/** Identity type (shipment_identifiers.type) → editable leg column + the label shown in the review UI. */
const IDENTITY_COLUMN: Record<string, { column: string; label: string }> = {
  so_no: { column: 'soNo', label: 'SO#' },
  booking_no: { column: 'bookingNo', label: 'Booking No.' },
  hbl_awb_fcr_no: { column: 'hblAwbFcrNo', label: 'HBL / AWB / FCR No.' },
  mbl: { column: 'mbl', label: 'MBL' },
  container_no: { column: 'containerNo', label: 'Container No.' },
}

const alnum = (v: unknown): string => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')

export interface IdentifierRow {
  type: string
  value: string
  docType?: string | null
  isCurrent?: boolean | null
  sourceEmailId?: string | null
}

export interface FieldConflict {
  /** the editable leg column (matches EDITABLE_FIELDS[].column on the frontend) so the field highlights */
  column: string
  label: string
  /** every DISTINCT co-current value, with the document/email that stated it — the cross-check trail */
  values: { value: string; docType: string | null; sourceEmailId: string | null }[]
}

/**
 * @param resolveEmailId maps an identifier's stored `source_email_id` (a Graph/RFC822 message-id) to the
 * internal email id the `/email/:id` popup expects (queue_message.id). Returns null when it can't resolve,
 * so the UI shows the source label as plain text instead of a broken link. Defaults to identity for tests.
 */
export function computeFieldConflicts(
  identifiers: IdentifierRow[],
  resolveEmailId: (graphMessageId: string | null) => string | null = (x) => x,
): FieldConflict[] {
  const byType = new Map<string, IdentifierRow[]>()
  for (const r of identifiers) {
    if (!r.isCurrent) continue // superseded alternate → lifecycle supersede, not a conflict
    if (!(r.type in IDENTITY_COLUMN)) continue
    if (!alnum(r.value)) continue
    const list = byType.get(r.type) ?? []
    list.push(r)
    byType.set(r.type, list)
  }

  const out: FieldConflict[] = []
  for (const [type, rows] of byType) {
    // dedupe by normalized value — the SAME number echoed across doc types is one value, not a conflict
    const seen = new Set<string>()
    const values: FieldConflict['values'] = []
    for (const r of rows) {
      const k = alnum(r.value)
      if (seen.has(k)) continue
      seen.add(k)
      values.push({ value: r.value, docType: r.docType ?? null, sourceEmailId: resolveEmailId(r.sourceEmailId ?? null) })
    }
    if (values.length >= 2) {
      const { column, label } = IDENTITY_COLUMN[type]!
      out.push({ column, label, values })
    }
  }
  return out
}
