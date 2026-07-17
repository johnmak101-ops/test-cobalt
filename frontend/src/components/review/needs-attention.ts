/**
 * Needs attention — layman groups (design 2026-07-17-needs-attention-layman-groups).
 * Group like the conflict table; short precise ELI5 lines; show all that apply (no cap of 2).
 */
import {
  categorizeReason,
  humanizeReasons,
  type ReasonCategory,
} from '../../lib/review-reasons'

/** Queue risk flags → ReasonCategory (also used for category suppress). */
export const RISK_CODE_CATEGORY: Record<string, ReasonCategory> = {
  INTRA_EMAIL_FIELD_CONFLICT: 'conflict',
  INTRA_EMAIL_CARGO_CONFLICT: 'conflict',
  BACKEND_CONFLICT: 'conflict',
  FIELD_LOCK_CLASH: 'conflict',
  INTRA_EMAIL_MULTI_STRONG_ID: 'multi_id',
  AMBIGUOUS_MATCH: 'multi_id',
  PO_REASSIGN: 'multi_id',
  PO_ONLY_WEAK_MATCH: 'multi_id',
  MULTI_LEG_SUSPECT: 'multi_id',
  MULTI_DESTINATION_SUSPECT: 'multi_id',
  THREAD_SUPERSEDE: 'multi_id',
  WEAK_IDENTITY: 'no_identity',
  PORTAL_ECHO: 'portal',
  PARTY_UNRESOLVED: 'master_miss',
  PARTY_OPS: 'master_miss',
  MISSING_ATTACHMENT: 'extraction',
  EXTRACTION_INCOMPLETE: 'extraction',
  SCAN_OCR_RISK: 'extraction',
  CARGO_SANITY: 'extraction',
  MERGE_ADJUSTMENT: 'other',
}

/** UI group ids (portal folds into real_shipment). */
export type NeedsAttentionGroupId =
  | 'which_shipment'
  | 'real_shipment'
  | 'fields_disagree'
  | 'master_miss'
  | 'incomplete_data'
  | 'other'

export const GROUP_TITLE: Record<NeedsAttentionGroupId, string> = {
  which_shipment: 'Which shipment?',
  real_shipment: 'Real shipment?',
  fields_disagree: 'Fields disagree',
  master_miss: 'Master miss',
  incomplete_data: 'Incomplete data',
  other: 'Other',
}

export const GROUP_ORDER: NeedsAttentionGroupId[] = [
  'which_shipment',
  'real_shipment',
  'fields_disagree',
  'master_miss',
  'incomplete_data',
  'other',
]

function categoryToGroup(c: ReasonCategory): NeedsAttentionGroupId {
  switch (c) {
    case 'multi_id':
      return 'which_shipment'
    case 'no_identity':
    case 'portal':
      return 'real_shipment'
    case 'conflict':
      return 'fields_disagree'
    case 'master_miss':
      return 'master_miss'
    case 'extraction':
      return 'incomplete_data'
    default:
      return 'other'
  }
}

export type NeedsAttentionItem = {
  key: string
  /** Stable combine key — same line once per card. */
  lineId: string
  severity: 'low' | 'medium' | 'high'
  text: string
  category: ReasonCategory
  groupId: NeedsAttentionGroupId
}

export type NeedsAttentionGroup = {
  groupId: NeedsAttentionGroupId
  title: string
  items: NeedsAttentionItem[]
}

const SEV_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 }

/** @deprecated no longer capped — kept so callers/tests can opt into a max */
export const NEEDS_ATTENTION_MAX = Number.POSITIVE_INFINITY

const BROADCAST_RE = /broadcast total|total_quantity\s+\S+\s+looks like a broadcast/i

function isBroadcast(rawOrText: string): boolean {
  return BROADCAST_RE.test(rawOrText)
}

const PARTY_FIELD_LABEL: Record<string, string> = {
  forwarder_name: 'Forwarder',
  customer_code: 'Customer',
  vendor_code: 'Vendor',
  consignee_name: 'Consignee',
  pol: 'Port of Loading',
  pod: 'Port of Discharge',
}

function partyFieldLabel(rawField: string): string {
  return PARTY_FIELD_LABEL[rawField] ?? rawField.replace(/_/g, ' ')
}

/** Extract field list from backend-conflict style messages. */
function fieldsFromBackendMsg(msg: string): string | null {
  const m =
    msg.match(/already stored on (.+?)\s*[—-]/i) ||
    msg.match(/backend conflict on (.+)/i) ||
    msg.match(/disagree(?:s)? about:\s*(.+?)(?:\s*[—-]|$)/i) ||
    msg.match(/differ on (.+?)\s*[—-]/i)
  return m?.[1]?.trim() || null
}

function nFromFieldConflicts(msg: string): string | null {
  const m = msg.match(/(\d+)\s*field conflicts?/i) || msg.match(/(\d+)\s*field\(s\)/i)
  return m?.[1] ?? null
}

function lockedFieldsFromMsg(msg: string): string | null {
  const m = msg.match(/locked field\(s\):\s*(.+?)\.?$/i) || msg.match(/human-locked field\(s\):\s*(.+?)\.?$/i)
  return m?.[1]?.trim() || null
}

type LineHit = { lineId: string; text: string; category: ReasonCategory }

/** Map a risk flag to a canonical short line. */
function lineFromFlag(code: string, message: string): LineHit | null {
  if (isBroadcast(message)) return null
  // Legacy / compact codes
  if (code === 'MULTI_ID' || code === 'MULTI_STRONG_ID') {
    return {
      lineId: 'w-multi-id',
      text: 'One email has more than one booking/SO/B/L number — may be several shipments',
      category: 'multi_id',
    }
  }
  switch (code) {
    case 'AMBIGUOUS_MATCH':
    case 'MULTI_LEG_SUSPECT':
      return {
        lineId: 'w-multi-match',
        text: 'This email matches more than one existing shipment — confirm which one',
        category: 'multi_id',
      }
    case 'INTRA_EMAIL_MULTI_STRONG_ID':
      return {
        lineId: 'w-multi-id',
        text: 'One email has more than one booking/SO/B/L number — may be several shipments',
        category: 'multi_id',
      }
    case 'PO_REASSIGN':
      return {
        lineId: 'w-po-other',
        text: 'PO already on another job — confirm move or split',
        category: 'multi_id',
      }
    case 'PO_ONLY_WEAK_MATCH':
      return {
        lineId: 'w-po-only',
        text: 'Linked by PO only — may be the wrong leg',
        category: 'multi_id',
      }
    case 'MULTI_DESTINATION_SUSPECT':
      return {
        lineId: 'w-multi-dest',
        text: 'One booking appears to cover more than one destination — confirm before cargo is final',
        category: 'multi_id',
      }
    case 'THREAD_SUPERSEDE':
      return {
        lineId: 'w-supersede',
        text: 'Same PO(s) but booking/SO changed — confirm this is still one shipment',
        category: 'multi_id',
      }
    case 'PORTAL_ECHO':
      return {
        lineId: 'r-portal',
        text: 'Portal notice — may not be real freight',
        category: 'portal',
      }
    case 'WEAK_IDENTITY':
      return {
        lineId: 'r-no-id',
        text: 'No booking, SO, B/L, or PO — cannot place this email',
        category: 'no_identity',
      }
    case 'BACKEND_CONFLICT': {
      const fields = fieldsFromBackendMsg(message)
      return {
        lineId: fields ? `f-backend:${fields}` : 'f-backend',
        text: fields
          ? `Email and system differ on ${fields} — choose which values to keep`
          : 'Email and system differ — choose which values to keep',
        category: 'conflict',
      }
    }
    case 'INTRA_EMAIL_FIELD_CONFLICT':
    case 'INTRA_EMAIL_CARGO_CONFLICT': {
      const n = nFromFieldConflicts(message)
      return {
        lineId: n ? `f-count:${n}` : 'f-count',
        text: n
          ? `${n} field(s) disagree — see conflict table`
          : 'Field values disagree — see conflict table',
        category: 'conflict',
      }
    }
    case 'FIELD_LOCK_CLASH': {
      const fields = lockedFieldsFromMsg(message)
      return {
        lineId: fields ? `f-lock:${fields}` : 'f-lock',
        text: fields
          ? `Would change locked field(s): ${fields}`
          : 'Would change locked field(s)',
        category: 'conflict',
      }
    }
    case 'PARTY_UNRESOLVED':
    case 'PARTY_OPS':
      return {
        lineId: 'm-party',
        text: 'Party not linked to master — left unlinked',
        category: 'master_miss',
      }
    case 'EXTRACTION_INCOMPLETE':
      return {
        lineId: 'i-parse',
        text: 'Parse incomplete — key fields may be missing',
        category: 'extraction',
      }
    case 'MISSING_ATTACHMENT':
      return {
        lineId: 'i-attach',
        text: 'Attachment missing — cargo details may be incomplete',
        category: 'extraction',
      }
    case 'SCAN_OCR_RISK':
    case 'CARGO_SANITY':
      return {
        lineId: 'i-cargo',
        text: 'Qty / weight / volume missing or look wrong — please verify',
        category: 'extraction',
      }
    case 'MERGE_ADJUSTMENT':
      return {
        lineId: `o-merge:${message}`,
        text: message.startsWith('Merge note:') ? message : `Merge note: ${message}`,
        category: 'other',
      }
    default: {
      const cat = RISK_CODE_CATEGORY[code] ?? 'other'
      return {
        lineId: `flag:${code}`,
        text: message,
        category: cat,
      }
    }
  }
}

/** Map a review reason (raw) to a canonical short line; null = suppress. */
function lineFromReason(raw: string, humanized: string): LineHit | null {
  if (isBroadcast(raw) || isBroadcast(humanized)) return null

  // Which shipment?
  if (/matched multiple backend legs/i.test(raw)) {
    return {
      lineId: 'w-multi-match',
      text: 'This email matches more than one existing shipment — confirm which one',
      category: 'multi_id',
    }
  }
  if (/belongs to a different shipment|already belongs to another shipment|moved or reassigned/i.test(raw)) {
    return {
      lineId: 'w-po-other',
      text: 'PO already on another job — confirm move or split',
      category: 'multi_id',
    }
  }
  if (/identity supersede/i.test(raw)) {
    return {
      lineId: 'w-supersede',
      text: 'Same PO(s) but booking/SO changed — confirm this is still one shipment',
      category: 'multi_id',
    }
  }
  if (/≥2 distinct co-current|distinct co-current values of one strong-id/i.test(raw)) {
    return {
      lineId: 'w-multi-id',
      text: 'One email has more than one booking/SO/B/L number — may be several shipments',
      category: 'multi_id',
    }
  }

  // Real shipment?
  if (/platform\/portal|only a portal alert/i.test(raw)) {
    return {
      lineId: 'r-portal',
      text: 'Portal notice — may not be real freight',
      category: 'portal',
    }
  }
  if (
    /neither a strong identity key nor a PO|no booking\/SO\/HBL identity|insufficient identity|there.?s no purchase order|no booking, bill of lading/i.test(
      raw,
    )
  ) {
    if (/no lifecycle email type|verify this is a real shipment/i.test(raw)) {
      return {
        lineId: 'r-thin',
        text: 'Thin mail, not a lifecycle booking — verify it belongs in tracking',
        category: 'no_identity',
      }
    }
    return {
      lineId: 'r-no-id',
      text: 'No booking, SO, B/L, or PO — cannot place this email',
      category: 'no_identity',
    }
  }
  if (/no lifecycle email type|verify this is a real shipment/i.test(raw)) {
    return {
      lineId: 'r-thin',
      text: 'Thin mail, not a lifecycle booking — verify it belongs in tracking',
      category: 'no_identity',
    }
  }

  // Fields disagree
  if (/backend conflict on /i.test(raw) || /disagrees with what.?s already on the shipment/i.test(raw)) {
    const fields = fieldsFromBackendMsg(raw) || fieldsFromBackendMsg(humanized)
    return {
      lineId: fields ? `f-backend:${fields}` : 'f-backend',
      text: fields
        ? `Email and system differ on ${fields} — choose which values to keep`
        : 'Email and system differ — choose which values to keep',
      category: 'conflict',
    }
  }
  if (/\d+\s*field conflict|\d+\s*unresolved field conflict/i.test(raw)) {
    const n = nFromFieldConflicts(raw) || nFromFieldConflicts(humanized)
    return {
      lineId: n ? `f-count:${n}` : 'f-count',
      text: n ? `${n} field(s) disagree — see conflict table` : 'Field values disagree — see conflict table',
      category: 'conflict',
    }
  }
  {
    const mode = raw.match(/mode change (\w+)\s*→\s*(\w+)/i) || raw.match(/mode change (\w+)\s*->\s*(\w+)/i)
    if (mode) {
      return {
        lineId: `f-mode:${mode[1]}-${mode[2]}`,
        text: `Transport mode changed (${mode[1]} → ${mode[2]}) — confirm which is correct`,
        category: 'conflict',
      }
    }
  }
  if (/transport switched between sea and air/i.test(raw)) {
    return {
      lineId: 'f-mode:sea-air',
      text: 'Transport mode changed (sea ↔ air) — confirm which is correct',
      category: 'conflict',
    }
  }
  {
    const brand = raw.match(/^PO\s+(\S+):\s*brand conflict\s+(.+?)\s+\(kept\s+(.+?)\)/i)
    if (brand) {
      return {
        lineId: `f-brand:${brand[1]}`,
        text: `PO ${brand[1]}: brand differs (${brand[2]}, kept ${brand[3]}) — please verify`,
        category: 'conflict',
      }
    }
  }
  if (/brand conflict/i.test(raw)) {
    return {
      lineId: 'f-brand',
      text: 'Brand differs — please verify',
      category: 'conflict',
    }
  }

  // Master miss
  {
    const port = raw.match(/^(\w+)\s+"([^"]+)"\s+did not exact(?:\/curated)?-match a port master/i)
    if (port) {
      return {
        lineId: `m-port:${port[2]}`,
        text: `${partyFieldLabel(port[1]!)} "${port[2]}" not in master — left unlinked`,
        category: 'master_miss',
      }
    }
  }
  {
    const party = raw.match(/^(\w+)\s+"([^"]+)"\s+did not exact-match a master/i)
    if (party) {
      return {
        lineId: `m-party:${party[2]}`,
        text: `${partyFieldLabel(party[1]!)} "${party[2]}" not in master — left unlinked`,
        category: 'master_miss',
      }
    }
  }
  if (/did not exact(?:\/curated)?-match a port master/i.test(raw)) {
    return {
      lineId: 'm-port',
      text: 'Port not in master — left unlinked',
      category: 'master_miss',
    }
  }
  if (/did not exact-match a master/i.test(raw)) {
    return {
      lineId: 'm-party',
      text: 'Party not in master — left unlinked',
      category: 'master_miss',
    }
  }
  if (
    /customer is new or not recognized|unknown \/ unresolved customer|customer not known|new shipment for an unknown/i.test(
      raw,
    )
  ) {
    return {
      lineId: 'm-customer',
      text: 'Customer not in master — confirm who owns this shipment',
      category: 'master_miss',
    }
  }
  if (/Cannot match .+ Cobalt Fashion Data Mesh|Cannot match .+ as a port/i.test(raw)) {
    return {
      lineId: 'm-mesh',
      text: 'Add or alias in Mesh/port masters, then rematch',
      category: 'master_miss',
    }
  }
  if (/master candidates API was unreachable|masters catalog is empty/i.test(raw)) {
    return {
      lineId: 'm-api',
      text: 'Master system unavailable or empty — rematch after sync',
      category: 'master_miss',
    }
  }

  // Incomplete data
  if (/vision_pending|output_truncated|input_truncated|content_filter/i.test(raw)) {
    return {
      lineId: 'i-parse',
      text: 'Parse incomplete — key fields may be missing',
      category: 'extraction',
    }
  }
  if (
    /missing attachment|attachment not present|no attachment was ingested|references an attachment/i.test(raw)
  ) {
    return {
      lineId: 'i-attach',
      text: 'Attachment missing — cargo details may be incomplete',
      category: 'extraction',
    }
  }
  if (/missing cargo detail/i.test(raw)) {
    return {
      lineId: 'i-cargo',
      text: 'Qty / weight / volume missing or look wrong — please verify',
      category: 'extraction',
    }
  }
  if (/unlabeled inline screenshot|ack-only/i.test(raw)) {
    return {
      lineId: 'i-screenshot',
      text: 'Detail may be in an unlabeled screenshot — please verify',
      category: 'extraction',
    }
  }

  // Other
  if (/Booking cancelled/i.test(raw)) {
    return { lineId: 'o-cancel', text: 'Booking cancelled', category: 'other' }
  }
  {
    const etd = raw.match(/ETD\s+(\S+)\s+is\s+(\d+)\s+days before this email/i)
    if (etd) {
      return {
        lineId: `o-etd:${etd[1]}`,
        text: `ETD ${etd[1]} is ${etd[2]} days before this email`,
        category: 'other',
      }
    }
  }
  if (/seaport UN\/LOCODE|mode Air but pol/i.test(raw)) {
    return {
      lineId: 'o-seaport',
      text: 'Air mode but seaport code — check airport vs seaport',
      category: 'other',
    }
  }
  if (/cutoff note:|cutoff:/i.test(raw)) {
    return {
      lineId: `o-cutoff:${raw.slice(0, 40)}`,
      text: humanized,
      category: 'other',
    }
  }
  if (/new booking must open a NEW email|open a NEW email thread/i.test(raw)) {
    return {
      lineId: 'o-new-thread',
      text: 'New booking should be a new email thread — verify booking',
      category: 'other',
    }
  }

  const cat = categorizeReason(raw)
  return {
    lineId: `reason:${raw}`,
    text: humanized,
    category: cat,
  }
}

function pushUnique(
  byLine: Map<string, NeedsAttentionItem>,
  item: NeedsAttentionItem,
): void {
  const prev = byLine.get(item.lineId)
  if (!prev) {
    byLine.set(item.lineId, item)
    return
  }
  // Keep higher severity
  if ((SEV_RANK[item.severity] ?? 0) > (SEV_RANK[prev.severity] ?? 0)) {
    byLine.set(item.lineId, item)
  }
}

/**
 * Flat list of unique short lines (no cap). Prefer {@link buildNeedsAttentionGroups} for UI.
 */
export function buildNeedsAttention(opts: {
  riskFlags?: Array<{ code: string; severity?: string; message?: string }> | null
  reviewReasons?: string[] | null
  conflictsCount: number
  max?: number
}): NeedsAttentionItem[] {
  const tableOwnsConflicts = opts.conflictsCount > 0
  const flags = (opts.riskFlags ?? []).filter((f) => f?.message)
  const byLine = new Map<string, NeedsAttentionItem>()
  const explained = new Set<ReasonCategory>()

  for (const f of flags) {
    const c = RISK_CODE_CATEGORY[f.code]
    if (c) explained.add(c)
  }

  for (let i = 0; i < flags.length; i++) {
    const f = flags[i]!
    const hit = lineFromFlag(f.code, f.message!)
    if (!hit) continue
    if (hit.category === 'conflict' && tableOwnsConflicts) continue
    pushUnique(byLine, {
      key: `flag-${f.code}-${i}`,
      lineId: hit.lineId,
      severity: (f.severity as 'low' | 'medium' | 'high') || 'medium',
      text: hit.text,
      category: hit.category,
      groupId: categoryToGroup(hit.category),
    })
  }

  const reasons = opts.reviewReasons ?? []
  for (const { raw, text } of humanizeReasons(reasons, {
    fieldDetailAvailable: opts.conflictsCount > 0,
  })) {
    const hit = lineFromReason(raw, text)
    if (!hit) continue
    if (hit.category === 'conflict' && tableOwnsConflicts) continue
    // Drop reason if a flag already explained that category (and line not more specific)
    if (explained.has(hit.category) && !hit.lineId.startsWith('m-port:') && !hit.lineId.startsWith('m-party:')) {
      // Still allow master detail lines with quoted values when only generic party flag present
      if (hit.category !== 'master_miss' || explained.has('master_miss')) {
        // If same lineId not already from flag, skip category-duplicate generic reasons
        const already = [...byLine.values()].some((x) => x.category === hit.category)
        if (already && !/^m-(port|party):/.test(hit.lineId)) continue
      }
    }
    pushUnique(byLine, {
      key: `reason-${raw}`,
      lineId: hit.lineId,
      severity: 'medium',
      text: hit.text,
      category: hit.category,
      groupId: categoryToGroup(hit.category),
    })
  }

  let items = [...byLine.values()]
  items.sort((a, b) => (SEV_RANK[b.severity] ?? 0) - (SEV_RANK[a.severity] ?? 0))
  if (opts.max != null && Number.isFinite(opts.max)) {
    items = items.slice(0, opts.max)
  }
  return items
}

/** Grouped for ReviewCard (headers + bullets). Empty groups omitted. */
export function buildNeedsAttentionGroups(opts: {
  riskFlags?: Array<{ code: string; severity?: string; message?: string }> | null
  reviewReasons?: string[] | null
  conflictsCount: number
}): NeedsAttentionGroup[] {
  const items = buildNeedsAttention(opts)
  const byGroup = new Map<NeedsAttentionGroupId, NeedsAttentionItem[]>()
  for (const it of items) {
    const list = byGroup.get(it.groupId) ?? []
    list.push(it)
    byGroup.set(it.groupId, list)
  }
  return GROUP_ORDER.filter((id) => (byGroup.get(id)?.length ?? 0) > 0).map((groupId) => ({
    groupId,
    title: GROUP_TITLE[groupId],
    items: byGroup.get(groupId)!,
  }))
}
