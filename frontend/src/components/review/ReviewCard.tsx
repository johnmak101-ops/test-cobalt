import { useCallback, useMemo, useState } from 'react'
// Action-bar buttons are text-only — the only icon left in the bar is the busy spinner, which is
// state, not decoration. ExternalLink/Mail still mark the source-email affordances.
import {
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  HelpCircle,
  Info,
  Loader2,
  Mail,
  Forward,
  NotebookPen,
  Search,
  Undo2,
} from 'lucide-react'
import { ReviewBlock } from './ReviewBlock'
import { Badge } from '../ui/Badge'
import {
  ConflictRow,
  changesStoredValue,
  currentValueOf,
  isCandidateResolution,
  proposedValueOf,
  splitCandidates,
} from './ConflictRow'
import { ModeClearRow } from './ModeClearRow'
import {
  fieldUnit,
  groupReviewRows,
  isPortColumn,
  mapCriticFieldToColumn,
  reviewFieldLabel,
  parseStyleEntries,
  serializeStyleEntries,
  dateOrderWarn,
} from '../../lib/review-fields'
import {
  existingQtyDisplay,
  filterActionableConflicts,
  isQtyConflict,
  liveQtyFromShipment,
  poShipmentTotalFromLinked,
} from '../../lib/qty-conflict-settle'
import { isNonIdentifier } from '../../lib/identifier-shape'
import { offModeFieldsOn, type ModeFieldLeg } from '../../lib/mode-fields'
import { legLooksLikeShipment } from '../../lib/leg-shape'
import { isCriticalColumn } from '../../lib/review-critical'
import {
  isMasterDataSource,
  type CriticConflict,
  type CriticReview,
  type CriticReviewCompact,
} from '../../lib/critic-review'
import { CandidateLegsPanel } from './CandidateLegsPanel'
import { SharedPoPanel, type SharedPoAnswer, type SharedPoEdit } from './SharedPoPanel'
import { EvidencePanel } from './EvidencePanel'
import { ReviewPoStylesSection, alsoSeenStyleForPo } from './ReviewPoStylesSection'
import type { PoStylePlan } from '../../lib/po-style-plan'
import {
  useUpdatePurchaseOrder,
  useUnlinkShipmentFromPO,
  useUpdateShipmentPoLink,
} from '../../hooks/use-purchase-orders'
import type { ReviewShipment } from '../../hooks/use-review-queue'
import type { LinkedPO, ShipmentDetail } from '../../hooks/use-shipments'
import { cn, formatDateTime } from '../../lib/utils'
import { parseSender } from '../../lib/email-sender'
import {
  buildNeedsAttentionGroups,
  isExpandableMiss,
  portsLinkedFromRoute,
  type NeedsAttentionGroup,
  type NeedsAttentionItem,
} from './needs-attention'
import {
  NO_CHANGE_VERDICT,
  candidateDeskQuestion,
  conflictDeskQuestion,
  forWorkingCard,
  pickDeskQuestion,
} from './desk-question'
import { NeedsAttentionMeshMiss } from './NeedsAttentionMeshMiss'
import type { PartyMaster } from '../../hooks/use-parties'
import { mastersNaming } from '../../lib/party-names'
import {
  REVIEW_COL,
  REVIEW_FS,
  REVIEW_GROUP_HEADER,
  REVIEW_HEAD,
  REVIEW_PANEL_DOT,
  REVIEW_PANEL_ITEM,
  REVIEW_PANEL_LIST,
  REVIEW_TABLE_CLASS,
  REVIEW_TH,
} from './review-table-layout'
import { ReviewColGroup } from './ReviewColGroup'
import { meshMissText } from '../../lib/review-reasons'

/**
 * ONE geometry for every button in the card's action bar; variants change COLOUR only, never size,
 * padding or radius. The bar drifted precisely because each button hand-rolled its own class list.
 * Weight reads as intent: solid = the committing action, tinted = everything else.
 */
// The base sets `border` (WIDTH only) — so EVERY variant below MUST name a border colour. Tailwind
// v4 defaults border-color to currentColor, so an omission renders a hard full-strength outline
// rather than nothing (the bug Badge.emailTypeStyles had). Tints follow the Badge convention:
// a /30 border over a /15 fill; the solid primary borders in its own colour so all three match height.
const ACTION_BTN =
  'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50'
const ACTION_VARIANT = {
  primary:
    'border-cobalt-primary bg-cobalt-primary text-white hover:border-cobalt-primary-light hover:bg-cobalt-primary-light',
  secondary: 'border-cobalt-primary/30 bg-cobalt-primary/15 text-cobalt-primary-light hover:bg-cobalt-primary/25',
  danger: 'border-status-critical/30 bg-status-critical/15 text-status-critical hover:bg-status-critical/25',
  success: 'border-status-success/30 bg-status-success/15 text-status-success hover:bg-status-success/25',
  /**
   * The OTHER verdict — closes the leg without writing anything. Real weight (solid fill, primary
   * text) so it never gets mistaken for the deferral sitting next to it, but no hue of its own so it
   * never competes with the primary. It used to be `success` green, which made the bar carry two
   * equally loud verdicts whose labels both talked about field values and neither of which mentioned
   * that the leg leaves the desk.
   */
  neutral: 'border-border-light bg-surface-700 text-text-primary hover:bg-surface-600',
  /** Neither a verdict nor a navigation — deferral. Lowest weight in the bar by design. */
  quiet: 'border-border bg-transparent text-text-secondary hover:bg-surface-700 hover:text-text-primary',
} as const

/** What the operator decided about ONE contested field — the unit the learner trains on (ADR-0002). */
export interface ReviewCorrection {
  field: string
  /** What ShipTrack already stored ('' when the field was empty). */
  existing: string
  /** What the agent proposed ('' when it offered nothing). */
  aiProposed: string
  /** What the operator committed. Equal to aiProposed = confirmation; different = correction. */
  humanFinal: string
}

export interface ReviewCardSavePayload {
  fields: Record<string, unknown>
  /**
   * Leg columns the operator ruled to LEAVE AS THEY ARE — carried apart from `fields` on purpose.
   *
   * `fields` means "write this"; these mean "do not write, but record that I ruled". The backend
   * locks each at the value the leg already holds, so the ruling shows up in Change History and a
   * later email that disagrees surfaces as CONTESTED instead of passing silently.
   */
  keep?: string[]
  note: string
  /** Per-field decision trail. Additive: consumers that ignore it keep working. */
  corrections?: ReviewCorrection[]
  expectedUpdatedAt?: string
}

/** One source email of the leg — enough to open the reading-pane pop-up. */
export type ReviewEmail = {
  /** Null when shipment_emails is orphaned (email_message wiped). */
  id: string | null
  /** The queue attributes conflict candidates by this, not by our uuid — used to match a proposed
   *  value back to the email that stated it. */
  graphMessageId?: string | null
  subject: string
  sender: string | null
  receivedAt?: string | null
  emailType?: string | null
  bodyMissing?: boolean
}

/** Result of typing a strong ID on a zero-identity leg (POST /review/:id/identify). */
export type IdentifyResult =
  | { outcome: 'set'; field: string; value: string }
  | { outcome: 'candidate'; candidate: { shipmentId: string; jobNo: string; matchedValue: string } }
  | { outcome: 'ambiguous'; count: number }

export interface ReviewCardProps {
  shipment: ReviewShipment | ShipmentDetail
  criticReview: CriticReview | null
  /** Queue-safe projection for AI comment when full payload is absent. */
  compact?: CriticReviewCompact | null
  /** Source emails behind this leg — rendered as chips that open the email pop-up window.
   *  Resolving a conflict means reading what the email actually said, so keep it one click away. */
  emails?: ReviewEmail[]
  defaultExpanded?: boolean
  /**
   * Rendered inside a queue table row that ALREADY states band/customer/booking/route/status and
   * owns the expand chevron. Drops this card's own identity header (it read as the same leg listed
   * twice) and its frame, so the detail reads as one continuous panel with the row above it.
   */
  embedded?: boolean
  /** Resolved history — hide inputs and primary actions. */
  readOnly?: boolean
  onSaveAndApprove?: (payload: ReviewCardSavePayload) => Promise<void>
  onApprove?: () => Promise<void>
  /**
   * "No" — this leg is not a trackable shipment. The desk had no such button: the endpoint existed but
   * only bulk-select on the queue list reached it, so a card asking "verify it belongs in tracking"
   * could not take the answer "it doesn't". Rendered only when the leading question is one that a
   * rejection actually answers (DeskQuestion.reject).
   */
  onReject?: (note?: string) => Promise<void>
  /**
   * "Not yet" — park the leg off the active desk pending an outside answer. The third honest outcome:
   * without it, a leg whose answer lived in someone else's inbox either sat in Active forever or got
   * rejected as noise.
   */
  onWait?: (reason?: string) => Promise<void>
  /** Zero-identity flow: type booking/SO/B/L and detect if it already exists elsewhere. */
  onIdentify?: (field: string, value: string) => Promise<IdentifyResult>
  /**
   * Multi-candidate / identify: fold provisional into target and optionally apply field patches
   * to the **target**. Called only from the final Link & apply / Link without field changes CTA.
   */
  onLink?: (
    targetShipmentId: string,
    payload?: { fields?: Record<string, unknown>; note?: string },
  ) => Promise<void>
  /**
   * The Mesh party mirror (customers + vendors + forwarders, in one list). Lets a master-miss line
   * tell "this company is absent from Mesh" from "Mesh holds five of it under longer names" — two
   * situations whose correct operator actions are opposites. Omitted keeps the old copy.
   */
  partyMasters?: PartyMaster[]
}

function nameOf(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'name' in value) {
    const n = (value as { name?: unknown }).name
    return typeof n === 'string' ? n : null
  }
  return null
}

function identityOf(s: ReviewShipment | ShipmentDetail) {
  const asQueue = s as ReviewShipment
  const asDetail = s as ShipmentDetail
  return {
    customer: nameOf(asQueue.customer ?? asDetail.customer),
    forwarder: nameOf(asQueue.forwarder ?? asDetail.forwarder),
    booking: s.bookingNo ?? asQueue.soNo ?? asDetail.soNumber ?? null,
    route: s.route,
    status: s.status,
    updatedAt: s.updatedAt,
  }
}

/**
 * What every contested row holds before the operator has decided anything: the value the leg ALREADY
 * stores.
 *
 * It used to be the agent's proposal, so a card opened reading `Apply 2026-09-09` — one press from
 * overwriting a value the pipeline had examined and declined. That is not a display quirk: the rows
 * that reach this table are exactly the ones the commit did NOT settle (`openDecisions` strips the
 * rest), so the email's value is one the committer read and refused to write. Seeding the refusal as
 * the default made the desk's safest answer the one requiring the most clicks.
 *
 * The cost, accepted knowingly: one extra click on every leg where the agent is right — the take-tick
 * on the row (see ConflictRow). The trade is a deliberate act instead of a default.
 *
 * `keepValue` is the card's `existingValue`, threaded in rather than re-derived: it reads the LIVE
 * leg (openDecisions.liveValues), which this module cannot see from a bare conflict.
 */
function initialResolutions(
  conflicts: CriticConflict[],
  keepValue: (c: CriticConflict) => string,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const c of conflicts) out[c.field] = keepValue(c)
  return out
}

/**
 * Collapsible critic review card — band + identity when collapsed; needs-attention +
 * conflict-only table, notes, and Save&Approve when expanded.
 */
/** Open the source email in the chrome-less reading-pane pop-up (same window target + geometry as
 *  the shipment history timeline, so a reviewer can read the original side-by-side). */
function openEmailWindow(e: ReviewEmail): void {
  if (e.id == null || e.bodyMissing) return
  window.open(
    `/email/${e.id}?type=${encodeURIComponent(e.emailType ?? '')}`,
    `email_${e.id}`,
    'popup,width=880,height=940,resizable=yes,scrollbars=yes',
  )
}

const EMPTY_EMAILS: ReviewEmail[] = []

/** Identity types in the words an operator uses for them. */
const FIELD_WORD: Record<string, string> = {
  hbl_awb_fcr_no: 'B/L',
  booking_no: 'booking number',
  mbl: 'MBL',
  container_no: 'container',
  so_no: 'SO',
}

/** Leg columns that are supposed to hold a shipment identifier — checked for header-row junk. */
const LEG_IDENTIFIER_FIELDS = [
  { field: 'soNumber', label: 'SO number' },
  { field: 'bookingNo', label: 'booking number' },
  { field: 'hblNumber', label: 'B/L number' },
] as const

/**
 * The secondary needs-attention lines, grouped.
 *
 * Shared by the two blocks that show them — "Also" inside the question (things still to decide) and
 * "For information" (things this desk cannot act on). One renderer so the two never drift into
 * looking like different kinds of list, which is the whole point of the shell.
 *
 * Grouping is real and ordered; the TITLE is earned rather than automatic. One or two lines read fine
 * bare — the item text names its own subject ("Customer not in master — …") and a title per bullet
 * was pure nesting. Past three the bare list turns into a blob, so the titles come back.
 */
function renderRestGroups(groups: NeedsAttentionGroup[], withTitles: boolean) {
  return (
    <div className="space-y-1">
      {groups.map((g) => (
        <div key={g.groupId} data-testid={`needs-group-${g.groupId}`} aria-label={g.title}>
          {withTitles && (
            <p className={`${REVIEW_FS.meta} font-semibold text-text-secondary`}>{g.title}</p>
          )}
          <ul className={REVIEW_PANEL_LIST}>
            {g.items.map((r) =>
              isExpandableMiss(r) ? (
                <NeedsAttentionMeshMiss key={r.key} item={r} />
              ) : (
                <li
                  key={r.key}
                  className={REVIEW_PANEL_ITEM}
                  title={r.evidence?.join(' · ') || undefined}
                >
                  <span
                    className={cn(
                      REVIEW_PANEL_DOT,
                      r.severity === 'high'
                        ? 'bg-status-critical'
                        : r.severity === 'medium'
                          ? 'bg-status-warning'
                          : 'bg-surface-600',
                    )}
                  />
                  <span className="min-w-0">{r.text}</span>
                </li>
              ),
            )}
          </ul>
        </div>
      ))}
    </div>
  )
}

/**
 * A line this desk can state but not act on.
 *
 * `tagDesk` classes a NAMED Mesh party miss as a decision because ops CAN add that master — but not
 * from here: masters are ERP-owned and read-only in this app, which is why the Resolution Rules UI
 * was removed. `"TCI" has no near match in database` is a finding to pass on, not a question, and
 * sitting in the decision list it read as one more thing to settle on a card that could not settle
 * it.
 *
 * A miss that OFFERS MASTERS TO PICK is the opposite — picking one is a real action on this card.
 * That, specifically, is where the line falls: `meshCandidates`, not `isExpandableMiss`.
 *
 * The two are not the same and the difference showed. `isExpandableMiss` is also true of a merely
 * COLLAPSED miss, whose expansion is a list of names and nothing else — so `2 parties have no near
 * match in database · Show 2 names` counted as a decision, sat under "Also" inside a `needs answer`
 * box, and expanded to reveal… two names. Nothing to pick, nothing to press.
 */
function isInfoOnlyLine(i: NeedsAttentionItem): boolean {
  if (i.groupId !== 'master_miss' && !i.lineId.startsWith('m-')) return false
  return Object.keys(i.meshCandidates ?? {}).length === 0
}

export function ReviewCard({
  shipment,
  criticReview,
  compact = null,
  emails = EMPTY_EMAILS,
  defaultExpanded = false,
  embedded = false,
  readOnly = false,
  onSaveAndApprove,
  onApprove,
  onReject,
  onWait,
  onIdentify,
  onLink,
  partyMasters,
}: ReviewCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const isWeakIdentity = (criticReview?.riskFlags ?? []).some((f) => f.code === 'WEAK_IDENTITY')
  // #129: closed-set candidates from matcher (preferred over free-type Identify when present)
  const matchAmbiguity = criticReview?.matchAmbiguity
  /**
   * The leg as a bag of columns. A queue-list row simply does not carry most of them, which reads as
   * "no live value to compare against" — the safe direction everywhere it is used. The queue's expanded
   * panel and the focused page both pass the full detail.
   */
  const legValues = useMemo(() => shipment as unknown as Record<string, unknown>, [shipment])
  /**
   * What the COMMITTER did (migration 0027) — the only sound answer to "is identity settled?".
   *
   * This replaces an inference that was circular: it compared the email's HBL against the leg's HBL,
   * but when the committer CREATES a leg from an email the leg carries that HBL *because this email
   * wrote it*. The test was guaranteed true for every created leg and proved nothing — and it fired on
   * exactly those, hiding the picker where the question was real. 179 of 181 active legs are created.
   *
   * `matched` / `adopted_zero_id` mean an existing leg absorbed the fields, so the queue's candidate
   * list is moot. Anything else — including a NULL on legs committed before 0027 — leaves the picker up.
   */
  const committerAction = (shipment as { committerAction?: string | null }).committerAction ?? null
  /** Escape hatch: suppressing a control on the committer's word still needs a way back. */
  const [pinOverridden, setPinOverridden] = useState(false)
  const identityPinned =
    !pinOverridden && (committerAction === 'matched' || committerAction === 'adopted_zero_id')
  const isAmbiguousMatch =
    !identityPinned && (criticReview?.riskFlags ?? []).some((f) => f.code === 'AMBIGUOUS_MATCH')
  const hasCandidateLegs = !identityPinned && (matchAmbiguity?.candidates?.length ?? 0) >= 2
  // Identify/link: weak-identity fold OR ambiguous-match (which real shipment?) — #146
  // Still show Identify when ambiguous but no candidate payload (legacy legs) or as fallback under panel
  /**
   * The operator answered "no, wrong shipment" to a which-shipment question that had no picker —
   * so the search that finds the right one is what "no" means, and it opens on demand.
   */
  const [wrongShipment, setWrongShipment] = useState(false)
  const showIdentify =
    !readOnly && !!onIdentify && (isWeakIdentity || isAmbiguousMatch || wrongShipment)
  const [identField, setIdentField] = useState<'booking_no' | 'so_no' | 'hbl_awb_fcr_no'>('booking_no')
  const [identValue, setIdentValue] = useState('')
  const [identResult, setIdentResult] = useState<IdentifyResult | null>(null)
  const [identBusy, setIdentBusy] = useState(false)
  /** Multi-candidate target — must pick before Link & apply. */
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null)
  const shipmentId = (shipment as { id?: string }).id
  /**
   * The Mesh mirror arrives as a PROP, never a hook. ReviewCard has 134 tests that render it bare,
   * and a useQuery inside it fails every one of them with "No QueryClient set" — the same trap
   * usePorts sprang here once already. The page owns the data layer; this component stays
   * renderable from a test with a plain object.
   */
  const allMasters = useMemo(() => partyMasters ?? [], [partyMasters])
  const masterNames = useMemo(() => allMasters.map((p) => p.name).filter(Boolean), [allMasters])
  /**
   * Link a raw party name to the Mesh master the operator chose.
   *
   * The COLUMN is found by matching the name against the leg's own raw twins rather than parsed out
   * of the miss text: the queue files these against the wrong slot often enough (a VENDOR under
   * Forwarder on leg 202601DD8E) that reading the slot would write the pick to the wrong field.
   * Whichever twin actually holds this string is the field the operator is looking at.
   *
   * Customer/Vendor store the master CODE and Forwarder the NAME — the same split PartyPicker makes,
   * for the same reason: those read views print a code, and forwarder codes are ERP sequence numbers.
   * The write goes through the ordinary human-edit PATCH, so it resolves the FK, locks the field and
   * lands in Change History exactly as typing it would.
   */
  const linkTargetReady =
    !!selectedTargetId && selectedTargetId !== shipmentId

  /** Detail DTO carries membership; queue list rows do not. */
  const linkedPOs: LinkedPO[] = useMemo(() => {
    if ('linkedPOs' in shipment && Array.isArray(shipment.linkedPOs)) {
      return shipment.linkedPOs
    }
    return []
  }, [shipment])
  /** Memoized: the `?? []` mints a fresh array every render, re-running every memo keyed on it. */
  const reviewReasons = useMemo(
    () => (shipment as { reviewReasons?: string[] | null }).reviewReasons ?? [],
    [shipment],
  )

  /**
   * Unlinked parties that name masters Mesh ALREADY HOLDS, as conflict rows.
   *
   * `forwarder_name "LOGWIN" did not exact-match a master` is a true statement about the lookup and
   * a false one about Mesh, which has five LOGWIN companies. The icon was right — the FK is null and
   * WHICH branch shipped this is a real question — but a review reason is prose, not a decision, so
   * there was nowhere to answer it. It briefly lived as a bespoke picker in Needs attention; a row
   * here instead gives it the machinery every other field decision already has: the master picker,
   * Current seeded from the leg, the note requirement, and staging into Save & Approve rather than a
   * widget that wrote on click. Same reason the party-MISMATCH rows are synthesised server-side
   * (backend party-mismatch-conflict.ts).
   *
   * Client-side because the matching lives here: `mastersNaming` and the company-name predicate it
   * uses are frontend modules, and porting them across the package boundary would put a second copy
   * of "are these two names one company?" in the tree — the drift class the format-gate contract test
   * exists to police. The mirror is already loaded for the pickers.
   *
   * Nothing is resolved: the LLM matcher still owns fuzzy, the FK stays unlinked until a human picks,
   * and a party with no candidates yields no row and keeps its (correct) "add in Mesh" advice.
   */
  const unlinkedPartyConflicts = useMemo(() => {
    const masters = partyMasters ?? []
    if (!masters.length) return []
    const leg = shipment as unknown as Record<string, unknown>
    const SLOTS = [
      { column: 'forwarderRaw', linked: 'forwarderId', field: 'forwarder_name', label: 'Forwarder' },
      { column: 'customerRaw', linked: 'customerId', field: 'customer_code', label: 'Customer Code' },
      { column: 'vendorRaw', linked: 'vendorId', field: 'vendor_code', label: 'Vendor Code' },
    ] as const
    const rows: CriticConflict[] = []
    for (const slot of SLOTS) {
      const raw = String(leg[slot.column] ?? '').trim()
      if (!raw) continue
      // A slot the critic already contests carries the email's own candidates — a second row would
      // ask one question twice with different options.
      if ((criticReview?.conflicts ?? []).some((c) => c.field === slot.field)) continue
      // Already linked ⇒ nothing to choose. Read the FK, which is the only thing that actually says
      // so. This was an exact-NAME test, on the assumption that a raw value spelled exactly like a
      // master must have linked — and leg 202607B738 disproves it: `vendor_raw` is
      // "MACAU FUNG TAI LIMITED", the Mesh master is "MACAU FUNG TAI LIMITED", and `vendor_id` is
      // NULL. The one party that most obviously needed one click got no row at all.
      if (leg[slot.linked] != null) continue
      const hits = mastersNaming(raw, masters.map((m) => m.name))
      if (!hits.length) continue
      /**
       * A row has to present a CHOICE. One candidate spelled exactly like the stored value is not
       * one: leg 202607B738 rendered "MACAU FUNG TAI LIMITED" against "MACAU FUNG TAI LIMITED" under
       * "Which Vendor Code is correct?", and the only thing that actually differed — a null FK — is
       * invisible in a comparison of two strings. The operator is asked to weigh identical text.
       *
       * That is a lookup that half-ran, not a decision, and it keeps its Needs attention line ("in
       * Mesh, not linked") until it gets an affordance built for it. A single candidate that READS
       * differently (raw "WYSE" vs master "WYSE LONDON LIMITED") is still a real choice and still
       * gets a row.
       */
      if (hits.length === 1 && hits[0]!.trim().toUpperCase() === raw.toUpperCase()) continue
      const picks = hits
        .map((name) => masters.find((m) => m.name === name))
        .filter((m): m is PartyMaster => !!m)
      rows.push({
        field: slot.field,
        label: slot.label,
        candidates: picks.map((m) => ({
          value: m.name,
          source: 'Master data',
          // `resolutionValueOf` posts `master.code` when it is set and falls back to `value`, so an
          // EMPTY code is what makes a forwarder post its NAME — its codes are ERP sequence numbers,
          // the same code/name split PartyPicker makes. Emptying the code rather than nulling
          // `master`: ConflictRow renders "not in Mesh" on `master === null`, so nulling it stamped
          // that tag on all five Mesh masters — the exact falsehood this row exists to end.
          master: {
            code: slot.field === 'forwarder_name' ? '' : (m.code ?? ''),
            name: m.name,
          },
        })),
        rationale:
          picks.length === 1
            ? `The emails say "${raw}", which is ${picks[0]!.name} in Mesh — not linked yet. Confirm it.`
            : `The emails say "${raw}". Mesh has ${picks.length} companies of that name and none is written exactly that way — pick the right one.`,
      } as CriticConflict)
    }
    return rows
  }, [partyMasters, shipment, criticReview])
  const rawConflicts = useMemo(
    () => [...(criticReview?.conflicts ?? []), ...unlinkedPartyConflicts],
    [criticReview, unlinkedPartyConflicts],
  )
  const liveQty = useMemo(
    () => liveQtyFromShipment(shipment as { quantityShipped?: number | null }),
    [shipment],
  )
  const poShipmentTotal = useMemo(
    () => poShipmentTotalFromLinked(linkedPOs),
    [linkedPOs],
  )
  /**
   * Bag-level item/style, gross weight, measurement, and HTS are hidden from Order Details — also
   * hide from this conflict table. Per-PO styles live on ReviewPoStylesSection / the PO card.
   * Qty conflicts that already match the live leg (or PO shipment total) are settled and dropped.
   */
  const deskConflicts = useMemo(
    () =>
      rawConflicts.filter((c) => {
        const col = mapCriticFieldToColumn(c.field) ?? c.field
        return (
          col !== 'itemStyleNo' &&
          col !== 'grossWeight' &&
          col !== 'measurement' &&
          col !== 'htsCode'
        )
      }),
    [rawConflicts],
  )
  /**
   * Rows whose every offered value the leg ALREADY stores are not decisions — see conflict-applied.ts.
   * Commit-first means the committer writes an email's values and the critic snapshot describing the
   * "disagreement" predates that write, so the desk was asking questions it had itself already closed:
   * 41 of 41 checkable rows on the dev queue were in that state. They move out of the grid and into one
   * quiet line, still openable, because "the email agreed with us" is worth being able to verify.
   */
  /**
   * Which rows the leg already satisfies is the BACKEND's answer now (presentation/open-decisions.ts),
   * not something re-derived here. It is the only place that holds both the advice and the leg, and
   * the frontend had grown six separate re-derivations of the same idea — one per symptom.
   *
   * Absent (a queue row from before this shipped, or a leg with no critic payload) means "nothing
   * known to be settled", which leaves every row on the desk — the safe direction.
   */
  const openDecisions = (shipment as {
    openDecisions?: { settledFields?: string[]; liveValues?: Record<string, string> } | null
  }).openDecisions
  const settledFields = useMemo(() => new Set(openDecisions?.settledFields ?? []), [openDecisions])
  /** What the leg stores per contested field — the Current column, instead of the pre-commit snapshot. */
  /**
   * `openDecisions.liveValues` is computed server-side, so it has no entry for a row synthesised
   * here — and a missing entry renders Current EMPTY and offers "Leave Blank" over a leg that
   * plainly stores LOGWIN. presentation.service hit the identical trap when it added the party
   * mismatch row late. Seed the raw twin for each synthetic field.
   */
  const liveValues = useMemo(() => {
    const base = openDecisions?.liveValues ?? {}
    if (!unlinkedPartyConflicts.length) return base
    const leg = shipment as unknown as Record<string, unknown>
    const COLUMN_BY_FIELD: Record<string, string> = {
      forwarder_name: 'forwarderRaw',
      customer_code: 'customerRaw',
      vendor_code: 'vendorRaw',
    }
    const seeded: Record<string, string | null> = { ...base }
    for (const c of unlinkedPartyConflicts) {
      const col = COLUMN_BY_FIELD[c.field]
      if (col && seeded[c.field] == null) seeded[c.field] = String(leg[col] ?? '') || null
    }
    return seeded
  }, [openDecisions, unlinkedPartyConflicts, shipment])
  /**
   * The stored value for one contested row, in the form the Current column prints it. qty settles
   * against the leg's shipped figure rather than a keyed column, so it has its own reader.
   */
  const liveValueFor = useCallback(
    (c: CriticConflict): string | null =>
      isQtyConflict(c) ? existingQtyDisplay(c, liveQty) : (liveValues[c.field] ?? null),
    [liveValues, liveQty],
  )
  /**
   * What this leg stores for a contested field. Every decision on the card — changeCount,
   * fieldsToApply, overrides, keepMeansBlank — must read through here, or the desk compares against
   * a value it is not showing (see currentValueOf in ConflictRow).
   */
  const existingValue = useCallback(
    (c: CriticConflict): string => currentValueOf(c, liveValueFor(c)),
    [liveValueFor],
  )
  const { open: unapplied, applied: appliedConflicts } = useMemo(() => {
    const open: CriticConflict[] = []
    const applied: CriticConflict[] = []
    for (const c of deskConflicts) (settledFields.has(c.field) ? applied : open).push(c)
    return { open, applied }
  }, [deskConflicts, settledFields])
  const conflicts = useMemo(
    () => filterActionableConflicts(unapplied, { liveQty, poShipmentTotal }),
    [unapplied, liveQty, poShipmentTotal],
  )
  /**
   * What the conflict TABLE speaks for: rows still open, plus the rows it resolved into the
   * already-applied line.
   *
   * Needs-attention suppresses its conflict-class prose ("6 field(s) disagree — see conflict table")
   * when the table owns the comparison. Feeding it the OPEN count regressed that the moment settling
   * emptied the table: the count fell to 0, the prose came back, and the card pointed the operator at
   * a table that no longer existed while a green line beside it said those fields already agreed.
   * Resolved is not the same as never-ours.
   */
  const tableOwnedCount = conflicts.length + appliedConflicts.length
  /** Operator asked to see the settled rows. */
  /** Threshold at which the "Also" list stops reading as a list and starts reading as a blob. */
  const ALSO_TITLE_THRESHOLD = 3
  /** Newest first: "which statement is the latest?" is the question a reviewer actually has, and a
   *  date they must compare by hand only half-answers it. Undated mail sorts last, not first. */
  const sortedEmails = useMemo(
    () =>
      [...emails].sort(
        (a, b) => (b.receivedAt ? Date.parse(b.receivedAt) : 0) - (a.receivedAt ? Date.parse(a.receivedAt) : 0),
      ),
    [emails],
  )
  // Needs attention — layman groups (design 2026-07-17). Field diffs live in the table when present.
  const hasPo = linkedPOs.some((p) => String(p.poNumber ?? '').trim().length > 0)
  /**
   * Party slots this leg has actually LINKED to a master — used to drop miss lines that outlived the
   * resolution they describe (see PartiesLinked).
   *
   * The master ID is required, not just a name. The queue DTO maps `forwarder` to
   * `forwarderName ?? forwarderRaw`, so a name alone proves nothing: an unresolved forwarder still
   * yields a string, and trusting it would suppress a real miss. No id → treated as unlinked, which is
   * the safe direction. Queue-list rows carry no ids at all, so nothing drops there; the focused page
   * and the queue's expanded panel both pass the full detail.
   */
  const partiesLinked = useMemo(() => {
    const resolved =
      (shipment as { openDecisions?: { resolvedParties?: { slot: string; name: string }[] } })
        .openDecisions?.resolvedParties ?? []
    const out: Record<string, string> = {}
    for (const p of resolved) out[p.slot] = p.name
    return out
  }, [shipment])

  /**
   * Fields the leg holds that contradict its own mode. Read off the LEG, not off the email — a queue
   * row carries mode/vessel/flight, so this works on both the list and the focused page. Nothing here
   * writes: the desk states the contradiction and Open Shipment resolves it.
   */
  const offModeFields = useMemo(
    () => offModeFieldsOn(shipment as ModeFieldLeg),
    [shipment],
  )

  const needsAttentionGroups = useMemo(
    () =>
      buildNeedsAttentionGroups({
        riskFlags: criticReview?.riskFlags,
        reviewReasons,
        conflictsCount: tableOwnedCount,
        masterNames,
        identityPinned,
        partiesLinked,
        portsLinked: portsLinkedFromRoute((shipment as { route?: string | null }).route),
        hasPo,
        offModeFields,
        // Rule A: Review desk shows decision items only; FYI stays on shipment detail.
        desk: 'decision',
      }),
    [criticReview, reviewReasons, shipment, tableOwnedCount, hasPo, linkedPOs, identityPinned, partiesLinked, offModeFields, masterNames],
  )

  /**
   * Does any PO on this leg actually need a DECISION?
   *
   * The decision grid used to render for EVERY linked PO, so a leg whose only open question was
   * elsewhere (a Mesh party miss, say) still showed a four-column decision table with one PO row and
   * three empty decision cells — restating the shipment's own PO card and reading as "something is
   * wrong with this PO" when nothing was.
   *
   * A PO earns the grid when the agent proposed a different item/style for it, or when a
   * needs-attention line is about the PO LINK itself (w-po-*: matched by PO alone, PO already on
   * another shipment, thin mail matched by PO). Otherwise the POs leave the review desk entirely —
   * not collapsed, not summarised: the leg's POs are the shipment page's job, and this desk shows
   * only what needs an answer. Edit mode does not reopen them (see `showPos`): Open Shipment is one
   * click away for everything else.
   */
  const poProposalCount = useMemo(
    () =>
      linkedPOs.filter(
        (p) => alsoSeenStyleForPo(p.poNumber, reviewReasons, p.itemStyleNo) != null,
      ).length,
    [linkedPOs, reviewReasons],
  )
  /**
   * ONLY a proposal earns the PO grid.
   *
   * It used to also fire on a PO-LINK question (w-po-*: "this PO is already on another shipment"),
   * which put a table of Item/Style columns on the card — a style editor answers nothing about which
   * shipment a PO belongs on, and every row read `—`. That question now has its own answer above
   * (SharedPoPanel), with the other leg named and linked, so the grid has no reason to appear for it.
   *
   * Nor does edit mode open it — this is the ONLY gate, in view and edit alike (see `showPos`).
   */
  /**
   * PO style lists the ticks would rewrite. Computed by ReviewPoStylesSection, applied HERE — the
   * primary button is what names the count and what the operator presses, so the write belongs on
   * the same click. A section that saved on its own would have changed the PO while the bar still
   * read "No Changes".
   */
  const [poPlans, setPoPlans] = useState<PoStylePlan[]>([])
  const updatePo = useUpdatePurchaseOrder()
  const poNeedsReview = poProposalCount > 0
  /**
   * Legs that also carry one of this leg's POs (backend `sharedPos`). Present only on the detail
   * payload — a queue row carries none, and then the panel simply does not render, which is the same
   * behaviour as before the reference existed.
   */
  const sharedPoGroups = useMemo(
    () =>
      ((shipment as Partial<ShipmentDetail>).sharedPos ?? []).filter(
        (g) => g.others.length > 0,
      ),
    [shipment],
  )

  /**
   * The operator's answer to each shared PO ("split" / "remove"), and the write that answer implies.
   *
   * The panel used to end on a question and offer nothing, so an operator who concluded the PO was
   * mis-linked had no click that said so — the honest move was `Waiting`, and the leg parked forever.
   * The decision is recorded here and committed by the primary button, alongside the field edits and
   * the PO style plans, because one leg leaving the desk should be one commit.
   */
  const [sharedPoAnswers, setSharedPoAnswers] = useState<Record<string, SharedPoAnswer>>({})
  /** PO number → the link row this card would delete. Absent for a PO the payload cannot identify. */
  const poLinkByNumber = useMemo(() => {
    const map = new Map<string, { poId: string; linkId: string }>()
    for (const p of linkedPOs) {
      const num = String(p.poNumber ?? '').trim()
      const linkId = String(p.linkId ?? '').trim()
      if (num !== '' && linkId !== '' && p.id) map.set(num, { poId: p.id, linkId })
    }
    return map
  }, [linkedPOs])
  /** Which shared POs can be offered a "remove" at all — a choice we cannot write is not a choice. */
  const sharedPoRemovable = useMemo(
    () =>
      Object.fromEntries(
        sharedPoGroups.map((g) => [g.poNumber, poLinkByNumber.has(g.poNumber)] as const),
      ),
    [sharedPoGroups, poLinkByNumber],
  )
  /** Answered "does not belong here" AND writable — what the primary button will actually unlink. */
  const sharedPoRemovals = useMemo(
    () =>
      sharedPoGroups
        .filter((g) => sharedPoAnswers[g.poNumber] === 'remove')
        .map((g) => ({ poNumber: g.poNumber, ...poLinkByNumber.get(g.poNumber)! }))
        .filter((r) => r.linkId != null),
    [sharedPoGroups, sharedPoAnswers, poLinkByNumber],
  )
  const sharedPoSplits = useMemo(
    () => sharedPoGroups.filter((g) => sharedPoAnswers[g.poNumber] === 'split').length,
    [sharedPoGroups, sharedPoAnswers],
  )

  /**
   * Corrections typed onto this leg's own line of a shared PO — the PO number, the quantity, the unit.
   *
   * Radios alone were too narrow an answer: what the desk reaches for first is usually to FIX the
   * line (the parser read cartons as pieces) and then say it belongs, and until now that meant
   * leaving the review desk for the shipment page. Held here rather than in the panel because the
   * write rides the card's primary button with everything else.
   */
  const [sharedPoEdits, setSharedPoEdits] = useState<Record<string, SharedPoEdit>>({})
  /**
   * What the typed corrections actually CHANGE, against what the leg stores. A field the operator
   * clicked into and left alone is not an edit, and a "correct" answer with nothing different under
   * it writes nothing — it is then just a confirmation, which is the truthful outcome.
   */
  const sharedPoCorrections = useMemo(() => {
    return sharedPoGroups.flatMap((g) => {
      if (sharedPoAnswers[g.poNumber] !== 'correct') return []
      const link = poLinkByNumber.get(g.poNumber)
      if (!link) return []
      const e = sharedPoEdits[g.poNumber] ?? {}
      const poNumber = e.poNumber?.trim()
      const qtyRaw = e.qty?.trim()
      const unit = e.qtyUnit?.trim()
      const nextQty = qtyRaw == null ? undefined : qtyRaw === '' ? null : Number(qtyRaw)
      const out: {
        poNumber: string
        poId: string
        linkId: string
        renameTo?: string
        quantity?: number | null
        quantityUnit?: string | null
      } = { poNumber: g.poNumber, ...link }
      let touched = false
      if (poNumber != null && poNumber !== '' && poNumber !== g.poNumber) {
        out.renameTo = poNumber
        touched = true
      }
      // NaN is a typo, not a clear — dropped rather than written, and the row keeps what it had.
      if (nextQty !== undefined && !(typeof nextQty === 'number' && Number.isNaN(nextQty))) {
        if (nextQty !== (g.legQty ?? null)) {
          out.quantity = nextQty
          touched = true
        }
      }
      if (unit != null && unit !== (g.legQtyUnit ?? '').trim()) {
        out.quantityUnit = unit === '' ? null : unit
        touched = true
      }
      return touched ? [out] : []
    })
  }, [sharedPoGroups, sharedPoAnswers, sharedPoEdits, poLinkByNumber])

  const unlinkPo = useUnlinkShipmentFromPO()
  const updatePoLink = useUpdateShipmentPoLink()

  /**
   * The leading open question + the words that answer it (see desk-question.ts).
   *
   * The TABLE wins when it has rows. It has to: the conflict-class needs-attention lines are dropped
   * exactly when the grid owns the comparison, so whatever else was on the leg inherited the headline —
   * a Mesh-miss FYI ended up titling a card whose real decision was which of three vendors to write.
   * The needs-attention pick still supplies the reject wording, so a leg that is BOTH a field fight and
   * a "is this freight?" question keeps its Not-a-Shipment escape.
   */
  /**
   * THIS leg's own identifier is digit-free, i.e. parsed out of a spreadsheet header rather than off a
   * document — legs `SO no.` and `PORT OF LOADING` exist on the dev DB, both provisional, both carrying
   * four emails apiece. Surfaced as a question rather than auto-rejected: the de-correction principle
   * says the desk flags what the pipeline produced and lets a human decide, and these legs hold real
   * linked evidence, so quietly binning them would take that with it.
   */
  const junkIdentifier = useMemo(
    () =>
      LEG_IDENTIFIER_FIELDS.map(({ field, label }) => ({
        label,
        value: String(legValues[field] ?? '').trim(),
      })).find((x) => x.value !== '' && isNonIdentifier(x.value)) ?? null,
    [legValues],
  )

  /**
   * Which of the two shapes this card takes (see leg-shape.ts).
   *
   *   'work'    the leg plainly IS a shipment — a usable identifier plus route/schedule/cargo. The
   *             only open question is which values are right, so the card never asks whether it is
   *             freight and carries no reject at all: Edit · Keep current · Apply N.
   *   'verdict' not enough here to be a shipment, or an identifier parsed out of a spreadsheet
   *             header. Not a Shipment · Track it · Waiting, and NO field grid — settling a value on
   *             something that may not be freight is work that gets thrown away.
   *
   * A header-row identifier forces 'verdict' whatever else the leg carries: a leg named by a column
   * heading cannot be filed under anything, so no field decision on it can be committed anywhere.
   */
  const cardShape: 'work' | 'verdict' = useMemo(
    () =>
      junkIdentifier == null && legLooksLikeShipment(shipment, linkedPOs) ? 'work' : 'verdict',
    [junkIdentifier, shipment, linkedPOs],
  )

  /**
   * Parties that became conflict-table rows are answered THERE. Leaving their Needs attention line
   * up asked one question twice, in two places, with two controls — which is how a desk starts
   * disagreeing with itself. Only the names that got a row are dropped: a party with no masters to
   * choose between keeps its line, because nothing in the table speaks for it.
   */
  const rowedPartyNames = useMemo(() => {
    const leg = shipment as unknown as Record<string, unknown>
    const COLUMN_BY_FIELD: Record<string, string> = {
      forwarder_name: 'forwarderRaw',
      customer_code: 'customerRaw',
      vendor_code: 'vendorRaw',
    }
    return new Set(
      unlinkedPartyConflicts
        .map((c) => String(leg[COLUMN_BY_FIELD[c.field] ?? ''] ?? '').trim())
        .filter(Boolean),
    )
  }, [unlinkedPartyConflicts, shipment])
  const deskGroups = useMemo(() => {
    if (!rowedPartyNames.size) return needsAttentionGroups
    return needsAttentionGroups
      .map((g) => ({
        ...g,
        items: g.items.flatMap((it) => {
          // `details` holds EVERY party on the line; `meshCandidates` only those with masters to
          // offer. Reading the candidates alone is what dropped leg 202607B738's LEADWAY EXPRESS —
          // genuinely absent from Mesh, and the only line saying so — because the line ALSO named a
          // party that had become a table row. Drop the rowed NAMES, never the line they share.
          const named = it.details ?? Object.keys(it.meshCandidates ?? {})
          if (!named.length) return [it]
          const left = named.filter((n) => !rowedPartyNames.has(n))
          if (!left.length) return [] // every party on this line is answered in the table
          if (left.length === named.length) return [it] // nothing moved — leave it exactly as built
          const candidates = Object.fromEntries(
            Object.entries(it.meshCandidates ?? {}).filter(([n]) => left.includes(n)),
          )
          const withCandidates = Object.keys(candidates).length
          return [
            {
              ...it,
              details: left,
              meshCandidates: withCandidates ? candidates : undefined,
              // The summary counted parties that have since moved to the table, so it is restated for
              // the ones still here rather than left overstating what this line is about.
              text:
                left.length === 1 && !withCandidates
                  ? meshMissText(left[0])
                  : `${left.length} ${left.length === 1 ? 'party' : 'parties'} not linked to Mesh${
                      withCandidates ? ' — expand to pick or add.' : ' — advise add in Mesh.'
                    }`,
            },
          ]
        }),
      }))
      .filter((g) => g.items.length > 0)
  }, [needsAttentionGroups, rowedPartyNames])
  /**
   * The shared-PO block IS the shared-PO question, so nothing above it may ask it again.
   *
   * `w-po-*` lines ("Only the PO number links this email to this shipment, and that PO is on another
   * shipment too") were classified before SharedPoPanel existed to answer them. Left in, the card
   * opened with a `needs answer` box that restated the question in prose, offered no control, and
   * then printed "No field changes to apply — answer above" — pointing at itself. The real answers
   * (split / take it off / keep with corrections) sat two blocks lower, in a box titled with the same
   * question.
   *
   * Dropped only when the panel is actually on screen. A queue LIST row carries no `sharedPos`, so
   * there the line is the only thing saying it and it stays.
   */
  const deskGroupsAsked = useMemo(() => {
    const panelOwnsPo = !readOnly && sharedPoGroups.length > 0
    return deskGroups
      .map((g) => ({
        ...g,
        items: g.items.filter(
          (i) => !isInfoOnlyLine(i) && !(panelOwnsPo && i.lineId.startsWith('w-po-')),
        ),
      }))
      .filter((g) => g.items.length > 0)
  }, [deskGroups, sharedPoGroups, readOnly])

  /**
   * The lines this desk cannot act on, wherever they sit in the ordering.
   *
   * Split out BEFORE the question is picked, not after. Filtering only the secondary list left the
   * primary slot open to them, and on the TCI leg that is exactly what happened: once the shared-PO
   * line moved to its own block, the Mesh miss was the only line left, so it was promoted to the
   * headline — the card asked "Who are these parties? · needs answer" about a company nobody reading
   * it can add.
   */
  const deskInfoGroups = useMemo(
    () =>
      deskGroups
        .map((g) => ({ ...g, items: g.items.filter(isInfoOnlyLine) }))
        .filter((g) => g.items.length > 0),
    [deskGroups],
  )
  const naPick = useMemo(() => pickDeskQuestion(deskGroupsAsked), [deskGroupsAsked])
  const contestedFields = useMemo(
    () =>
      conflicts.map((c) => {
        const proposed = splitCandidates(c).proposed
        return {
          label: reviewFieldLabel(c.field, c.label),
          candidateCount: proposed.length,
          currentEmpty: existingValue(c).trim() === '',
          // Synthesised party-mismatch row: nothing here came off an email, so the copy must not
          // claim one proposed it.
          fromMasterData: proposed.length > 0 && proposed.every((p) => isMasterDataSource(p.source)),
          // A row this card synthesised for an UNLINKED party (unlinkedPartyConflicts) — the leg has
          // no master on that slot at all, which is the opposite of the party-mismatch case that
          // shares this master-data branch.
          unlinked: unlinkedPartyConflicts.some((u) => u.field === c.field),
        }
      }),
    [conflicts, existingValue],
  )
  const deskPick = useMemo(() => {
    // Outranks everything: if the leg was parsed out of a header row, no field decision on it matters.
    if (junkIdentifier) {
      return {
        question: {
          question: 'Is this a real shipment?',
          affirm: 'Track it',
          reject: 'Not a Shipment',
        },
        detailText: `Its ${junkIdentifier.label} is “${junkIdentifier.value}” — a column heading, not a number. This leg was most likely parsed out of a spreadsheet's header row.`,
        detailItem: null,
        rest: deskGroupsAsked,
      }
    }
    /**
     * Identity outranks the field table. Applying values to the WRONG leg is worse than leaving them
     * unapplied, and Link & Apply already refuses to commit until a target is chosen — so the headline
     * should name the thing actually blocking, not the diff sitting behind it.
     */
    if (hasCandidateLegs && matchAmbiguity) {
      const fromCandidates = candidateDeskQuestion({
        emailKey: matchAmbiguity.emailKey,
        candidates: (matchAmbiguity.candidates ?? []) as unknown as Record<string, unknown>[],
        committerAction,
      })
      if (fromCandidates) {
        return {
          question: fromCandidates.question,
          detailText: fromCandidates.detail,
          detailItem: null,
          rest: deskGroupsAsked,
        }
      }
    }
    /**
     * The table only owns the headline when the table is on screen. A verdict card renders no grid,
     * so letting "Which Vendor Code is correct?" lead there would title the card with a decision the
     * operator cannot make and bury the one they can.
     */
    const fromTable = cardShape === 'verdict' ? null : conflictDeskQuestion(contestedFields)
    if (fromTable) {
      return {
        question: { ...fromTable.question, reject: naPick?.question.reject ?? null },
        detailText: fromTable.detail,
        detailItem: null,
        rest: deskGroupsAsked,
      }
    }
    if (!naPick) return null
    return {
      question: naPick.question,
      detailText: null,
      detailItem: naPick.primary,
      rest: naPick.rest,
    }
  }, [
    contestedFields,
    naPick,
    deskGroupsAsked,
    junkIdentifier,
    hasCandidateLegs,
    matchAmbiguity,
    committerAction,
    cardShape,
  ])

  /**
   * A working card never asks whether the leg is freight, and never offers a reject — the leg has an
   * identifier, a route and a schedule, so both would be answering a question nobody asked. Applied
   * here rather than inside each branch above so no future branch can leak one back in.
   */
  const desk = useMemo(
    () =>
      deskPick == null || cardShape !== 'work'
        ? deskPick
        : { ...deskPick, question: forWorkingCard(deskPick.question) },
    [deskPick, cardShape],
  )
  /**
   * Which of the secondary lines the operator can actually DO something about, here, now.
   *
   * `desk.rest` is decision-class by construction — the queue builds its groups with
   * `desk: 'decision'`, so rule A has already dropped the pure FYI. That classification is about
   * WHICH SCREEN the line belongs on, though, not about whether this card can act on it, and the two
   * came apart on the Mesh misses. `tagDesk` calls a NAMED party miss a decision because ops can add
   * exactly that master — but they cannot add it from here: masters are ERP-owned and read-only in
   * this app (the Resolution Rules UI was removed for that reason). So `"TCI" not found in Mesh —
   * advise add in Mesh` sat in the same list as the questions the card can answer, under a heading
   * that said "Also", and read as a fourth thing to decide.
   *
   * A miss that OFFERS candidates is different — the expansion is where the picks live, and picking
   * one is a real action on this card. That is the line the split follows.
   */
  const restSplit = useMemo(
    () => ({ decide: desk?.rest ?? [], info: deskInfoGroups }),
    [desk, deskInfoGroups],
  )

  /**
   * A "which shipment?" question with nowhere to answer it.
   *
   * Three panels normally carry the answer — the candidate picker, the shared-PO block, the identify
   * search — and each renders on its own trigger. When none of them fires the question is still
   * asked, still flagged `needs answer`, and the card offers nothing: leg 20260703B3 sat like that,
   * because the queue raised PO_REASSIGN on the EMAIL and the committer then declined to link the PO
   * ("PO 222930: exclusive to sibling HAWB — not linked"), so the leg carries no PO for a panel to
   * be about, and the flags are not the WEAK_IDENTITY / AMBIGUOUS_MATCH that open the search.
   *
   * The question is still real — an email was matched to this leg on thin evidence and somebody has
   * to say whether that was right. So the answers go in the block itself: yes, or no-and-find-it.
   *
   * Not solved by suppressing the line. The committer's reasoning is a decision the desk may
   * disagree with, and the de-correction rule says the desk surfaces what the pipeline produced and
   * lets a human rule on it — it does not quietly decide the question is moot.
   */
  const [rightShipment, setRightShipment] = useState<'yes' | 'no' | null>(null)
  const identityQuestionHasNoAnswer =
    !readOnly &&
    desk?.detailItem?.groupId === 'which_shipment' &&
    !hasCandidateLegs &&
    sharedPoGroups.length === 0 &&
    // These two already open the identify search on their own, so the block is not answer-less.
    !isWeakIdentity &&
    !isAmbiguousMatch

  const restNeedsTitles = useMemo(
    () =>
      (restSplit.decide.reduce((n, g) => n + g.items.length, 0) ?? 0) >= ALSO_TITLE_THRESHOLD,
    [restSplit],
  )
  /** Note starts collapsed; it opens itself the moment a note is actually owed (see showNoteField). */
  const [noteOpen, setNoteOpen] = useState(false)

  /**
   * A conflict candidate is attributed by the queue with a graphMessageId; our related emails carry
   * the same id alongside our own uuid, so we can land the reader on the exact email that stated a
   * value. Returns null — no icon — when that email is not among this shipment's emails or its body
   * was wiped. `source` alone ('Final B/L') would only narrow it to a document TYPE, and a thread
   * routinely holds several of the same type, so matching on the id is what keeps this honest.
   */
  /** Which value's provenance is open, if any. */
  const [evidence, setEvidence] = useState<{ emailId: string; value: string } | null>(null)
  const resolveSourceEmail = useMemo(() => {
    const byGraphId = new Map<string, ReviewEmail>()
    for (const e of emails) {
      if (e.graphMessageId && e.id && !e.bodyMissing) byGraphId.set(e.graphMessageId, e)
    }
    return (sourceEmailId: string | null | undefined, candidateValue?: string | null) => {
      if (!sourceEmailId) return null
      const em = byGraphId.get(sourceEmailId)
      if (!em?.id) return null
      return {
        // Opens INSIDE the card. It used to launch a chrome-less pop-up, which meant leaving the card
        // to read the mail and carrying the value back in your head — and it landed at the top of the
        // message with no sign of which line the value came off.
        open: () => setEvidence({ emailId: em.id!, value: String(candidateValue ?? '').trim() }),
        title: `Show where this came from — ${em.subject}`,
      }
    }
  }, [emails])

  const [resolutions, setResolutions] = useState<Record<string, string>>(() =>
    initialResolutions(conflicts, existingValue),
  )
  /**
   * Rows the operator EXPLICITLY ruled to leave alone — critic field names, the same keys
   * `resolutions` uses.
   *
   * Not derivable from `resolutions`. A row seeds from the stored value, so "the resolution equals
   * what the leg holds" is the state of every untouched row on the card; reading a keep off it would
   * lock the whole grid on every approval. Only a click on the row's own `Keep current` control puts
   * a field in here (ConflictRow.onKeep).
   *
   * The bulk `Leave All As Is` button CLEARS this set rather than filling it — that button is
   * routinely "not now", not a per-field ruling, and treating it as one would manufacture decisions
   * nobody made. It is the line in this feature most likely to be written backwards.
   */
  const [keptFields, setKeptFields] = useState<Set<string>>(() => new Set())
  /** Card-level edit mode. The table reads as a clean diff until the operator asks to change it. */
  const [editing, setEditing] = useState(false)

  /**
   * Taking a different Mode from the email reclassifies the leg, which strands the OLD mode's
   * transport fields. Those are computed against the mode the operator is about to take, not the one
   * stored — that is the whole question.
   *
   * Empty on a queue-list row: the list DTO carries no transport columns, so nothing is claimed there.
   * Same safe direction `openDecisions` takes when it is absent.
   */
  const modeConflict = useMemo(
    () => conflicts.find((c) => mapCriticFieldToColumn(c.field) === 'mode') ?? null,
    [conflicts],
  )
  /**
   * The Mode the operator has actually TAKEN — '' while the row is untouched, or while the pick
   * matches what the leg already stores. Hoisted out of `modeCarryOver` because the clear rows name
   * it ("MAWB is not applicable for SEA mode") and must say the mode being taken, never the stored
   * one: on those rows the two are always different, and printing the wrong one inverts the sentence.
   */
  const takenMode = useMemo(() => {
    if (!modeConflict) return ''
    const taken = (resolutions[modeConflict.field] ?? '').trim()
    if (taken === '' || !changesStoredValue(modeConflict, taken, liveValueFor(modeConflict))) return ''
    return taken
  }, [modeConflict, resolutions, liveValueFor])
  const modeCarryOver = useMemo(
    () =>
      takenMode === ''
        ? []
        : offModeFieldsOn({ ...(shipment as ModeFieldLeg), mode: takenMode }),
    [takenMode, shipment],
  )
  /** Is there anything for the "For information" block to hold? Four sources, one box — and no box
   *  at all when none of them has something to say. */
  const hasInfoOnly =
    restSplit.info.length > 0 ||
    criticReview == null ||
    modeCarryOver.length > 0 ||
    (!hasCandidateLegs && (criticReview?.refusedCandidates?.length ?? 0) > 0)

  /** Exceptions only — absent means "clear it", the default the operator asked for. */
  const [keepOnModeSwitch, setKeepOnModeSwitch] = useState<Record<string, boolean>>({})
  const willClearOnSwitch = useCallback(
    (column: string) => keepOnModeSwitch[column] !== true,
    [keepOnModeSwitch],
  )
  /**
   * Columns this Apply will EMPTY.
   *
   * The desk could not clear a field at all before this: `fieldsToApply` skips an empty resolution,
   * because empty there means "no decision" rather than "clear it". So the clears travel separately
   * and are merged in — an explicit signal, never an absence.
   */
  const clearedColumns = useMemo(
    () => modeCarryOver.filter((f) => willClearOnSwitch(f.column)).map((f) => f.column),
    [modeCarryOver, willClearOnSwitch],
  )

  /**
   * Re-seed when the conflict set changes (new payload / leg) OR when the STORED value behind any
   * contested row moves.
   *
   * The stored value has to be in the key now that it is the seed. Keyed on the field names alone,
   * a refetch — react-query refetches on window focus — would move `liveValues` while `resolutions`
   * kept the value the leg held when the card opened, and the card would offer to `Apply SOUOCE`
   * over a leg someone else had since corrected to ROKNFT. Nobody chose that; it is the same
   * pre-approval this seed exists to prevent, arriving through a stale copy instead of a proposal.
   *
   * It costs an in-progress tick whenever the leg genuinely changes underneath. That is the right
   * way round: a decision made against a value that has since moved is a decision worth re-making.
   * Ticking does NOT re-seed — the key reads `existingValue`, never `resolutions`.
   */
  const conflictKey = useMemo(
    () => conflicts.map((c) => `${c.field}\0${existingValue(c)}`).join('|'),
    [conflicts, existingValue],
  )
  const [seededKey, setSeededKey] = useState(conflictKey)
  if (seededKey !== conflictKey) {
    setSeededKey(conflictKey)
    setResolutions(initialResolutions(conflicts, existingValue))
    // A ruling is about the value the operator was looking at. That value has just moved (or the leg
    // has), so the ruling goes with it — same reasoning as the resolution re-seed above.
    setKeptFields(new Set())
    setEditing(false)
  }

  /**
   * The row's VALUE changed. Any resolution that is not the stored value retracts a keep ruling on
   * that row — picking a candidate or typing a value is the operator changing their mind, and
   * leaving the ruling behind would post `keep` and `fields` for one field (which the backend 400s).
   *
   * Deliberately conditional rather than an unconditional clear: the `Keep current` radio fires this
   * with the stored value AND `onKeep`, in an order React does not promise. Retracting only on a
   * value that actually differs makes the pair order-independent.
   */
  const setResolution = (field: string, v: string) => {
    setResolutions((prev) => ({ ...prev, [field]: v }))
    const c = conflicts.find((x) => x.field === field)
    if (c && changesStoredValue(c, v, liveValueFor(c))) {
      setKeptFields((prev) => {
        if (!prev.has(field)) return prev
        const next = new Set(prev)
        next.delete(field)
        return next
      })
    }
  }

  /** The operator clicked this row's `Keep current` — a decision, not a value (see keptFields). */
  const markKept = (field: string) => {
    setKeptFields((prev) => (prev.has(field) ? prev : new Set(prev).add(field)))
  }

  const startEditing = () => setEditing(true)

  /** Cancel = leave edit mode AND drop the edits, back to the stored values. Leaving them applied
   *  after "Cancel" would silently arm Submit with values the operator just backed out of. */
  const cancelEditing = () => {
    setResolutions(initialResolutions(conflicts, existingValue))
    setKeptFields(new Set())
    // A pending PO removal or a typed correction is a change like any other — Discard means all.
    setSharedPoAnswers({})
    setSharedPoEdits({})
    // …including the which-shipment answer, which also closes the search "no" opened.
    setRightShipment(null)
    setWrongShipment(false)
    setEditing(false)
  }

  /**
   * Units for a contested row. A bare number is unreadable ('14' — of what?), so the value carries
   * its unit exactly as Order Details does.
   *
   * Weight/volume are invariant (KGS/CBM) → both sides share one. `qty` is the dangerous case: its
   * unit is the leg's own UOM, and when the email ALSO contests qty_unit the two sides are counting
   * different things (the 260-cartons vs 13516-pieces family). Stamping the STORED unit onto the
   * agent's number would then assert something no one said — so the proposal shows no unit and the
   * contested UOM row speaks for itself.
   */
  const unitsFor = (c: CriticConflict): { existing: string | null; proposed: string | null } => {
    const column = mapCriticFieldToColumn(c.field)
    const fixed = column ? fieldUnit(column) : null
    if (fixed) return { existing: fixed, proposed: fixed }
    if (column !== 'qty') return { existing: null, proposed: null }
    const uom = (shipment as Partial<ShipmentDetail>).quantityUnit ?? null
    const uomContested = conflicts.some((x) => mapCriticFieldToColumn(x.field) === 'qtyUnit')
    return { existing: uom, proposed: uomContested ? null : uom }
  }

  const id = identityOf(shipment)
  const band = compact?.band ?? criticReview?.confidence?.band ?? null
  /**
   * Leg columns to POST on Save & Approve. Keys are camelCase correct-DTO columns so every
   * contested field that maps (incl. pol→polRaw, forwarder_name→forwarderRaw) is applied — not
   * only the Order Details form vocabulary. Unmappable critic fields are excluded (see Other rows).
   */
  const fieldsToApply = useMemo(() => {
    const fields: Record<string, unknown> = {}
    /**
     * A verdict card shows no grid, but `resolutions` is still seeded with the agent's proposals — so
     * without this a "Track it" click would silently commit values the operator never saw. Answering
     * "yes, this is freight" says nothing about which vendor is right.
     */
    if (cardShape === 'verdict') return fields
    for (const c of conflicts) {
      const col = mapCriticFieldToColumn(c.field)
      if (!col) continue
      const v = (resolutions[c.field] ?? '').trim()
      const existing = existingValue(c).trim()
      // Apply when operator set a value that differs from what's already stored.
      // Style lists: compare normalized token lists so "A,B" vs "A, B" is not a false delta.
      if (v === '') continue
      if (col === 'itemStyleNo') {
        const normalized = serializeStyleEntries(parseStyleEntries(v))
        if (normalized === serializeStyleEntries(parseStyleEntries(existing))) continue
        fields[col] = normalized
        continue
      }
      // Through changesStoredValue, not a bare `!==`: the row's resolution form is what decides
      // (a grouped "1,240" and a stored 1240 are one value), and the count on the button, the
      // group headers and this bag must all be answering the same question.
      if (changesStoredValue(c, v, liveValueFor(c))) fields[col] = v
    }
    /**
     * The mode change's consequence rides on the SAME apply, so the reclassification lands as one act
     * rather than as a mode edit now and an orphaned field forever. `''` is the clear: `coerceLegField`
     * maps empty to null for every column, which is why this can be an ordinary field write.
     */
    for (const col of clearedColumns) fields[col] = ''
    return fields
  }, [conflicts, resolutions, existingValue, liveValueFor, clearedColumns])

  /**
   * The keep rulings as LEG COLUMNS — what the API takes.
   *
   * Filtered against the rows actually on the grid, so a ruling cannot outlive the row that carried
   * it, and against `fieldsToApply`, because "write this" and "leave it alone" for one field is a
   * contradiction the backend rejects outright. A verdict card decides no fields at all, for the
   * same reason it applies none.
   */
  const keptRows = useMemo(() => {
    if (cardShape === 'verdict') return []
    const rows: { column: string; label: string }[] = []
    for (const c of conflicts) {
      if (!keptFields.has(c.field)) continue
      const col = mapCriticFieldToColumn(c.field)
      if (!col || col in fieldsToApply) continue
      if (rows.some((r) => r.column === col)) continue
      rows.push({ column: col, label: reviewFieldLabel(c.field, c.label) })
    }
    return rows
  }, [conflicts, keptFields, fieldsToApply, cardShape])
  const keepColumns = useMemo(() => keptRows.map((r) => r.column), [keptRows])

  /**
   * The learning signal (ADR-0002). `aiProposed` is what the agent suggested, `humanFinal` is what
   * the operator committed — equal values are a confirmation, differing ones a correction. Dropping
   * aiProposed would leave the learner knowing only that a human typed something, not what it got
   * wrong, so it is carried even though the cell renders once.
   */
  const corrections = useMemo(
    () =>
      conflicts
        .map((c) => {
          const col = mapCriticFieldToColumn(c.field)
          if (!col || !(col in fieldsToApply)) return null
          return {
            field: c.field,
            existing: existingValue(c),
            aiProposed: proposedValueOf(c),
            humanFinal: String(fieldsToApply[col] ?? ''),
          }
        })
        .filter((x): x is NonNullable<typeof x> => x != null),
    [conflicts, fieldsToApply, existingValue],
  )

  // A note is mandatory when the operator OVERRIDES the agent — a value that is neither what is
  // stored nor what was proposed is a human judgement, and the note is the only record of why (and
  // the training signal). Accepting the agent's proposal needs no note: the confirm click is the
  // record. Requiring one there would demand a note on every single approval.
  const overrides = useMemo(
    () =>
      conflicts.filter((c) => {
        const v = (resolutions[c.field] ?? '').trim()
        // #360: ANY candidate pick is not an override — only a free-typed custom value needs a note.
        return changesStoredValue(c, v, liveValueFor(c)) && !isCandidateResolution(c, v)
      }),
    [conflicts, resolutions, liveValueFor],
  )
  const noteRequired = overrides.length > 0 && !note.trim()
  /**
   * The note is OPTIONAL on a plain confirmation, so it no longer sits open as a two-row box asking
   * the operator to "explain why you chose a different value" when they have chosen nothing — on a
   * judgment-only card that empty field was the largest thing on screen. It opens on demand, and
   * opens ITSELF whenever a note is owed (an override), while editing, or once anything is typed.
   */
  const showNoteField = editing || overrides.length > 0 || noteOpen || note.trim().length > 0
  /**
   * Cross-field date sanity — the same check the Order Details form runs, which this table never had.
   * A contested date reads from the live resolution; one that is NOT contested falls back to what the
   * shipment already stores, so "ETA moved before the stored ETD" is caught. Queue rows carry no
   * dates, so there it only fires when both sides of a comparison are contested.
   */
  const dateError = useMemo(() => {
    const stored = shipment as Partial<ShipmentDetail>
    const fallback: Record<string, string | null | undefined> = {
      etd: stored.etd,
      atd: stored.actualDeparture,
      eta: stored.eta,
      ata: stored.actualArrival,
    }
    const pick = (col: 'etd' | 'atd' | 'eta' | 'ata') => {
      const c = conflicts.find((x) => mapCriticFieldToColumn(x.field) === col)
      return (c ? resolutions[c.field] : fallback[col]) ?? undefined
    }
    return dateOrderWarn({ etd: pick('etd'), atd: pick('atd'), eta: pick('eta'), ata: pick('ata') })
  }, [conflicts, resolutions, shipment])
  /**
   * A cell holds a value NOBODY offered — the operator typed it.
   *
   * Deliberately not "anything diverged from the default": taking the email's value or picking one of
   * its candidates leaves the column showing exactly what the email said, which is what the idle
   * header claims. Only a typed value makes that header false, and only then does it say "Edited".
   * (Same reason a PO tick does not rename the column either — see ReviewPoStylesSection.)
   */
  const hasTypedOverride = overrides.length > 0
  /**
   * Column 3 label tracks state: what the thread said → edit mode → human-applied values.
   *
   * Idle wording lives in REVIEW_HEAD (see the note there on what it does and does not claim). Once
   * the operator is editing, the column IS their resolution and says so.
   */
  const proposedColumnLabel = editing
    ? 'Resolution'
    : hasTypedOverride
      ? 'Edited'
      : REVIEW_HEAD.proposed
  /**
   * How many stored values Approve would overwrite. This is the count the primary button NAMES —
   * one informed click beats a row-by-row confirm ritual, but a bare "Approve" would hide what is
   * being accepted, which is the whole reason these legs are queued.
   */
  const changeCount = useMemo(
    () =>
      cardShape === 'verdict'
        ? 0 // nothing is being applied from a verdict card, so nothing is being counted
        : conflicts.filter((c) => changesStoredValue(c, resolutions[c.field] ?? '', liveValueFor(c)))
            .length +
          /* A clear IS a write, so the button must count it — otherwise "Apply 1 Change" would be
             taking a mode AND emptying two fields, and the label would understate its own reach. */
          clearedColumns.length +
          /* A PO's style list is ONE field and one write, however many boxes moved to compose it —
             counting ticks would say "4 changes" for two rows of work and would not match the field
             grid, where one contested field is one change. */
          poPlans.length +
          /* Taking a PO off the shipment is a write like any other, and the button has to name it —
             a removal that rode along under "No Changes" would be the least announced and most
             consequential thing on the card. */
          sharedPoRemovals.length +
          /* One corrected PO line is one change, however many of its three fields moved — same rule
             the style plans follow, and it matches what the operator sees: one row, one fix. */
          sharedPoCorrections.length,
    [
      conflicts,
      resolutions,
      liveValueFor,
      cardShape,
      poPlans,
      clearedColumns,
      sharedPoRemovals,
      sharedPoCorrections,
    ],
  )
  /**
   * What the primary button will WRITE, when that is one nameable thing. A bare "Approve" made the
   * operator trust that the highlighted candidate was the one being taken; `Apply FEFALT` says it.
   *
   * The value is already the resolution value, i.e. the master CODE for a resolved party pick — which
   * is exactly the short token worth printing (FEFALT, a date, a container number). Anything longer
   * than that is a company name or an address, and `Apply MACAU FUNG TAI LI…` cut mid-word reads worse
   * than the count it replaced, so those fall back to `Apply 1 Change`. The full detail is in the title.
   */
  const applyToken = useMemo(() => {
    // Only when this ONE field is the whole of what Save will write. changeCount also counts cleared
    // columns and PO style plans, and naming the field alone read as "Apply 369" on a card that was
    // also about to rewrite a PO's style list — a label that understated its own reach.
    if (changeCount !== 1) return null
    const values = Object.values(fieldsToApply)
    if (values.length !== 1) return null
    const raw = String(values[0] ?? '').trim()
    if (!raw || raw.length > 14) return null
    return raw
  }, [fieldsToApply, changeCount])
  /**
   * The primary button, worded as the answer the operator just gave about a shared PO.
   *
   * Only when that answer is the WHOLE of what the click does — the moment the card also has fields
   * to write, the apply is the bigger fact and keeps the label. Without this the two answers came out
   * as `Apply 1 Change` and `Mark Reviewed — No Changes`, which is how the panel's plain-language
   * question ("does this PO belong here?") got handed back in the vocabulary it was written to avoid.
   */
  const sharedPoVerdictLabel = useMemo(() => {
    if (sharedPoRemovals.length > 0 && changeCount === sharedPoRemovals.length) {
      return sharedPoRemovals.length === 1
        ? `Remove PO ${sharedPoRemovals[0]!.poNumber}`
        : `Remove ${sharedPoRemovals.length} POs`
    }
    if (sharedPoCorrections.length > 0 && changeCount === sharedPoCorrections.length) {
      return sharedPoCorrections.length === 1
        ? `Correct PO ${sharedPoCorrections[0]!.poNumber}`
        : `Correct ${sharedPoCorrections.length} PO lines`
    }
    // "Split" writes nothing, so it never competes with an apply — but it is still an answer, and
    // `Mark Reviewed — No Changes` is not the words the operator just read.
    if (sharedPoRemovals.length === 0 && sharedPoSplits > 0 && changeCount === 0) {
      return sharedPoSplits === 1 ? 'Confirm — Order Was Split' : 'Confirm — Orders Were Split'
    }
    /* The answer to "is this the right shipment?" when the block had to carry it itself. "No" gets
       no label here — its action is the identify search, which has its own Apply identity button. */
    if (rightShipment === 'yes' && changeCount === 0) return 'Confirm — Right Shipment'
    return null
  }, [sharedPoRemovals, sharedPoCorrections, sharedPoSplits, changeCount, rightShipment])
  /** Nothing is stored on any contested row, so "keep what is there" means leaving it blank — say so.
   *  Reads the LIVE value: a leg storing MACFUN with no critic System candidate was offering to
   *  "Leave Blank" a field that is not blank. */
  const keepMeansBlank = useMemo(
    () => conflicts.length > 0 && conflicts.every((c) => existingValue(c).trim() === ''),
    [conflicts, existingValue],
  )
  /**
   * A contested row already operable in place: more than one candidate, so its cell carries the radios
   * AND its own "Type a different value" way into the editor. Ports are excluded — they render a
   * PortPicker, which still needs edit mode.
   */
  const allConflictsSelfServe = useMemo(
    () =>
      conflicts.length > 0 &&
      conflicts.every((c) => {
        const col = mapCriticFieldToColumn(c.field)
        return col != null && !isPortColumn(col) && splitCandidates(c).proposed.length > 1
      }),
    [conflicts],
  )
  /**
   * Edit only when the desk has something editable that the cells cannot already do: contested rows
   * that need the editor, or a PO the agent has a proposal for.
   *
   * It used to fire on `linkedPOs.length > 0`, so it rendered on cards whose only content was a
   * question about whether the leg is freight at all — where its one effect was opening PO editing,
   * which is the shipment page's job. And when every contested row is a candidate pick, Edit was
   * merely the gate in front of an answer already on screen; the pick moved into the cell, so the
   * button has nothing left to offer.
   */
  const showEdit =
    !readOnly &&
    // Edit opens the grid, and a verdict card has none — the button would open nothing.
    cardShape === 'work' &&
    ((conflicts.length > 0 && !allConflictsSelfServe) || poNeedsReview)
  /** Edit mode as the GRID sees it — read-only history never edits, whatever `editing` says. */
  const gridEditing = editing && !readOnly
  /**
   * Nothing left to decide. Counts the shared-PO block too: its question is filtered out of
   * `deskGroupsAsked` because the panel owns it, and without this a leg whose ONLY open item is a
   * shared PO would show "Nothing to decide — ready" directly above three unanswered radio buttons.
   */
  const deskEmpty =
    deskGroupsAsked.length === 0 && conflicts.length === 0 && sharedPoGroups.length === 0
  // Multi-candidate: require a real target before primary CTAs; use onLink path.
  const multiCandNeedsTarget = hasCandidateLegs && !!onLink
  const canSave =
    !readOnly &&
    !noteRequired &&
    // An arrival before its departure is impossible — same block the Order Details Save applies.
    dateError == null &&
    !busy &&
    (multiCandNeedsTarget
      ? linkTargetReady
      : !!(onSaveAndApprove || onApprove))


  /**
   * Run a verdict, holding the card busy for its duration.
   *
   * The catch is load-bearing. Every call site is `void run(...)` with no catch of its own, so a
   * rejected save — a 400 from a UOM the enum refuses, a stale `expectedUpdatedAt` — escaped as an
   * unhandled promise rejection. In the browser that is a console error nobody reads; under vitest it
   * fails the whole run while every test still reports as passing, which is exactly how it went
   * unnoticed.
   *
   * Swallowed HERE, deliberately, because the message is not this component's to own: the page's
   * mutation layer toasts the API error (ReviewQueuePage), and the card's job on failure is to stay
   * put with the operator's edits intact. Re-throwing would only reinstate the unhandled rejection.
   * `busy` still clears, and `setEditing(false)` in the commit path is correctly skipped, because the
   * throw happens before it.
   */
  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } catch {
      // Intentionally quiet — see above. The caller surfaces it.
    } finally {
      setBusy(false)
    }
  }

  const handleLinkAndApply = (withFields: boolean) => {
    if (busy || !onLink || !linkTargetReady || !selectedTargetId) return
    if (withFields && noteRequired) return
    setEditing(false)
    const fields = withFields ? fieldsToApply : {}
    void run(() =>
      onLink(selectedTargetId, {
        fields,
        note: note.trim() || undefined,
      }),
    )
  }

  /**
   * Write the ticked PO style lists.
   *
   * Sequential, not Promise.all: these are separate PO masters and a partial failure must leave the
   * ones already written intact rather than racing an unknown subset. Runs BEFORE the leg save so a
   * PO write that 400s surfaces its own error instead of being masked by a leg confirm that
   * succeeded — the operator then still sees the leg on the desk, which is the honest state.
   *
   * An empty list writes null: `clears` is a legitimate outcome (sometimes the whole style list is
   * junk), and the row said so in red before the operator got here.
   */
  const applyPoPlans = async (): Promise<void> => {
    for (const plan of poPlans) {
      await updatePo.mutateAsync({ id: plan.poId, itemStyleNo: plan.itemStyleNo || null })
    }
  }

  /**
   * Take the POs the operator answered "does not belong here" off THIS shipment.
   *
   * Sequential and before the leg confirm, for the same reasons `applyPoPlans` is: a partial failure
   * must leave the removals already done intact, and a 400 here has to surface as itself rather than
   * be masked by a confirm that succeeded — the leg then stays on the desk, which is the honest state.
   *
   * Deletes the shipment↔PO LINK only. The purchase order survives, and so does the other shipment's
   * claim on it, which is exactly what the panel promises the click will do.
   */
  const applySharedPoRemovals = async (): Promise<void> => {
    for (const r of sharedPoRemovals) {
      await unlinkPo.mutateAsync({ poId: r.poId, linkId: r.linkId })
    }
  }

  /**
   * Write the corrections typed onto a shared PO's line.
   *
   * Two different writes behind one row, deliberately kept apart. Quantity and unit belong to the
   * LINK (what this shipment carries), so they patch `shipment_pos`. The PO NUMBER belongs to the
   * order itself, so it renames the purchase order — the same thing the PO grid's number field has
   * always done. Only the keys the operator moved are sent: the backend leaves an omitted key alone
   * and clears an explicit null, so a unit-only fix must not carry a quantity with it.
   */
  const applySharedPoCorrections = async (): Promise<void> => {
    for (const c of sharedPoCorrections) {
      const patch: { quantity?: number | null; quantityUnit?: string | null } = {}
      if ('quantity' in c) patch.quantity = c.quantity
      if ('quantityUnit' in c) patch.quantityUnit = c.quantityUnit
      if (Object.keys(patch).length > 0) {
        await updatePoLink.mutateAsync({ poId: c.poId, linkId: c.linkId, ...patch })
      }
      if (c.renameTo) {
        await updatePo.mutateAsync({ id: c.poId, poNumber: c.renameTo })
      }
    }
  }

  const handleSaveAndApprove = () => {
    if (busy) return
    if (noteRequired) {
      // Button is usually disabled; still guard so a race cannot skip the note.
      return
    }
    // Multi-candidate: one shot — apply field choices to target + merge provisional.
    if (multiCandNeedsTarget) {
      handleLinkAndApply(true)
      return
    }
    const savePayload = {
      fields: fieldsToApply,
      keep: keepColumns,
      note: note.trim(),
      corrections,
      expectedUpdatedAt: id.updatedAt,
    }
    /**
     * Leave edit mode only once the write has actually landed.
     *
     * `setEditing(false)` used to fire here, before the request. A save that 400s — a UOM the enum
     * rejects, a stale expectedUpdatedAt — then left the card in READ mode still holding the typed
     * values, where the row renders as text with no input and no Cancel. The operator's own edits
     * were stranded on screen, armed, with the only way out being to press Edit again and then
     * Cancel, which reads like going deeper rather than backing out.
     */
    const hasFieldEdits = Object.keys(fieldsToApply).length > 0
    const commit = (fn: () => Promise<void>) =>
      void run(async () => {
        await applyPoPlans()
        // Corrections BEFORE removals: a card that both fixes one PO's line and takes another off
        // should not lose the fix if the unlink 400s.
        await applySharedPoCorrections()
        await applySharedPoRemovals()
        await fn()
        setEditing(false)
      })
    /**
     * Keep rulings ride the save path even when nothing is being written. `onApprove` is the bare
     * confirm — it carries no payload, so routing a keep-only card there would drop every ruling on
     * the floor, which is the no-op this feature exists to end. The page still lands on /confirm
     * when `fields` is empty; the difference is that it can now carry `keep` with it.
     */
    if ((hasFieldEdits || savePayload.keep.length > 0) && onSaveAndApprove) {
      commit(() => onSaveAndApprove(savePayload))
      return
    }
    if (onApprove) {
      commit(() => onApprove())
      return
    }
    if (onSaveAndApprove) {
      commit(() => onSaveAndApprove(savePayload))
    }
  }

  const handleApproveCollapsed = () => {
    if (busy || readOnly) return
    if (multiCandNeedsTarget) {
      handleLinkAndApply(false)
      return
    }
    if (!onApprove) return
    // Same bulk decline as the expanded "Leave All As Is" — it clears rulings, never applies them.
    setKeptFields(new Set())
    setSharedPoAnswers({})
    setSharedPoEdits({})
    void run(() => onApprove())
  }

  const selectedJobLabel =
    matchAmbiguity?.candidates?.find((c) => c.shipmentId === selectedTargetId)?.jobNo ??
    (selectedTargetId ? selectedTargetId.slice(0, 8) : null)

  return (
    <div className={cn('min-w-0 max-w-full', embedded ? undefined : 'rounded-xl border border-border bg-surface-800')}>
      {/* Collapsed identity row (§2.1) — suppressed when embedded: the queue row states it already. */}
      {!embedded && (
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 sm:gap-3">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          aria-label={expanded ? 'Collapse details' : 'Expand details'}
          className="inline-flex shrink-0 items-center justify-center rounded-md p-1 text-text-muted hover:bg-surface-700 hover:text-text-primary"
        >
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>

        {band ? (
          <Badge variant="confidence" value={band} />
        ) : (
          <span className="inline-block w-10" aria-hidden />
        )}

        <div className="min-w-0 flex-1 text-sm text-text-secondary">
          <span className="text-text-primary">{id.customer ?? '—'}</span>
          {id.forwarder && (
            <span className="text-text-muted"> · {id.forwarder}</span>
          )}
          <span className="text-text-muted"> · </span>
          <span className="font-mono text-cobalt-primary-light">{id.booking ?? '—'}</span>
          {id.route && (
            <>
              <span className="text-text-muted"> · </span>
              <span>{id.route}</span>
            </>
          )}
          {id.status && (
            <span className="ml-2 inline-flex align-middle">
              <Badge variant="status" value={id.status} />
            </span>
          )}
        </div>

        {!readOnly && !expanded && (
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {onApprove && (
              <button
                type="button"
                onClick={handleApproveCollapsed}
                disabled={busy}
                title="Mark reviewed and leave every stored value alone — writes nothing, records no per-field ruling"
                className={cn(ACTION_BTN, ACTION_VARIANT.success)}
              >
                {busy && <Loader2 size={13} className="animate-spin" />}
                {/* Same verb split as the expanded bar: this is the collapsed bulk decline, so it
                    "leaves" rather than "keeps" — see the neutral button's note below. */}
                Leave As Is
              </button>
            )}
          </div>
        )}
      </div>
      )}

      {/* Expanded: needs-attention + conflicts-only + notes + Save&Approve (§2.2).
          Band stays on the queue row/header; Open shipment is on this panel (Active queue has
          no Action column — Approved/Rejected still keep row-level Open). */}
      {(expanded || embedded) && (
        <div className={cn('space-y-3 px-3 pb-3 pt-3', !embedded && 'border-t border-border')}>
          {/* Hybrid-C E2: residual / multi-booking trust strip.
              First, not buried mid-card: this states WHAT the operator is looking at ("row 5 of 5 of
              a multi-booking email"), which frames every panel below it. It used to sit between the
              source emails and the decision grid, where it read as a footnote to the emails. */}
          {(hasCandidateLegs ||
            criticReview?.multiBookingOrigin ||
            criticReview?.splitAudit) && (
            <ReviewBlock
              title="This email"
              icon={Forward}
              status="none"
              className="text-sm text-text-secondary"
              data-testid="multi-leg-trust-strip"
            >
              {criticReview?.splitAudit ? (
                <span className="text-status-warning">
                  Incomplete multi-booking split — expected {criticReview.splitAudit.expected}{' '}
                  bookings, system produced {criticReview.splitAudit.actual}. Review carefully.
                </span>
              ) : criticReview?.multiBookingOrigin ? (
                <span>
                  From multi-booking email: row{' '}
                  <span className="font-mono text-text-primary">
                    {criticReview.multiBookingOrigin.index}
                  </span>{' '}
                  of{' '}
                  <span className="font-mono text-text-primary">
                    {criticReview.multiBookingOrigin.total}
                  </span>
                  {criticReview.multiBookingOrigin.bookingNo
                    ? ` · BK ${criticReview.multiBookingOrigin.bookingNo}`
                    : ''}
                  {hasCandidateLegs ? ' · pick which existing shipment to update' : ''}
                </span>
              ) : (
                <span>
                  Multiple matching shipments — pick by SO / booking / HBL / container (JOB is
                  internal only).
                </span>
              )}
            </ReviewBlock>
          )}

          {/* Needs attention is a triage PROMPT — once the item is resolved (Approved/Rejected views,
              or any non-provisional shipment) it has been answered, so it stops being shown rather
              than following the leg around as history. The reasons stay on the leg and in the
              shipment history; only the prompt goes. */}
          {/* Also renders for a conflicts-only leg now: the headline comes from the table there, and
              without this the card would show a grid with no statement of what it is asking. */}
          {!readOnly && desk != null && (
            <ReviewBlock
              /*
                The open QUESTION is the title (see desk-question.ts). It replaced the old
                `Needs Attention` heading plus the group title above the leading line — two headings
                for what was often a single bullet — and the verdict buttons are worded as its
                answers. Now it is also the block's own title, so the shell's header row carries it
                and the body holds only the line it speaks for.
              */
              title={desk?.question.question ?? 'Needs Attention'}
              icon={HelpCircle}
              status="answer"
              className={cn(editing && 'border-status-warning/40')}
              data-testid="needs-attention"
              /* The block's headline IS the question, so `desk-question` names the header's own text
                 rather than a hidden copy of it — a duplicate would have the card asking twice. */
              titleTestId="desk-question"
            >
              {/* data-testid why-review kept: every test and the focus page reach for it. */}
              <div data-testid="why-review" data-editing={editing ? 'true' : 'false'}>
                {desk?.detailItem &&
                  (isExpandableMiss(desk.detailItem) ? (
                    <ul className="mt-1">
                      <NeedsAttentionMeshMiss item={desk.detailItem} />
                    </ul>
                  ) : (
                    <p
                      className={`mt-0.5 ${REVIEW_FS.body} text-text-secondary`}
                      title={desk.detailItem.evidence?.join(' · ') || undefined}
                      data-testid="desk-question-detail"
                    >
                      {desk.detailItem.text}
                    </p>
                  ))}

                {desk?.detailText && (
                  <p
                    className={`mt-0.5 ${REVIEW_FS.body} text-text-secondary`}
                    data-testid="desk-question-detail"
                  >
                    {desk.detailText}
                  </p>
                )}

                {/* The answers, when no panel below carries them — see identityQuestionHasNoAnswer. */}
                {identityQuestionHasNoAnswer && (
                  <div
                    className="mt-2 grid gap-1"
                    role="radiogroup"
                    aria-label="Is this the right shipment?"
                    data-testid="identity-answer"
                  >
                    {(
                      [
                        { key: 'yes' as const, label: 'Yes — this is the right shipment' },
                        ...(onIdentify
                          ? [
                              {
                                key: 'no' as const,
                                /* Says what the operator will DO and where. "Find the shipment it
                                   belongs to" named a goal and left them looking for the control. */
                                label: 'No — manually assign the shipment below',
                              },
                            ]
                          : []),
                      ]
                    ).map((c) => (
                      <label
                        key={c.key}
                        className={cn(
                          'flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2 text-sm transition-colors',
                          rightShipment === c.key
                            ? 'border-cobalt-primary bg-cobalt-primary/10'
                            : 'border-border bg-surface-800 hover:bg-surface-700',
                        )}
                        data-testid={`identity-answer-${c.key}`}
                      >
                        <input
                          type="radio"
                          name="identity-answer"
                          className="h-4 w-4 shrink-0"
                          checked={rightShipment === c.key}
                          onChange={() => {
                            setRightShipment(c.key)
                            // "No" IS the search: picking it opens the block that finds the right leg.
                            setWrongShipment(c.key === 'no')
                          }}
                          aria-label={c.label}
                        />
                        <span className="min-w-0 text-text-primary">{c.label}</span>
                      </label>
                    ))}
                    <p className={`${REVIEW_FS.meta} text-text-muted`}>
                      Not sure? Press{' '}
                      <span className="font-medium text-text-secondary">Waiting</span> below and come
                      back to it.
                    </p>
                  </div>
                )}

                {restSplit.decide.length > 0 && (
                  <div className="mt-2.5 border-t border-border pt-2" data-testid="needs-attention-rest">
                    <p className={`${REVIEW_FS.meta} font-semibold text-text-muted`}>Also</p>
                    {renderRestGroups(restSplit.decide, restNeedsTitles)}
                  </div>
                )}
                {/*
                  "No field changes to apply — answer above, or park it if you need to go and ask."
                  used to sit here. It was written when the block had no pill and no controls, to
                  explain why there was nothing to press. Both of those are gone: the header says
                  `needs answer`, the answers are controls, and the line's own "answer above" pointed
                  at the sentence directly over it. Deleted, not moved — it described a state the
                  card no longer has.
                */}
              </div>
            </ReviewBlock>
          )}

          {/* Directly under the question it answers. This used to sit below the source emails and a
              "no field changes" line, so the card asked "which shipment?" at the top and put the five
              options four blocks lower. */}
          {hasCandidateLegs && matchAmbiguity && (
            <CandidateLegsPanel
              matchAmbiguity={matchAmbiguity}
              currentShipmentId={shipmentId}
              readOnly={readOnly}
              selectedId={selectedTargetId}
              onSelect={setSelectedTargetId}
            />
          )}

          {showIdentify && (
            <ReviewBlock
              /* One block, two jobs — and the operator arrived by two different routes, so it names
                 the one they are on. Reached from "No, wrong shipment" it is an ASSIGNMENT (find the
                 leg this belongs to); reached from a weak identity it is an IDENTIFICATION (this leg
                 has no booking number of its own). Same fields, opposite intents. */
              title={wrongShipment ? 'Assign the right shipment' : 'Identify this shipment'}
              icon={Search}
              status="answer"
              className="space-y-2"
              data-testid="identify-shipment"
            >
              <p className="text-sm text-text-secondary">
                {wrongShipment
                  ? 'Type the booking / SO / B/L of the shipment it belongs to — if it already exists you can link into it.'
                  : hasCandidateLegs
                    ? 'Not in the list above? Search by booking / SO / B/L.'
                    : isAmbiguousMatch && !isWeakIdentity
                      ? 'Multiple matching shipments — identify the real one and fold this leg into it if it is a duplicate.'
                      : 'Identify this shipment — type its booking / SO / B/L; if it already exists you can link into it.'}
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                <select
                  aria-label="Identity type"
                  value={identField}
                  onChange={(e) => setIdentField(e.target.value as typeof identField)}
                  className="rounded-md border border-border bg-surface-800 px-2 py-1 text-xs text-text-primary"
                >
                  <option value="booking_no">Booking No.</option>
                  <option value="so_no">SO#</option>
                  <option value="hbl_awb_fcr_no">HBL/AWB/FCR</option>
                </select>
                <input
                  aria-label="Identity value"
                  value={identValue}
                  onChange={(e) => { setIdentValue(e.target.value); setIdentResult(null) }}
                  className="w-44 rounded-md border border-border bg-surface-800 px-2 py-1 font-mono text-xs text-text-primary focus:border-cobalt-primary focus:outline-none"
                />
                <button
                  type="button"
                  disabled={identBusy || identValue.trim().length < 3}
                  onClick={async () => {
                    setIdentBusy(true)
                    try { setIdentResult(await onIdentify(identField, identValue.trim())) }
                    finally { setIdentBusy(false) }
                  }}
                  className={cn(ACTION_BTN, ACTION_VARIANT.secondary)}
                >
                  {identBusy ? <Loader2 size={13} className="animate-spin" /> : null}
                  Apply identity
                </button>
              </div>
              {identResult?.outcome === 'set' && (
                <p className="text-xs text-status-success">Identity set — the leg now carries {identResult.value}. Review and approve as usual.</p>
              )}
              {identResult?.outcome === 'ambiguous' && (
                <p className="text-xs text-status-warning">{identResult.count} shipments carry this key — open Shipments to inspect before linking.</p>
              )}
              {identResult?.outcome === 'candidate' && onLink && (
                <div className="flex flex-wrap items-center gap-2 rounded-md bg-surface-800 px-2.5 py-2">
                  <span className="text-xs text-text-secondary">
                    Already exists: <span className="font-mono text-text-primary">{identResult.candidate.jobNo}</span> · {identResult.candidate.matchedValue}
                  </span>
                  <button
                    type="button"
                    disabled={identBusy || noteRequired}
                    onClick={async () => {
                      setIdentBusy(true)
                      try {
                        await onLink(identResult.candidate.shipmentId, {
                          fields: fieldsToApply,
                          note: note.trim() || undefined,
                        })
                      } finally {
                        setIdentBusy(false)
                      }
                    }}
                    className={cn(ACTION_BTN, ACTION_VARIANT.success)}
                  >
                    Link into this shipment
                  </button>
                </div>
              )}
            </ReviewBlock>
          )}

          {/* The reference under "this PO is already on another shipment". Directly beneath the
              question, for the same reason the candidate picker is: the reason line named a problem
              and the evidence for it lived nowhere, so the card fell back to offering PO editing. */}
          {/* `atd` here is the leg's `actualDeparture` column — the sibling rows call the same date
              `atd` because that is what po-shared-legs.ts emits. Two payload names, one date. */}
          {!readOnly && sharedPoGroups.length > 0 && (
            <SharedPoPanel
              sharedPos={sharedPoGroups}
              mode={(shipment as Partial<ShipmentDetail>).mode ?? null}
              etd={(shipment as Partial<ShipmentDetail>).etd ?? null}
              atd={(shipment as Partial<ShipmentDetail>).actualDeparture ?? null}
              answers={sharedPoAnswers}
              onAnswer={(poNumber, answer) =>
                setSharedPoAnswers((prev) => ({ ...prev, [poNumber]: answer }))
              }
              edits={sharedPoEdits}
              onEdit={(poNumber, patch) => {
                setSharedPoEdits((prev) => ({
                  ...prev,
                  [poNumber]: { ...prev[poNumber], ...patch },
                }))
                /* Typing IS the answer. Making the operator fix the line and then also find the
                   radio that says "I fixed the line" is the ceremony this panel keeps removing. */
                setSharedPoAnswers((prev) =>
                  prev[poNumber] ? prev : { ...prev, [poNumber]: 'correct' },
                )
              }}
              removable={sharedPoRemovable}
              readOnly={readOnly}
            />
          )}

          {/* One decision grid: POs + field conflicts share colgroup, headers, and border. */}
          {(() => {
            /**
             * A verdict card carries no grid. Settling a vendor or an ETD on a leg that may not be
             * freight is work thrown away the moment the answer is "not a shipment" — and putting the
             * two questions on one card is what made the operator answer the smaller one first. The
             * values are still readable on the shipment page; they are just not decisions here.
             */
            if (cardShape === 'verdict') return null
            const canEditGrid = gridEditing
            /**
             * One gate, view and edit alike: a PO earns a row when the agent proposed something for
             * it, never merely because the card is open for editing.
             *
             * `canEditGrid ||` used to sit in front of this, on the reasoning that "managing POs is
             * what Edit is for". That holds for a deliberate press of the Edit button; it does not
             * hold for how edit mode is usually reached. A contested row with candidates carries its
             * own "Type a different value" link (ConflictRow), which turns on card-wide editing — so
             * asking to type a custom Consignee Name opened a PO editor with Add PO, unlink and
             * delete-style controls, on a card whose POs nobody had questioned. Editing one text
             * field is not a request to restructure the leg's orders; that is the shipment page's
             * job, and Open Shipment is one click away.
             */
            const showPos = linkedPOs.length > 0 && poNeedsReview
            const showConflicts = conflicts.length > 0
            if (!showPos && !showConflicts) return null
            // Shared thead only when both blocks show (one header, two section groups).
            // Solo PO / solo conflict each render their own thead via child defaults.
            /**
             * NO shared header. A PO row and a field row are not the same row: a PO carries a style
             * LIST where a field carries a value, and ticking styles composes one write while picking
             * a radio settles one field. They shared column tracks, so one header was hoisted above
             * both — and it read "Field / PO#", a slash trying to cover two meanings, sitting above
             * the PO section it did not describe while that section printed its own header two rows
             * later. Two header rows in one table is the tell that the sharing never held.
             *
             * Each table names its own columns now. The tracks stay shared so the two still line up.
             */
            return (
              <div
                className="max-w-full overflow-x-auto rounded-lg border border-border"
                data-testid="review-decision-grid"
              >
                {showPos && (
                  <ReviewPoStylesSection
                    shipmentId={shipment.id}
                    linkedPOs={linkedPOs}
                    customerId={
                      (shipment as { customerId?: string | null }).customerId ??
                      (shipment as { customer?: { id?: string } | null }).customer?.id ??
                      null
                    }
                    reviewReasons={reviewReasons}
                    readOnly={readOnly}
                    editing={canEditGrid}
                    onPlanChange={setPoPlans}
                    embedded
                    proposedColumnLabel={proposedColumnLabel}
                  />
                )}
                {showConflicts && (
                  <table className={REVIEW_TABLE_CLASS}>
                    <ReviewColGroup />
                    <thead>
                        <tr className="border-b border-border bg-surface-900/50">
                          <th className={`${REVIEW_COL.label} ${REVIEW_TH}`}>{REVIEW_HEAD.label}</th>
                          <th className={`${REVIEW_COL.existing} ${REVIEW_TH}`}>
                            {REVIEW_HEAD.existing}
                          </th>
                          <th
                            className={`${REVIEW_COL.proposed} ${REVIEW_TH}`}
                            data-testid="proposed-column-header"
                          >
                            {proposedColumnLabel}
                          </th>
                          {/* Was only ever in the hoisted header, so removing that left this table
                              one <th> short of its own colgroup. */}
                          <th className={`${REVIEW_COL.reference} ${REVIEW_TH}`}>
                            {REVIEW_HEAD.reference}
                          </th>
                        </tr>
                      </thead>
                    {groupReviewRows(conflicts, readOnly ? [] : modeCarryOver).map(({ group, conflicts: rows, clears }) => {
                      /**
                       * Count what would actually be WRITTEN, not how many rows are contested.
                       * `rows.length` called every contested row a "change", so a leg whose one
                       * candidate matched the stored value announced "Shipping (1 change)" directly
                       * above a button reading "there is nothing to change". Recomputed from the live
                       * resolutions, so it tracks the operator's picks.
                       */
                      const groupChanges = rows.filter((c) =>
                        changesStoredValue(c, resolutions[c.field] ?? '', liveValueFor(c)),
                      ).length
                      /**
                       * Counted apart, and named apart. A clear IS a write, so folding it into
                       * "2 changes" would be arithmetically fine and read as a lie — the group that
                       * most often carries clears carries NOTHING else (taking Mode under Shipping
                       * empties MAWB under Cargo & Logistics), so that band would announce "1 change"
                       * over a single struck-through row that is being deleted.
                       */
                      const groupClears = clears.filter((cf) => willClearOnSwitch(cf.column)).length
                      const groupSummary =
                        [
                          groupChanges > 0 &&
                            `${groupChanges} ${groupChanges === 1 ? 'change' : 'changes'}`,
                          groupClears > 0 && `${groupClears} deleted`,
                        ]
                          .filter(Boolean)
                          .join(' · ') || 'nothing to apply'
                      return (
                      <tbody key={group}>
                        <tr className="border-b border-border">
                          {/* 4, not 3 — the Reference Email column. A short colSpan leaves the
                              group band ending mid-table with an unshaded box over the last column. */}
                          <td colSpan={4} className={REVIEW_GROUP_HEADER}>
                            {group}
                            <span className="ml-2 font-normal text-text-muted">
                              ({groupSummary})
                            </span>
                          </td>
                        </tr>
                        {rows.map((c) => {
                          const units = unitsFor(c)
                          const writable = mapCriticFieldToColumn(c.field) != null
                          return (
                            <ConflictRow
                              key={c.field}
                              conflict={c}
                              value={resolutions[c.field] ?? ''}
                              onChange={(v) => setResolution(c.field, v)}
                              onKeep={() => markKept(c.field)}
                              editing={canEditGrid && writable}
                              existingUnit={units.existing}
                              proposedUnit={units.proposed}
                              notWritable={!writable}
                              canEdit={!readOnly && writable}
                              critical={isCriticalColumn(mapCriticFieldToColumn(c.field))}
                              /* Current shows what the LEG says, not the critic's pre-write snapshot.
                                 That snapshot is why a row could read `MAASTRICHT MAERSK` while the
                                 shipment had said `MARIBO MAERSK` for hours — the operator was
                                 comparing the email against a value nobody stored any more. qty keeps
                                 its own display (it also settles against the PO shipment total). */
                              /* Current shows what the LEG says. The critic's `System` candidate is a
                                 pre-commit snapshot — it is why a row could read MAASTRICHT MAERSK
                                 while the shipment had said MARIBO MAERSK for hours. */
                              existingOverride={liveValueFor(c)}
                              resolveSourceEmail={resolveSourceEmail}
                              onRequestEdit={() => {
                                if (!readOnly) startEditing()
                              }}
                            />
                          )
                        })}
                        {/* After the contested rows: a clear is a CONSEQUENCE of a decision taken
                            above, not a decision competing with them. */}
                        {clears.map((cf) => (
                          <ModeClearRow
                            key={cf.column}
                            column={cf.column}
                            label={cf.label}
                            value={cf.value}
                            takingMode={takenMode}
                            clearing={willClearOnSwitch(cf.column)}
                            onToggle={() =>
                              setKeepOnModeSwitch((k) => ({
                                ...k,
                                [cf.column]: willClearOnSwitch(cf.column),
                              }))
                            }
                          />
                        ))}
                      </tbody>
                    )})}
                  </table>
                )}
              </div>
            )
          })()}

          {deskEmpty && !readOnly && (
            <ReviewBlock
              title="Nothing to decide"
              icon={Check}
              statusLabel="ready"
              className="text-sm text-status-success"
              data-testid="review-ready-state"
            >
              {/* Name what settled it. "Ready to confirm" alone left the operator wondering what
                  happened to the five-way pick the card used to open with. */}
              {identityPinned
                ? 'This email updated an existing shipment — the committer matched it, so there is no shipment to pick.'
                : 'Ready to confirm — no open decisions'}
            </ReviewBlock>
          )}

          {/* Hiding a control on an inference needs a way back. */}
          {identityPinned && !readOnly && (matchAmbiguity?.candidates?.length ?? 0) >= 2 && (
            <button
              type="button"
              onClick={() => setPinOverridden(true)}
              data-testid="review-pin-override"
              className="text-xs font-medium text-cobalt-primary-light hover:underline"
            >
              Not the right shipment? Choose another
            </button>
          )}

          {/*
            Everything true about this leg that this desk cannot act on.

            These four lines used to be naked paragraphs scattered between the bordered panels —
            `text-[11px]` grey sentences that belonged, visually, to whichever box happened to sit
            above them. Two of them (a Mesh party Mesh does not have; a leg with no agent analysis)
            read as a fourth and fifth thing to decide on a card that had two.

            One box, one label, and the pill says `no action` — so the operator can see, without
            reading a word of it, that nothing here is waiting on them.
          */}
          {!readOnly && hasInfoOnly && (
            <ReviewBlock
              title="For information"
              icon={Info}
              status="none"
              data-testid="review-for-information"
            >
              {restSplit.info.length > 0 && renderRestGroups(restSplit.info, restSplit.info.length > 1)}

              {/* The picker vanishing must not be silent. These are legs the queue proposed and the
                  committer's own rule refuses — a different B/L is a different shipment — so offering
                  them would invite writing one shipment's data onto another. 54 of 62 offered
                  candidates were in that state. */}
              {!hasCandidateLegs && (criticReview?.refusedCandidates?.length ?? 0) > 0 && (
                <p className="mt-1 text-sm text-text-secondary" data-testid="refused-candidates">
                  {criticReview!.refusedCandidates!.length} similar shipment
                  {criticReview!.refusedCandidates!.length === 1 ? '' : 's'} matched, but{' '}
                  {criticReview!.refusedCandidates!.length === 1 ? 'it states' : 'they state'} a
                  different{' '}
                  {FIELD_WORD[criticReview!.refusedCandidates![0]!.onKey] ?? 'identifier'} — not
                  offered.
                </p>
              )}

              {criticReview == null && (
                <p className="mt-1 text-sm text-text-secondary" data-testid="no-critic-note">
                  No agent analysis on this leg (committed before the critic payload, or created
                  manually) — open the full shipment to compare values.
                </p>
              )}

              {/* Was a stray line under the grid. It is reassurance, which is information. */}
              {modeCarryOver.length > 0 && (
                <p className="mt-1 text-sm text-text-secondary" data-testid="mode-carry-over-note">
                  Deleted values stay in the shipment history — open the leg to see them.
                </p>
              )}
            </ReviewBlock>
          )}

          {/*
            "N fields the email proposed are already on the shipment" used to render here, openable,
            on the reasoning that the claim was worth being able to check.

            Removed at the desk's request (2026-07-31): the operator has nothing to do with it. Every
            row in it agreed with what the leg already stores, so it listed values that were correct
            and unchanged, on a card whose whole job is the values that are NOT. It is still exactly
            what the shipment page shows, one click away on Open Shipment.

            `appliedConflicts` itself stays — `tableOwnedCount` needs it, or the needs-attention prose
            ("6 field(s) disagree — see the conflict table") comes back the moment settling empties
            the grid, pointing the operator at a table that is no longer there.
          */}

          {/* Source emails under Needs attention — evidence while picking leg + fields */}
          {emails.length > 0 && (
            <ReviewBlock
              title="Source emails"
              count={emails.length}
              collapsible
              status="none"
              data-testid="source-emails"
              flush
            >
              {(
                <div className="space-y-1.5 p-2.5" data-testid="source-emails-list">
                  {sortedEmails.map((e) => {
                    const openable = e.id != null && !e.bodyMissing
                    return (
                      <button
                        key={e.id ?? `orphan-${e.subject}-${e.receivedAt ?? ''}-${e.sender ?? ''}`}
                        type="button"
                        onClick={() => openEmailWindow(e)}
                        disabled={!openable}
                        aria-label={
                          openable
                            ? `Open source email: ${e.subject || '(no subject)'}`
                            : `Email body not stored: ${e.subject || '(no subject)'}`
                        }
                        title={openable ? undefined : 'Email body is not in the store (link only)'}
                        className={
                          openable
                            ? 'flex w-full items-center gap-2.5 rounded-md bg-surface-900 px-2.5 py-2 text-left transition-colors hover:bg-surface-700'
                            : 'flex w-full cursor-default items-center gap-2.5 rounded-md bg-surface-900/60 px-2.5 py-2 text-left opacity-80'
                        }
                      >
                        <Mail size={14} className="shrink-0 text-text-muted" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm text-text-primary">
                            {e.subject || '(no subject)'}
                          </p>
                          <p className="text-xs leading-tight text-text-muted">
                            {!openable
                              ? 'Body not stored — re-ingest to open'
                              : (
                                  <>
                                    {parseSender(e.sender).name} ·{' '}
                                    <span className="font-mono">{formatDateTime(e.receivedAt)}</span>
                                  </>
                                )}
                          </p>
                        </div>
                        {openable && (
                          <ExternalLink size={12} className="shrink-0 text-text-muted opacity-60" />
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </ReviewBlock>
          )}

          {/*
            Put everything back — one click, next to the table it undoes.

            Individually the rows are already reversible: untick the box, choose Keep current. What
            was missing was a way to drop the LOT, and a way out of a typed value at all — outside
            edit mode that cell renders as text, so nothing on the row can touch it. `Edit → Cancel`
            does discard, but nobody finds it: pressing Edit to get rid of an edit reads as going
            further in, not backing out.

            Deliberately NOT in the action bar. That bar is verdicts — what happens to the leg — and
            this changes nothing about the leg, it just puts the desk back how it was found. It also
            appears exactly when `Leave All As Is` and `Apply N` do, and three buttons competing at
            the same moment is how the bar drifted before.
          */}
          {/* A pending RULING is undoable from here too. It changes no value, so `changeCount` does
              not see it — and without this the operator who ticked "Keep current" had no way back
              short of reloading the card: the bulk decline beside the primary only renders when
              there is a change to decline. */}
          {!readOnly && !editing && (changeCount > 0 || keptRows.length > 0) && (
            <button
              type="button"
              onClick={cancelEditing}
              disabled={busy}
              data-testid="discard-edits"
              title={
                changeCount > 0
                  ? 'Put every row back to the value the shipment stores — nothing is written and the leg stays on the desk'
                  : 'Drop the keep ruling — nothing is written or locked and the leg stays on the desk'
              }
              className="inline-flex items-center gap-1.5 text-xs font-medium text-text-muted transition-colors hover:text-status-critical"
            >
              <Undo2 size={13} />
              {changeCount > 0 ? 'Discard changes' : 'Discard ruling'}
              <span className="font-normal text-text-muted/70">
                {changeCount > 0
                  ? ` · back to ${keepMeansBlank ? 'blank' : 'the stored values'}`
                  : ' · decide nothing here'}
              </span>
            </button>
          )}

          {/*
            The mode-change clears used to live here, in their own amber panel below the grid. They
            are rows IN the grid now (ModeClearRow) — see that file for why. What the panel carried
            and the rows do not is the reassurance that a clear is recoverable, so it stays, once,
            under the table that performs them.
          */}
          {/* The reassurance moved into "For information" — it is information, and down here it was
              another naked grey line captioning whichever box followed it. */}

          {/* Directly under the grid whose ✉ opened it, so the row and its evidence read together. */}
          {evidence && (
            <EvidencePanel
              emailId={evidence.emailId}
              value={evidence.value}
              onClose={() => setEvidence(null)}
            />
          )}

          {/* Blocks Save, so it is never inside the collapsible note — a disabled primary button with
              its reason hidden behind a disclosure is a dead end. */}
          {dateError && (
            <p
              className="text-xs text-status-critical"
              data-testid="review-date-error"
              role="alert"
            >
              {dateError}
            </p>
          )}

          {!readOnly && !showNoteField && (
            <button
              type="button"
              onClick={() => setNoteOpen(true)}
              data-testid="review-note-add"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-text-muted transition-colors hover:text-text-primary"
            >
              <NotebookPen size={13} />
              Add a note
              <span className="font-normal text-text-muted/70">· optional</span>
            </button>
          )}

          {!readOnly && showNoteField && (
            <div>
              <label
                htmlFor={`review-note-${shipment.id}`}
                className="mb-1 flex items-center gap-1.5 text-xs font-medium text-text-muted"
              >
                <NotebookPen size={13} className="text-text-muted" />
                Note
                {overrides.length > 0 && (
                  <span className="font-normal text-status-warning">
                    · required when you override the agent
                  </span>
                )}
              </label>
              <textarea
                id={`review-note-${shipment.id}`}
                aria-label="Note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="Explain why you chose a different value — this helps improve future extractions"
                className={cn(
                  'w-full rounded-lg border bg-surface-900 p-2.5 text-sm leading-snug text-text-primary placeholder:text-text-muted focus:outline-none',
                  // Focus must not paint over the "note required" warning — only the neutral state
                  // takes the cobalt focus border.
                  noteRequired ? 'border-status-warning/60' : 'border-border focus:border-cobalt-primary',
                )}
              />
              {noteRequired && (
                <p className="mt-1 text-xs text-status-warning">
                  Add a note before Save & Approve — you changed a value.
                </p>
              )}
            </div>
          )}

          {/* Always show Open shipment — Active queue has no row Action column for it. */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <a
              href={`/shipments/${shipment.id}`}
              onClick={(e) => e.stopPropagation()}
              className={cn(ACTION_BTN, ACTION_VARIANT.secondary)}
              data-testid="open-shipment"
            >
              Open Shipment
            </a>
            {!readOnly && (
              /* Two states, two button sets:
                   idle    Edit · Keep current · Approve
                   editing Cancel · Submit
                 Editing hides the idle actions so the only ways out are backing the edits out
                 (Cancel) or committing them (Submit). */
              <div className="flex flex-wrap items-center justify-end gap-2">
                {editing && (
                  <button
                    type="button"
                    onClick={cancelEditing}
                    disabled={busy}
                    data-testid="cancel-editing"
                    /* danger, not secondary: Cancel DISCARDS the edits in progress, so it should not
                       look like the same kind of action as Submit sitting next to it. */
                    className={cn(ACTION_BTN, ACTION_VARIANT.danger)}
                  >
                    Cancel
                  </button>
                )}
                {!editing && showEdit && (
                  <button
                    type="button"
                    onClick={startEditing}
                    disabled={busy}
                    className={cn(ACTION_BTN, ACTION_VARIANT.secondary)}
                  >
                    Edit
                  </button>
                )}
                {/* "Not yet" — park it. Quiet on purpose: it is the right answer often enough to need a
                    button, and never the one to reach for first. Any note already typed rides along as
                    the reason, so the Waiting tab says what is being waited on. */}
                {!editing && onWait && (
                  <button
                    type="button"
                    onClick={() => {
                      if (busy || readOnly) return
                      void run(() => onWait(note.trim() || undefined))
                    }}
                    disabled={busy}
                    data-testid="review-wait"
                    title="Park this leg — it leaves Active for the Waiting tab until you come back to it"
                    className={cn(ACTION_BTN, ACTION_VARIANT.quiet)}
                  >
                    {busy && <Loader2 size={13} className="animate-spin" />}
                    Waiting
                  </button>
                )}
                {/* "No" — worded as the answer to the headline ("Not a Shipment" / "Portal Noise").
                    Absent when a rejection does not answer the leading question at all. */}
                {!editing && onReject && desk?.question.reject && (
                  <button
                    type="button"
                    onClick={() => {
                      if (busy || readOnly) return
                      void run(() => onReject(note.trim() || undefined))
                    }}
                    disabled={busy}
                    data-testid="review-reject"
                    title="This is not a trackable shipment — it leaves the queue without confirming its data"
                    className={cn(ACTION_BTN, ACTION_VARIANT.danger)}
                  >
                    {busy && <Loader2 size={13} className="animate-spin" />}
                    {desk.question.reject}
                  </button>
                )}
                {!editing && (onApprove || multiCandNeedsTarget) && changeCount > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      if (busy || readOnly) return
                      if (multiCandNeedsTarget) {
                        handleLinkAndApply(false)
                        return
                      }
                      /**
                       * The bulk decline CLEARS the per-row rulings — it does not apply them to
                       * everything. "Leave All As Is" is overwhelmingly "not now"; turning it into a
                       * per-field ruling on every contested row would fabricate decisions from a
                       * click that means the opposite, and it would do so on exactly the legs with
                       * the most rows. A ruling comes from the row, or it does not exist.
                       */
                      setKeptFields(new Set())
                      // Same reasoning for a pending PO removal or correction: this means "not now".
                      setSharedPoAnswers({})
                      setSharedPoEdits({})
                      if (onApprove) void run(() => onApprove())
                    }}
                    disabled={busy || (multiCandNeedsTarget && !linkTargetReady)}
                    title={
                      multiCandNeedsTarget
                        ? 'Link into the selected shipment without taking any value from the email'
                        : keepMeansBlank
                          ? 'Mark reviewed and leave these fields empty — writes nothing, records no per-field ruling, the leg leaves the desk'
                          : 'Mark reviewed and leave every stored value alone — writes nothing, records no per-field ruling, the leg leaves the desk'
                    }
                    className={cn(ACTION_BTN, ACTION_VARIANT.neutral)}
                  >
                    {busy && <Loader2 size={13} className="animate-spin" />}
                    {multiCandNeedsTarget
                      ? 'Link Without Field Changes'
                      : /*
                           "Leave", never "Keep".

                           `Keep` now belongs to ONE thing on this card: the per-row ruling, which
                           records a human decision and locks the field. This button is its opposite —
                           it records nothing and clears any ruling already ticked — so a bar reading
                           `Keep All Current` beside `Keep Vendor Code` put the two furthest-apart
                           outcomes behind the same verb, separated only by the word "All".

                           `Leave …` also matches the empty-Current wording that was already here, so
                           the decline reads the same way whether or not the leg stores anything, and
                           "All" still appears the moment there is more than one row — without it the
                           label understates its reach on exactly the legs where reach matters.
                        */
                        keepMeansBlank
                        ? conflicts.length > 1
                          ? 'Leave All Blank'
                          : 'Leave Blank'
                        : conflicts.length > 1
                          ? 'Leave All As Is'
                          : 'Leave As Is'}
                  </button>
                )}
                {(onSaveAndApprove || onApprove || multiCandNeedsTarget) && (
                  <button
                    type="button"
                    onClick={handleSaveAndApprove}
                    disabled={!canSave}
                    title={
                      multiCandNeedsTarget
                        ? linkTargetReady
                          ? `Link into ${selectedJobLabel ?? 'selected shipment'} and apply field decisions`
                          : 'Select a shipment above first'
                        : sharedPoRemovals.length > 0
                          ? /* Spelled out, because it is the one action on this card that changes
                               what a shipment CONTAINS rather than what it says. */
                            `Take PO ${sharedPoRemovals
                              .map((r) => r.poNumber)
                              .join(', ')} off this shipment — the purchase order and the other shipment are untouched${
                              changeCount > sharedPoRemovals.length
                                ? `, and ${changeCount - sharedPoRemovals.length} field change${
                                    changeCount - sharedPoRemovals.length === 1 ? '' : 's'
                                  } are applied`
                                : ''
                            }`
                          : sharedPoCorrections.length > 0
                            ? `Correct the PO line${
                                sharedPoCorrections.length === 1 ? '' : 's'
                              } on this shipment — the purchase order's own record is unchanged except where you retyped its number`
                            : changeCount > 0
                            ? `Apply ${changeCount} change${changeCount === 1 ? '' : 's'} — the leg leaves the desk`
                            : sharedPoSplits > 0
                              ? 'Mark reviewed — the PO stays on both shipments and nothing is written'
                              : keptRows.length > 0
                                ? `Record that the stored ${keptRows.map((r) => r.label).join(', ')} ${
                                    keptRows.length === 1 ? 'is' : 'are'
                                  } right — no value is written, but a later email that disagrees will be flagged`
                                : 'Mark reviewed — nothing is written, the leg leaves the desk'
                    }
                    className={cn(ACTION_BTN, ACTION_VARIANT.primary)}
                  >
                    {busy && <Loader2 size={13} className="animate-spin" />}
                    {/*
                      The label names the strongest true thing the click does, and nothing weaker.

                      When there IS something to write, that is the apply: `Apply FEFALT`, `Link —
                      Apply 2 Changes`. Prefixing those with `Mark Reviewed —` was tried and read as
                      ceremony in front of the real verb — on a card already stacking three open
                      questions, the operator has to get past a phrase about bookkeeping to reach the
                      one word that says what changes. The leg's fate is not lost: it moves to the
                      title, which is where a consequence belongs when the label is already carrying
                      an action.

                      When there is NOTHING to write, no action exists to name, and the old
                      `Confirm Reviewed` / `Approve` filled that void with a word for a thing that
                      does not happen. That is the one case the explicit verb earns its place.

                      `applyToken` names the value rather than counting it — a bare count made the
                      operator trust that the highlighted candidate was the one being taken. Capped
                      at 14 characters upstream, so it never crowds the bar.
                    */}
                    {editing
                      ? 'Submit'
                      : /* The shared-PO answer, when it is the whole of the click — see
                           `sharedPoVerdictLabel`. */
                        (sharedPoVerdictLabel ??
                        (multiCandNeedsTarget
                        ? changeCount > 0
                          ? `Link — Apply ${changeCount} Change${changeCount === 1 ? '' : 's'}`
                          : /* "Link & Apply" with nothing to apply named an action that does not
                               happen; linking IS the whole effect here. */
                            'Link — No Changes'
                        : changeCount > 0
                          ? applyToken
                            ? `Apply ${applyToken}`
                            : `Apply ${changeCount} Change${changeCount === 1 ? '' : 's'}`
                          : keepColumns.length > 0
                            ? /* Nothing to write, but not nothing to do: the operator ticked
                                 "Keep current" on these rows and that ruling is what the click
                                 commits. The old label here said "No Changes", which is true of the
                                 VALUES and false about the click. Named like `applyToken` — the one
                                 field when there is one, a count otherwise — and distinguished from
                                 the bulk "Leave All As Is" beside it by naming what it is about. */
                              keptRows.length === 1
                              ? `Keep ${keptRows[0]!.label}`
                              : `Keep ${keptRows.length} Fields`
                            : /* A question with a real answer keeps it ("Track it" under "Is this a
                                 real shipment?"); the eleven generic fall-throughs now say what the
                                 click does instead of naming a ceremony. */
                              (desk?.question.affirm ?? NO_CHANGE_VERDICT)))}
                  </button>
                )}
                {/* F11: multi-candidate escape hatch — genuinely new shipment (e.g. 拼櫃) without linking */}
                {!editing && multiCandNeedsTarget && onApprove && (
                  <button
                    type="button"
                    data-testid="confirm-as-separate"
                    onClick={() => {
                      if (busy || readOnly) return
                      void run(() => onApprove())
                    }}
                    disabled={busy}
                    title="Confirm this provisional as its own shipment — do not link into a candidate above"
                    className={cn(ACTION_BTN, ACTION_VARIANT.secondary)}
                  >
                    {busy && <Loader2 size={13} className="animate-spin" />}
                    Confirm as Separate Shipment
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
