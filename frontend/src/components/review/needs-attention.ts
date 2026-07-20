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
  /** Diagnostics folded into this line (tooltip); not separate bullets. */
  evidence?: string[]
  /**
   * When set, UI shows text as summary and can expand to list these names
   * (e.g. Mesh party misses collapsed for cleaner Needs attention).
   */
  details?: string[]
}

/** Collapsed multi-party Mesh miss — expand in UI to list each name. */
export const MESH_PARTY_COLLAPSED_LINE_ID = 'm-party:collapsed'

export function isMeshPartyCollapsed(item: NeedsAttentionItem): boolean {
  return item.lineId === MESH_PARTY_COLLAPSED_LINE_ID && (item.details?.length ?? 0) > 0
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

/**
 * Parser/agent notes that only restate "party not in master / used raw name/code".
 * Master miss already surfaces the actionable line ("Cannot match "X" in the vendor list…").
 * Showing these again under Other is pure noise — suppress.
 *
 * Examples:
 *  - "Vendor name not in master data; raw name used."
 *  - "Vendor name from image but no master code; raw name used"
 *  - "Factory name … not in master data; raw name used"
 *  - "Sender is factory (…) but no vendor master code; raw email used"
 *  - "South Ocean not in master data; raw name emitted"
 */
function isRedundantRawNameMasterNote(raw: string): boolean {
  const s = raw.trim()
  if (!s) return false
  if (/\braw name used\b/i.test(s)) return true
  if (/\braw name emitted\b/i.test(s)) return true
  if (/\braw email used\b/i.test(s)) return true
  if (/\braw value kept\b/i.test(s) && /\b(vendor|factory|customer|consignee|shipper)\b/i.test(s)) {
    // Port "city not in master data; raw value kept" is handled separately as port miss —
    // only suppress when the note is clearly about a party, not a port/city.
    return !/\b(port|pol|pod|un\/?locode)\b/i.test(s)
  }
  // "Vendor is Hop Shing…; no master code available/known"
  if (
    /\b(no master code|not (a )?(\d+-char )?master code|master code (available|known|match))\b/i.test(s) &&
    /\b(vendor|factory|customer|shipper|invoice party|consignee)\b/i.test(s)
  ) {
    return true
  }
  // "X not in master data; raw name emitted" without a useful quoted Mesh action
  if (/not in master data/i.test(s) && /\braw name\b/i.test(s)) return true
  return false
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

type LineHit = {
  lineId: string
  text: string
  category: ReasonCategory
  evidence?: string[]
}

/** Quoted party name from matcher/ops prose, if any. */
function extractQuotedParty(raw: string): string | null {
  return raw.match(/"([^"]+)"/)?.[1]?.trim() || null
}

/**
 * Case/space/punct-insensitive key so "SOUTH OCEAN" and "South Ocean" share one lineId.
 * Does not merge different legal names (LOGISTICS vs LOG MANAGEMENT stay distinct).
 */
export function normalizeMeshPartyKey(name: string): string {
  return name
    .trim()
    .toUpperCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function meshPartyLineId(name: string): string {
  return `m-party:${normalizeMeshPartyKey(name)}`
}

/** Prefer mixed/title case over shouting ALL CAPS for display. */
function preferMeshDisplayName(a: string, b: string): string {
  const aShout = a === a.toUpperCase() && /[A-Z]/.test(a)
  const bShout = b === b.toUpperCase() && /[A-Z]/.test(b)
  if (aShout && !bShout) return b
  if (bShout && !aShout) return a
  return a.length >= b.length ? a : b
}

function meshPartyMissText(name: string): string {
  return `"${name}" not found in Mesh Database — advise add in Mesh.`
}

function extractMeshDisplayName(item: NeedsAttentionItem): string | null {
  return item.text.match(/"([^"]+)"/)?.[1]?.trim() || null
}

/** Port/city name from "X not in master data" style prose. */
function extractPortName(raw: string): string | null {
  const fromStart = raw.match(/^([A-Za-z][A-Za-z .'-]{2,60})\s+not in master data/i)?.[1]
  if (fromStart) return fromStart.trim()
  if (/raw value kept/i.test(raw)) {
    const m = raw.match(/([A-Za-z][A-Za-z .'-]{2,60})\s+not in master/i)?.[1]
    if (m) return m.trim()
  }
  return null
}

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
        // Identity weakness only — do not restate multi-dest "wrong cargo" here.
        text: 'Matched on PO alone — no booking/SO/B/L to pin which shipment',
        category: 'multi_id',
      }
    case 'MULTI_DESTINATION_SUSPECT':
      return {
        lineId: 'w-multi-dest',
        // Structure issue — orthogonal to PO-only match quality.
        text: 'One booking, more than one destination — cargo may need a split',
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
        text: weakIdentityText(false),
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
    case 'PARTY_OPS': {
      // riskFlags carry the full ops note in `message` (e.g. Cannot match "Maersk…" in the forwarder list).
      // Never collapse to a blank "Party not linked" — reuse the same synonym/value lines as reviewReasons.
      // Drop "raw name used / no master code" prose — Master miss already has the Cannot-match line.
      if (isRedundantRawNameMasterNote(message)) return null
      const hit = lineFromReason(message, message)
      if (hit && !hit.lineId.startsWith('reason:')) return hit
      // Fallback: still surface the raw message rather than a useless generic
      const snippet = message.trim()
      const quoted = extractQuotedParty(message)
      return {
        lineId: quoted ? meshPartyLineId(quoted) : `m-party:${normalizeMeshPartyKey(snippet.slice(0, 48))}`,
        text: quoted
          ? meshPartyMissText(quoted)
          : snippet.length > 140
            ? `${snippet.slice(0, 137)}…`
            : snippet || 'Party not linked to master — left unlinked',
        category: 'master_miss',
      }
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
  // Brand code vs full name (e.g. Primark vs PRMT) is kept by enrichment; ops do not need to
  // re-verify brand on the decision desk — suppress entirely.
  if (/brand conflict/i.test(raw) || /brand differs/i.test(humanized) || /brand conflict/i.test(humanized)) {
    return null
  }
  // "Vendor name … raw name used" restates Master miss — never show under Other.
  if (isRedundantRawNameMasterNote(raw) || isRedundantRawNameMasterNote(humanized)) {
    return null
  }

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
      text: weakIdentityText(false),
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
  if (
    /field\(s\)\s+received different values/i.test(raw) ||
    /received different values from different emails/i.test(raw)
  ) {
    const n = raw.match(/(\d+)\s*field/i)?.[1]
    return {
      lineId: n ? `f-count:${n}` : 'f-count',
      text: n
        ? `${n} field(s) disagree — see conflict table`
        : 'Field values disagree — see conflict table',
      category: 'conflict',
    }
  }
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
  // Master miss
  {
    const port = raw.match(/^(\w+)\s+"([^"]+)"\s+did not exact(?:\/curated)?-match a port master/i)
    if (port) {
      const fieldRaw = port[1]!.toLowerCase()
      const field = fieldRaw === 'pol' || fieldRaw === 'pod' ? (fieldRaw as 'pol' | 'pod') : null
      const name = port[2]!
      if (looksLikeCountryToken(name)) {
        return {
          lineId: `m-port:${name}`,
          text: countryOnlyPortMissText(name, field),
          category: 'master_miss',
        }
      }
      return {
        lineId: `m-port:${name}`,
        text: `${partyFieldLabel(port[1]!)} "${name}" not in master — left unlinked`,
        category: 'master_miss',
      }
    }
  }
  {
    const party = raw.match(/^(\w+)\s+"([^"]+)"\s+did not exact-match a master/i)
    if (party) {
      return {
        lineId: meshPartyLineId(party[2]!),
        text: meshPartyMissText(party[2]!),
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
    const quoted = extractQuotedParty(raw)
    return {
      lineId: quoted ? meshPartyLineId(quoted) : 'm-party',
      text: quoted ? meshPartyMissText(quoted) : 'Party not found in Mesh Database — advise add in Mesh.',
      category: 'master_miss',
    }
  }
  // "Cannot match "X" in the forwarder|customer|vendor|consignee list..."
  {
    const listHit = raw.match(
      /Cannot match "([^"]+)" in the (forwarder|customer|vendor|consignee) list/i,
    )
    if (listHit) {
      return {
        lineId: meshPartyLineId(listHit[1]!),
        text: meshPartyMissText(listHit[1]!),
        category: 'master_miss',
      }
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

  // --- Synonym families (collapse LLM/ops prose spam) ---

  // Customer unlinked / not resolvable
  if (
    /no\s+4-?char\s+customer\s+code/i.test(raw) ||
    /no\s+customer\s+code/i.test(raw) ||
    /customer\s+code\s+(not\s+)?resolvable/i.test(raw) ||
    /brand\/party not resolvable/i.test(raw) ||
    /sourcing house, not a (customer|resolvable)/i.test(raw) ||
    /is a shipment ref, not a customer code/i.test(raw)
  ) {
    const partyName =
      raw.match(/FENIX FASHION LIMITED/i)?.[0] ??
      raw.match(/invoice party is ([A-Z][A-Z0-9 &.'-]{3,80})/i)?.[1] ??
      raw.match(/([A-Z][A-Z0-9 &.'-]{3,80})\s+is a sourcing house/i)?.[1] ??
      extractQuotedParty(raw)
    const ref = raw.match(/subject has ([A-Z0-9][A-Z0-9_-]{4,})/i)?.[1] ?? null
    const evidence = [
      partyName ? `Invoice party: ${partyName}` : null,
      ref ? `Rejected subject token: ${ref}` : null,
      /4-?char/i.test(raw) ? 'No 4-char customer code in subject/body' : null,
      /sourcing house/i.test(raw) ? 'Treated as sourcing house, not Mesh customer code' : null,
    ].filter(Boolean) as string[]
    return {
      lineId: 'm-customer',
      text: partyName
        ? `Customer not linked — "${partyName}" (not a Mesh customer code)`
        : 'Customer not linked to Mesh — no resolvable customer code in email',
      category: 'master_miss',
      evidence: evidence.length ? evidence : undefined,
    }
  }

  // Vendor missing
  if (/no\s+vendor\s+code/i.test(raw) || /factory not identified/i.test(raw)) {
    return {
      lineId: 'm-vendor',
      text: 'Vendor / factory not stated in email',
      category: 'extraction',
    }
  }

  // Consignee missing
  if (/consignee not stated/i.test(raw) || /consignee not (in|found)/i.test(raw)) {
    return {
      lineId: 'm-consignee',
      text: /only POD/i.test(raw)
        ? 'Consignee not stated (only POD mentioned)'
        : 'Consignee not stated in email',
      category: 'extraction',
    }
  }

  // Port city prose ("Ho Chi Minh City not in master data; raw value kept")
  {
    const city = extractPortName(raw)
    if (city || (/not in master data/i.test(raw) && /raw value kept/i.test(raw))) {
      const name = (city ?? 'Port').trim()
      if (looksLikeCountryToken(name)) {
        return {
          lineId: `m-port:${name}`,
          text: countryOnlyPortMissText(name, null),
          category: 'master_miss',
        }
      }
      return {
        lineId: `m-port:${name}`,
        text: `Port "${name}" not in UN/LOCODE masters — add or alias, then rematch`,
        category: 'master_miss',
      }
    }
  }

  // Generic UN/LOCODE / port-name miss (fold with value-specific m-port:* later)
  if (
    /port name did not match UN\/LOCODE/i.test(raw) ||
    /did not match UN\/LOCODE masters/i.test(raw)
  ) {
    return {
      lineId: 'm-port',
      text: 'Port not in UN/LOCODE masters — add or alias, then rematch',
      category: 'master_miss',
    }
  }

  if (/Cannot match .+ as a port/i.test(raw)) {
    const quoted = extractQuotedParty(raw)
    if (quoted && looksLikeCountryToken(quoted)) {
      return {
        lineId: `m-port:${quoted}`,
        text: countryOnlyPortMissText(quoted, null),
        category: 'master_miss',
      }
    }
    if (quoted) {
      return {
        lineId: `m-port:${quoted}`,
        text: `Port "${quoted}" not in UN/LOCODE masters — add or alias, then rematch`,
        category: 'master_miss',
      }
    }
    return {
      lineId: 'm-port',
      text: 'Port not in UN/LOCODE masters — add or alias, then rematch',
      category: 'master_miss',
    }
  }

  if (
    /Cannot match .+ Cobalt Fashion Data Mesh|Party name not in master list|not found in Mesh Database/i.test(
      raw,
    )
  ) {
    const quoted = extractQuotedParty(raw)
    if (quoted) {
      return {
        lineId: meshPartyLineId(quoted),
        text: meshPartyMissText(quoted),
        category: 'master_miss',
      }
    }
    return {
      lineId: 'm-mesh',
      text: 'Party not found in Mesh Database — advise add in Mesh.',
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
  const mergedEvidence = [
    ...(prev.evidence ?? []),
    ...(item.evidence ?? []),
    // keep discarded human/raw titles as evidence when text differs
    ...(prev.text !== item.text ? [item.text] : []),
  ].filter((s, i, a) => s && a.indexOf(s) === i)

  // Prefer text that names a concrete party/port (contains a quote or known proper noun)
  const preferNew =
    (SEV_RANK[item.severity] ?? 0) > (SEV_RANK[prev.severity] ?? 0) ||
    (/"[^"]+"/.test(item.text) && !/"[^"]+"/.test(prev.text)) ||
    (/FENIX|Ho Chi Minh/i.test(item.text) && !/FENIX|Ho Chi Minh/i.test(prev.text))

  byLine.set(item.lineId, {
    ...(preferNew ? item : prev),
    evidence: mergedEvidence.length ? mergedEvidence : undefined,
    // keep higher severity
    severity:
      (SEV_RANK[item.severity] ?? 0) > (SEV_RANK[prev.severity] ?? 0) ? item.severity : prev.severity,
  })
}

/** Fold generic m-port into a value-specific m-port:* line when both exist. */
function collapseGenericPort(byLine: Map<string, NeedsAttentionItem>): void {
  const portKeys = [...byLine.keys()].filter((k) => k.startsWith('m-port:'))
  if (portKeys.length === 0 || !byLine.has('m-port')) return
  const generic = byLine.get('m-port')!
  const preferredKey = portKeys[0]!
  const preferred = byLine.get(preferredKey)!
  const mergedEvidence = [
    ...(preferred.evidence ?? []),
    ...(generic.evidence ?? []),
    ...(preferred.text !== generic.text ? [generic.text] : []),
  ].filter((s, i, a) => s && a.indexOf(s) === i)
  byLine.set(preferredKey, {
    ...preferred,
    evidence: mergedEvidence.length ? mergedEvidence : undefined,
    severity:
      (SEV_RANK[generic.severity] ?? 0) > (SEV_RANK[preferred.severity] ?? 0)
        ? generic.severity
        : preferred.severity,
  })
  byLine.delete('m-port')
}

/**
 * Collapse many Mesh party-miss bullets into one cleaner line.
 * Case variants already share lineId via normalizeMeshPartyKey; this folds distinct parties.
 */
function collapseMeshParties(byLine: Map<string, NeedsAttentionItem>): void {
  const partyKeys = [...byLine.keys()].filter((k) => k.startsWith('m-party:'))
  const hasGenericMesh = byLine.has('m-mesh') || byLine.has('m-party')

  // Prefer mixed-case display when case-variants already merged via lineId
  for (const k of partyKeys) {
    const item = byLine.get(k)!
    const quoted = extractMeshDisplayName(item)
    if (!quoted) continue
    // evidence may hold alternate casings from pushUnique
    let best = quoted
    for (const e of item.evidence ?? []) {
      const n = e.match(/"([^"]+)"/)?.[1]?.trim()
      if (n && normalizeMeshPartyKey(n) === normalizeMeshPartyKey(best)) {
        best = preferMeshDisplayName(best, n)
      }
    }
    if (best !== quoted) {
      byLine.set(k, { ...item, text: meshPartyMissText(best) })
    }
  }

  if (partyKeys.length === 0) {
    // only generic mesh lines
    if (byLine.has('m-mesh') && byLine.has('m-party')) byLine.delete('m-party')
    return
  }

  // Fold generic mesh into parties
  if (hasGenericMesh) {
    byLine.delete('m-mesh')
    byLine.delete('m-party')
  }

  const refreshedKeys = [...byLine.keys()].filter((k) => k.startsWith('m-party:'))
  if (refreshedKeys.length <= 1) return

  const names: string[] = []
  let maxSev: NeedsAttentionItem['severity'] = 'low'
  const evidence: string[] = []

  for (const k of refreshedKeys) {
    const item = byLine.get(k)!
    const name = extractMeshDisplayName(item) ?? k.slice('m-party:'.length)
    names.push(name)
    evidence.push(item.text, ...(item.evidence ?? []))
    if ((SEV_RANK[item.severity] ?? 0) > (SEV_RANK[maxSev] ?? 0)) maxSev = item.severity
    byLine.delete(k)
  }

  // Stable alpha order for ops scanning
  names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  const uniqEvidence = [...new Set(evidence.filter(Boolean))]

  // Summary stays short; full list lives in `details` for expand/collapse UI.
  const text = `${names.length} parties not found in Mesh Database — advise add in Mesh.`

  byLine.set(MESH_PARTY_COLLAPSED_LINE_ID, {
    key: 'm-party-collapsed',
    lineId: MESH_PARTY_COLLAPSED_LINE_ID,
    severity: maxSev,
    text,
    category: 'master_miss',
    groupId: 'master_miss',
    evidence: uniqEvidence.length ? uniqEvidence : names,
    details: names,
  })
}

/** UN/LOCODE (5-char) — used to detect that a port slot already auto-matched. */
const LOCODE_RE = /^[A-Z]{2}[A-Z0-9]{3}$/i

/** ISO-3166 alpha-2 codes commonly seen as pol/pod blobs (not exhaustive of world). */
const ISO2_COUNTRY = new Set(
  [
    'US', 'CN', 'HK', 'VN', 'BD', 'KH', 'JP', 'KR', 'TW', 'IN', 'ID', 'TH', 'MY', 'SG', 'PH',
    'AU', 'CA', 'MX', 'GB', 'UK', 'DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'TR', 'AE', 'SA', 'PK',
  ].map((s) => s.toUpperCase()),
)

/** ISO-3166 alpha-3 commonly seen as email tokens. */
const ISO3_COUNTRY = new Set(
  ['USA', 'CHN', 'HKG', 'VNM', 'BGD', 'KHM', 'JPN', 'KOR', 'TWN', 'IND', 'IDN', 'THA', 'MYS', 'SGP', 'PHL', 'AUS', 'CAN', 'MEX', 'GBR', 'DEU', 'FRA', 'ITA', 'ESP', 'NLD', 'BEL', 'TUR'].map(
    (s) => s.toUpperCase(),
  ),
)

/** Lowercase country names / aliases (match after normalize). */
const COUNTRY_NAMES = new Set(
  [
    'usa',
    'united states',
    'united states of america',
    'vietnam',
    'viet nam',
    'china',
    'uk',
    'united kingdom',
    'great britain',
    'hong kong',
    'bangladesh',
    'cambodia',
    'japan',
    'korea',
    'south korea',
    'taiwan',
    'india',
    'indonesia',
    'thailand',
    'malaysia',
    'singapore',
    'philippines',
    'australia',
    'canada',
    'mexico',
    'germany',
    'france',
    'italy',
    'spain',
    'netherlands',
    'belgium',
    'turkey',
  ].map((s) => s.toLowerCase()),
)

/** True when free-text looks like a country name or ISO-2/3 (not a 5-char UN/LOCODE). */
export function looksLikeCountryToken(value: string | null | undefined): boolean {
  if (value == null) return false
  const raw = String(value).trim()
  if (!raw) return false
  // Never treat a resolved LOCODE as a country.
  if (LOCODE_RE.test(raw)) return false
  const upper = raw.toUpperCase()
  if (upper.length === 2 && ISO2_COUNTRY.has(upper)) return true
  if (upper.length === 3 && ISO3_COUNTRY.has(upper)) return true
  const nameKey = raw.replace(/\s+/g, ' ').trim().toLowerCase()
  return COUNTRY_NAMES.has(nameKey)
}

/** Ops-facing line when port raw is country-only. field: 'pol' | 'pod' | null */
export function countryOnlyPortMissText(
  token: string,
  field?: 'pol' | 'pod' | null,
): string {
  const t = token.trim()
  if (field === 'pol') return `Email only named country "${t}" for POL — pick a real port`
  if (field === 'pod') return `Email only named country "${t}" for POD — pick a real port`
  return `Email only named country "${t}" — pick a real port (POL/POD)`
}

/** True when a free-text looks like a resolved LOCODE (e.g. CNYTN, VNSGN). */
export function looksLikeLocode(value: string | null | undefined): boolean {
  return !!value && LOCODE_RE.test(String(value).trim())
}

/**
 * Infer linked ports from a UI route string like "CNYTN→VNSGN" or "CNYTN -> VNSGN".
 * Review-queue rows only carry `route`, not polId/podId.
 */
export function portsLinkedFromRoute(route: string | null | undefined): { pol: boolean; pod: boolean } {
  if (!route?.trim()) return { pol: false, pod: false }
  const parts = route.split(/\s*(?:→|->|—|–)\s*/).map((s) => s.trim()).filter(Boolean)
  return {
    pol: looksLikeLocode(parts[0]),
    pod: looksLikeLocode(parts[1]),
  }
}

/** Port-miss Needs-attention lines (country/city synonyms after LOCODE auto-match). */
function isPortMissLine(hit: { lineId: string; text: string }): boolean {
  if (hit.lineId === 'm-port' || hit.lineId.startsWith('m-port:')) return true
  return (
    /as a port\b/i.test(hit.text) ||
    /UN\/LOCODE/i.test(hit.text) ||
    /not in UN\/LOCODE/i.test(hit.text) ||
    /did not match a known port/i.test(hit.text) ||
    (/not in master data/i.test(hit.text) && /raw value kept|raw kept/i.test(hit.text))
  )
}

/** Weak-identity Needs attention copy — split by whether a PO is known on the card. */
export function weakIdentityText(hasPo: boolean): string {
  return hasPo
    ? 'Only PO known — add booking, SO, or B/L to place this email'
    : 'No booking, SO, B/L, or PO — cannot place this email'
}

/**
 * Flat list of unique short lines (no cap). Prefer {@link buildNeedsAttentionGroups} for UI.
 */
export function buildNeedsAttention(opts: {
  riskFlags?: Array<{ code: string; severity?: string; message?: string }> | null
  reviewReasons?: string[] | null
  conflictsCount: number
  max?: number
  /**
   * When either pol or pod is already LOCODE-linked, drop port-miss flags/reasons
   * (e.g. "Port VIETNAM" / "Ho Chi Minh City" after pod=VNSGN).
   */
  portsLinked?: { pol?: boolean; pod?: boolean } | null
  /** When true, r-no-id uses only-PO copy (card has linked PO numbers). Default false. */
  hasPo?: boolean
}): NeedsAttentionItem[] {
  const tableOwnsConflicts = opts.conflictsCount > 0
  const dropPortMiss = !!(opts.portsLinked?.pol || opts.portsLinked?.pod)
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
    if (dropPortMiss && isPortMissLine(hit)) continue
    const text = hit.lineId === 'r-no-id' ? weakIdentityText(!!opts.hasPo) : hit.text
    pushUnique(byLine, {
      key: `flag-${f.code}-${i}`,
      lineId: hit.lineId,
      severity: (f.severity as 'low' | 'medium' | 'high') || 'medium',
      text,
      category: hit.category,
      groupId: categoryToGroup(hit.category),
      evidence: hit.evidence,
    })
  }

  const reasons = opts.reviewReasons ?? []
  for (const { raw, text } of humanizeReasons(reasons, {
    fieldDetailAvailable: opts.conflictsCount > 0,
  })) {
    const hit = lineFromReason(raw, text)
    if (!hit) continue
    if (hit.category === 'conflict' && tableOwnsConflicts) continue
    if (dropPortMiss && isPortMissLine(hit)) continue
    // Drop reason if a flag already explained that category (and line not more specific)
    if (explained.has(hit.category) && !hit.lineId.startsWith('m-port:') && !hit.lineId.startsWith('m-party:')) {
      // Still allow master detail lines with quoted values when only generic party flag present
      if (hit.category !== 'master_miss' || explained.has('master_miss')) {
        // If same lineId not already from flag, skip category-duplicate generic reasons
        const already = [...byLine.values()].some((x) => x.category === hit.category)
        if (already && !/^m-(port|party):/.test(hit.lineId)) continue
      }
    }
    const lineText = hit.lineId === 'r-no-id' ? weakIdentityText(!!opts.hasPo) : hit.text
    pushUnique(byLine, {
      key: `reason-${raw}`,
      lineId: hit.lineId,
      severity: 'medium',
      text: lineText,
      category: hit.category,
      groupId: categoryToGroup(hit.category),
      evidence: hit.evidence,
    })
  }

  collapseGenericPort(byLine)
  collapseMeshParties(byLine)

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
  portsLinked?: { pol?: boolean; pod?: boolean } | null
  /** When true, r-no-id uses only-PO copy (card has linked PO numbers). Default false. */
  hasPo?: boolean
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
