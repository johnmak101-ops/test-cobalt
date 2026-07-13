/**
 * Collect Related-Email source events from every channel a decision may carry.
 *
 * Historical bug: shipment_emails was written only from dto.events[].graphId. When events
 * arrived empty / without graphId (rebuild path, partial payload) but identifiers still
 * carried sourceEmailId, the leg had history with no "Related Emails" on the UI.
 *
 * Prefer the richest type/date when the same graph id appears in multiple places.
 */

export type SourceEvent = { emailType: string; receivedAt: string; graphId?: string | null }

export function collectSourceEvents(parts: {
  events?: SourceEvent[] | null
  evidenceRefs?: {
    graphId?: string | null
    graphMessageId?: string | null
    emailType?: string | null
    receivedAt?: string | null
  }[] | null
  evidence?: {
    graphMessageId?: string | null
    emailType?: string | null
    receivedAt?: string | null
  }[] | null
  identifiers?: {
    sourceEmailId?: string | null
    docType?: string | null
    observedAt?: string | null
  }[] | null
  /** bare graph message ids (evidenceIds) with no type/date */
  evidenceIds?: (string | null | undefined)[] | null
}): SourceEvent[] {
  const byId = new Map<string, SourceEvent>()

  const put = (graphId: string | null | undefined, emailType?: string | null, receivedAt?: string | null) => {
    const id = (graphId ?? '').trim()
    if (!id) return
    const prev = byId.get(id)
    const nextType =
      emailType && emailType !== 'Other'
        ? emailType
        : prev?.emailType && prev.emailType !== 'Other'
          ? prev.emailType
          : emailType || prev?.emailType || 'Other'
    // keep the newer receivedAt when both parse; else prefer any non-empty
    let nextAt = prev?.receivedAt ?? ''
    const cand = receivedAt?.trim() || ''
    if (cand) {
      if (!nextAt) nextAt = cand
      else {
        const a = Date.parse(cand)
        const b = Date.parse(nextAt)
        if (!Number.isNaN(a) && (Number.isNaN(b) || a >= b)) nextAt = cand
      }
    }
    if (!nextAt) nextAt = new Date(0).toISOString()
    byId.set(id, { emailType: nextType, receivedAt: nextAt, graphId: id })
  }

  for (const e of parts.events ?? []) put(e.graphId, e.emailType, e.receivedAt)
  for (const r of parts.evidenceRefs ?? []) put(r.graphMessageId ?? r.graphId, r.emailType, r.receivedAt)
  for (const e of parts.evidence ?? []) put(e.graphMessageId, e.emailType, e.receivedAt)
  for (const id of parts.identifiers ?? []) put(id.sourceEmailId, id.docType, id.observedAt)
  for (const id of parts.evidenceIds ?? []) put(id, 'Other', null)

  return [...byId.values()]
}
