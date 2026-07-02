/**
 * Replay a shipment's per-email parsed evidence into a field-change timeline. Pure.
 *
 * Batch commits collapse a whole thread into ONE create (the merged decision), so audit.change_log
 * carries no per-email story for them — but the evidence stack does. Walking the related emails
 * oldest→newest and diffing each tracked field reconstructs "which email changed what", which the
 * Change History tab merges with the real audit rows (manual edits, review corrections, creates).
 */

type Dateish = Date | string | null | undefined

export interface EmailEvidenceRow {
  messageId: string
  subject: string | null
  sender: string | null
  receivedAt: Dateish
  fields: Record<string, unknown> | null
}

export interface EmailFieldChange {
  messageId: string
  subject: string | null
  sender: string | null
  /** ISO — the email's receivedAt (when the change was stated, not when we computed it) */
  changedAt: string | null
  /** leg column name — same vocabulary the committer's audit rows use */
  field: string
  oldValue: string | null
  newValue: string
}

/** parser field → leg column, mirroring the committer's legValues mapping (display vocabulary). */
const TRACKED: ReadonlyArray<readonly [string, string]> = [
  ['booking_no', 'bookingNo'],
  ['so_no', 'soNo'],
  ['hbl_awb_fcr_no', 'hblAwbFcrNo'],
  ['mbl', 'mbl'],
  ['container_no', 'containerNo'],
  ['scac_code', 'scacCode'],
  ['vessel_name', 'vesselName'],
  ['voyage_no', 'voyageNo'],
  ['flight_no', 'flightNo'],
  ['mawb', 'mawb'],
  ['cargo_ready_date', 'cargoReadyDate'],
  ['warehouse_start_date', 'warehouseStartDate'],
  ['warehouse_end_date', 'warehouseEndDate'],
  ['etd', 'etd'],
  ['atd', 'atd'],
  ['eta', 'eta'],
  ['ata', 'ata'],
  ['in_dc_date', 'inDcDate'],
  ['qty', 'qty'],
  ['qty_unit', 'qtyUnit'],
  ['gross_weight', 'grossWeight'],
  ['measurement', 'measurement'],
  ['hts_code', 'htsCode'],
  ['item_style_no', 'itemStyleNo'],
  ['consignee_name', 'consigneeName'],
  ['consignee_address', 'consigneeAddress'],
  ['forwarder_name', 'forwarder'],
  ['pol', 'pol'],
  ['pod', 'pod'],
]

const str = (v: unknown): string | null => {
  if (v == null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

const iso = (d: Dateish): string | null => {
  if (!d) return null
  const dt = d instanceof Date ? d : new Date(d)
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString()
}

export function emailFieldTimeline(rows: EmailEvidenceRow[]): EmailFieldChange[] {
  // one "statement" per email: first non-null value per tracked field across its records
  const emails = new Map<string, { subject: string | null; sender: string | null; receivedAt: Dateish; stated: Map<string, string> }>()
  for (const r of rows) {
    const e = emails.get(r.messageId) ?? { subject: r.subject, sender: r.sender, receivedAt: r.receivedAt, stated: new Map() }
    for (const [parserField, column] of TRACKED) {
      if (e.stated.has(column)) continue
      const v = str(r.fields?.[parserField])
      if (v != null) e.stated.set(column, v)
    }
    emails.set(r.messageId, e)
  }

  const ordered = [...emails.entries()].sort((a, b) => {
    const ta = iso(a[1].receivedAt) ?? ''
    const tb = iso(b[1].receivedAt) ?? ''
    return ta < tb ? -1 : ta > tb ? 1 : a[0] < b[0] ? -1 : 1
  })

  const running = new Map<string, string>()
  const out: EmailFieldChange[] = []
  for (const [messageId, e] of ordered) {
    for (const [column, value] of e.stated) {
      const prev = running.get(column) ?? null
      if (prev === value) continue
      out.push({
        messageId,
        subject: e.subject,
        sender: e.sender,
        changedAt: iso(e.receivedAt),
        field: column,
        oldValue: prev,
        newValue: value,
      })
      running.set(column, value)
    }
  }
  return out
}

/** Values equal after date normalization ('2026-07-08' vs the committer's '2026-07-08T00:00:00.000Z'). */
const sameValue = (a: string | null, b: string | null): boolean => {
  if (a == null || b == null) return a === b
  const na = a.trim().toUpperCase()
  const nb = b.trim().toUpperCase()
  if (na === nb) return true
  const dateish = /^\d{4}-\d{2}-\d{2}/
  if (dateish.test(na) && dateish.test(nb)) return na.slice(0, 10) === nb.slice(0, 10)
  return false
}

/**
 * Drop synthesized email entries that a REAL audit row already records (live-mode amends audit the
 * same change; showing both would double every entry on incrementally-built shipments).
 */
export function dedupeAgainstAudit(
  entries: EmailFieldChange[],
  audit: Array<{ field: string | null; newValue: string | null }>,
): EmailFieldChange[] {
  return entries.filter((e) => !audit.some((a) => a.field === e.field && sameValue(a.newValue, e.newValue)))
}
