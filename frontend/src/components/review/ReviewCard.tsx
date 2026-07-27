import { useMemo, useState } from 'react'
// Action-bar buttons are text-only — the only icon left in the bar is the busy spinner, which is
// state, not decoration. ExternalLink/Mail still mark the source-email affordances.
import { Check, ChevronDown, ChevronRight, ExternalLink, Loader2, Mail, NotebookPen } from 'lucide-react'
import { Badge } from '../ui/Badge'
import {
  ConflictRow,
  changesStoredValue,
  existingValueOf,
  isCandidateResolution,
  proposedResolutionOf,
  proposedValueOf,
  splitCandidates,
} from './ConflictRow'
import {
  fieldUnit,
  groupConflictFields,
  isPortColumn,
  mapCriticFieldToColumn,
  reviewFieldLabel,
  isNumericColumn,
  normalizeNumericInput,
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
import { liveValueForField, partitionAppliedConflicts } from '../../lib/conflict-applied'
import { emailKeyPinsThisLeg } from '../../lib/email-key-pin'
import { isNonIdentifier } from '../../lib/identifier-shape'
import { isCriticalColumn } from '../../lib/review-critical'
import {
  type CriticConflict,
  type CriticReview,
  type CriticReviewCompact,
} from '../../lib/critic-review'
import { CandidateLegsPanel } from './CandidateLegsPanel'
import { ReviewPoStylesSection, proposedStyleForPo } from './ReviewPoStylesSection'
import type { ReviewShipment } from '../../hooks/use-review-queue'
import type { LinkedPO, ShipmentDetail } from '../../hooks/use-shipments'
import { cn, formatDateTime } from '../../lib/utils'
import { parseSender } from '../../lib/email-sender'
import { buildNeedsAttentionGroups, isExpandableMiss, portsLinkedFromRoute } from './needs-attention'
import { candidateDeskQuestion, conflictDeskQuestion, pickDeskQuestion } from './desk-question'
import { NeedsAttentionMeshMiss } from './NeedsAttentionMeshMiss'
import {
  REVIEW_COL,
  REVIEW_FS,
  REVIEW_GROUP_HEADER,
  REVIEW_HEAD,
  REVIEW_PANEL,
  REVIEW_PANEL_DOT,
  REVIEW_PANEL_ITEM,
  REVIEW_PANEL_LIST,
  REVIEW_TABLE_CLASS,
  REVIEW_TH,
} from './review-table-layout'
import { ReviewColGroup } from './ReviewColGroup'

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

function initialResolutions(conflicts: CriticConflict[]): Record<string, string> {
  const out: Record<string, string> = {}
  // Seeded with the agent's proposal: the table reads as a diff, and approving accepts it. A queued
  // conflict still has no safe AUTO-pick, so the primary button NAMES the number of stored values it
  // would overwrite ("Approve 3 changes") — pre-filled must not read as pre-approved.
  // #360: the seed is the RESOLUTION value — the master CODE for resolved party candidates.
  // Numeric columns are normalised first: an agent value off a packing list arrives grouped
  // ("1,240"), and a number <input> renders a grouped string as BLANK — which would look like the
  // agent proposed nothing. Strip the separators so the seed survives; display re-groups it.
  for (const c of conflicts) {
    const raw = proposedResolutionOf(c)
    const column = mapCriticFieldToColumn(c.field)
    out[c.field] = isNumericColumn(column) ? normalizeNumericInput(raw) : raw
  }
  return out
}

function existingValue(c: CriticConflict): string {
  return existingValueOf(c)
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

/** Leg columns that are supposed to hold a shipment identifier — checked for header-row junk. */
const LEG_IDENTIFIER_FIELDS = [
  { field: 'soNumber', label: 'SO number' },
  { field: 'bookingNo', label: 'booking number' },
  { field: 'hblNumber', label: 'B/L number' },
] as const

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
   * The email's own strong key already names THIS leg (see email-key-pin.ts). AMBIGUOUS_MATCH fires on
   * `so_no`, which every leg of one order shares — 11 of them on S13784413 — so the desk asked "which
   * shipment?" about a leg whose HBL the email had already stated exactly. The panel excludes the leg
   * you are on, so the five it offered were all wrong, and the `suggested` one was a different HBL that
   * merely shared a vessel and ETD.
   */
  const emailKeyPin = useMemo(() => emailKeyPinsThisLeg(matchAmbiguity, legValues), [matchAmbiguity, legValues])
  /** Escape hatch: hiding a control on an inference needs a way back. */
  const [pinOverridden, setPinOverridden] = useState(false)
  const identityPinned = emailKeyPin != null && !pinOverridden
  const isAmbiguousMatch =
    !identityPinned && (criticReview?.riskFlags ?? []).some((f) => f.code === 'AMBIGUOUS_MATCH')
  const hasCandidateLegs = !identityPinned && (matchAmbiguity?.candidates?.length ?? 0) >= 2
  // Identify/link: weak-identity fold OR ambiguous-match (which real shipment?) — #146
  // Still show Identify when ambiguous but no candidate payload (legacy legs) or as fallback under panel
  const showIdentify = !readOnly && !!onIdentify && (isWeakIdentity || isAmbiguousMatch)
  const [identField, setIdentField] = useState<'booking_no' | 'so_no' | 'hbl_awb_fcr_no'>('booking_no')
  const [identValue, setIdentValue] = useState('')
  const [identResult, setIdentResult] = useState<IdentifyResult | null>(null)
  const [identBusy, setIdentBusy] = useState(false)
  /** Multi-candidate target — must pick before Link & apply. */
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null)
  const shipmentId = (shipment as { id?: string }).id
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

  const rawConflicts = useMemo(
    () => criticReview?.conflicts ?? [],
    [criticReview],
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
   * Already-applied is decided FIRST, before the qty-specific settle. A qty row the leg literally
   * holds (784 stated, 784 stored) belongs in "already on the shipment" where the operator can see it;
   * running the qty filter first would drop it silently, and the green line would undercount.
   * filterActionableConflicts still owns its other two routes (the PO shipment total, all-candidates),
   * which are settles for a different reason and are not claims that the value was applied.
   */
  const { open: unapplied, applied: appliedConflicts } = useMemo(
    () => partitionAppliedConflicts(deskConflicts, legValues),
    [deskConflicts, legValues],
  )
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
  const [appliedOpen, setAppliedOpen] = useState(false)
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
    const s = shipment as unknown as Record<string, unknown>
    const linked = (idKey: string, value: unknown): string | null =>
      s[idKey] ? nameOf(value) : null
    return {
      customer: linked('customerId', s.customer),
      forwarder: linked('forwarderId', s.forwarder),
    }
  }, [shipment])

  const needsAttentionGroups = useMemo(
    () =>
      buildNeedsAttentionGroups({
        riskFlags: criticReview?.riskFlags,
        reviewReasons,
        conflictsCount: tableOwnedCount,
        identityPinned,
        partiesLinked,
        portsLinked: portsLinkedFromRoute((shipment as { route?: string | null }).route),
        hasPo,
        // Rule A: Review desk shows decision items only; FYI stays on shipment detail.
        desk: 'decision',
      }),
    [criticReview, reviewReasons, shipment, tableOwnedCount, hasPo, linkedPOs, identityPinned, partiesLinked],
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
   * only what needs an answer. Edit mode still gets the full grid: managing POs is what Edit is for,
   * and Open Shipment is one click away for everything else.
   */
  const poProposalCount = useMemo(
    () => linkedPOs.filter((p) => proposedStyleForPo(p.poNumber, reviewReasons) != null).length,
    [linkedPOs, reviewReasons],
  )
  const poQuestionOpen = useMemo(
    () => needsAttentionGroups.some((g) => g.items.some((i) => i.lineId.startsWith('w-po'))),
    [needsAttentionGroups],
  )
  const poNeedsReview = poProposalCount > 0 || poQuestionOpen

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

  const naPick = useMemo(() => pickDeskQuestion(needsAttentionGroups), [needsAttentionGroups])
  const contestedFields = useMemo(
    () =>
      conflicts.map((c) => ({
        label: reviewFieldLabel(c.field, c.label),
        candidateCount: splitCandidates(c).proposed.length,
        currentEmpty: existingValue(c).trim() === '',
      })),
    [conflicts],
  )
  const deskPick = useMemo(() => {
    // Outranks everything: if the leg was parsed out of a header row, no field decision on it matters.
    if (junkIdentifier) {
      return {
        question: {
          question: 'Is this a real shipment?',
          affirm: 'Yes — Track It',
          reject: 'Not a Shipment',
        },
        detailText: `Its ${junkIdentifier.label} is “${junkIdentifier.value}” — a column heading, not a number. This leg was most likely parsed out of a spreadsheet's header row.`,
        detailItem: null,
        rest: needsAttentionGroups,
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
      })
      if (fromCandidates) {
        return {
          question: fromCandidates.question,
          detailText: fromCandidates.detail,
          detailItem: null,
          rest: needsAttentionGroups,
        }
      }
    }
    const fromTable = conflictDeskQuestion(contestedFields)
    if (fromTable) {
      return {
        question: { ...fromTable.question, reject: naPick?.question.reject ?? null },
        detailText: fromTable.detail,
        detailItem: null,
        rest: needsAttentionGroups,
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
    needsAttentionGroups,
    junkIdentifier,
    hasCandidateLegs,
    matchAmbiguity,
  ])
  const restNeedsTitles = useMemo(
    () =>
      (deskPick?.rest.reduce((n, g) => n + g.items.length, 0) ?? 0) >= ALSO_TITLE_THRESHOLD,
    [deskPick],
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
  const resolveSourceEmail = useMemo(() => {
    const byGraphId = new Map<string, ReviewEmail>()
    for (const e of emails) {
      if (e.graphMessageId && e.id && !e.bodyMissing) byGraphId.set(e.graphMessageId, e)
    }
    return (sourceEmailId: string | null | undefined) => {
      if (!sourceEmailId) return null
      const em = byGraphId.get(sourceEmailId)
      if (!em) return null
      return {
        open: () => openEmailWindow(em),
        title: `Open the source email — ${em.subject}`,
      }
    }
  }, [emails])

  const [resolutions, setResolutions] = useState<Record<string, string>>(() =>
    initialResolutions(conflicts),
  )
  /** Card-level edit mode. The table reads as a clean diff until the operator asks to change it. */
  const [editing, setEditing] = useState(false)

  // Re-seed when the conflict set identity changes (new payload / leg).
  const conflictKey = useMemo(
    () => conflicts.map((c) => c.field).join('|'),
    [conflicts],
  )
  const [seededKey, setSeededKey] = useState(conflictKey)
  if (seededKey !== conflictKey) {
    setSeededKey(conflictKey)
    setResolutions(initialResolutions(conflicts))
    setEditing(false)
  }

  const setResolution = (field: string, v: string) => {
    setResolutions((prev) => ({ ...prev, [field]: v }))
  }

  const startEditing = () => setEditing(true)

  /** Cancel = leave edit mode AND drop the edits, back to the agent's proposal. Leaving them applied
   *  after "Cancel" would silently arm Submit with values the operator just backed out of. */
  const cancelEditing = () => {
    setResolutions(initialResolutions(conflicts))
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
      if (v !== existing) fields[col] = v
    }
    return fields
  }, [conflicts, resolutions])

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
    [conflicts, fieldsToApply],
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
        return v !== '' && v !== existingValue(c) && !isCandidateResolution(c, v)
      }),
    [conflicts, resolutions],
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
  /** Any cell diverged from the agent's proposal (operator applied a different value). */
  const hasHumanEdits = useMemo(
    () =>
      conflicts.some((c) => (resolutions[c.field] ?? '').trim() !== proposedResolutionOf(c).trim()),
    [conflicts, resolutions],
  )
  // Column 3 label tracks state: agent default → edit mode → human-applied values.
  const proposedColumnLabel = editing ? 'Resolution' : hasHumanEdits ? 'Edited' : 'AI Proposed'
  /**
   * How many stored values Approve would overwrite. This is the count the primary button NAMES —
   * one informed click beats a row-by-row confirm ritual, but a bare "Approve" would hide what is
   * being accepted, which is the whole reason these legs are queued.
   */
  const changeCount = useMemo(
    () => conflicts.filter((c) => changesStoredValue(c, resolutions[c.field] ?? '')).length,
    [conflicts, resolutions],
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
    const values = Object.values(fieldsToApply)
    if (values.length !== 1) return null
    const raw = String(values[0] ?? '').trim()
    if (!raw || raw.length > 14) return null
    return raw
  }, [fieldsToApply])
  /** Nothing is stored on any contested row, so "keep what is there" means leaving it blank — say so. */
  const keepMeansBlank = useMemo(
    () => conflicts.length > 0 && conflicts.every((c) => existingValue(c).trim() === ''),
    [conflicts],
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
    !readOnly && ((conflicts.length > 0 && !allConflictsSelfServe) || poNeedsReview)
  /** Edit mode as the GRID sees it — read-only history never edits, whatever `editing` says. */
  const gridEditing = editing && !readOnly
  const deskEmpty = needsAttentionGroups.length === 0 && conflicts.length === 0
  const judgmentOnly = needsAttentionGroups.length > 0 && conflicts.length === 0
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

  // Collapsed on open — expand only when the operator needs the email.
  const [emailsOpen, setEmailsOpen] = useState(false)

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
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
    setEditing(false)
    const hasFieldEdits = Object.keys(fieldsToApply).length > 0
    if (hasFieldEdits && onSaveAndApprove) {
      void run(() =>
        onSaveAndApprove({
          fields: fieldsToApply,
          note: note.trim(),
          corrections,
          expectedUpdatedAt: id.updatedAt,
        }),
      )
      return
    }
    if (onApprove) {
      void run(() => onApprove())
      return
    }
    if (onSaveAndApprove) {
      void run(() =>
        onSaveAndApprove({
          fields: fieldsToApply,
          note: note.trim(),
          corrections,
          expectedUpdatedAt: id.updatedAt,
        }),
      )
    }
  }

  const handleApproveCollapsed = () => {
    if (busy || readOnly) return
    if (multiCandNeedsTarget) {
      handleLinkAndApply(false)
      return
    }
    if (!onApprove) return
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
                title="Confirm without applying AI Proposed values"
                className={cn(ACTION_BTN, ACTION_VARIANT.success)}
              >
                {busy && <Loader2 size={13} className="animate-spin" />}
                Keep Existing
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
            <div
              className="rounded-md border border-border/80 bg-surface-800/80 px-2.5 py-1.5 text-[11px] text-text-secondary"
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
            </div>
          )}

          {/* Needs attention is a triage PROMPT — once the item is resolved (Approved/Rejected views,
              or any non-provisional shipment) it has been answered, so it stops being shown rather
              than following the leg around as history. The reasons stay on the leg and in the
              shipment history; only the prompt goes. */}
          {/* Also renders for a conflicts-only leg now: the headline comes from the table there, and
              without this the card would show a grid with no statement of what it is asking. */}
          {!readOnly && deskPick != null && (
            <div
              className={cn(
                REVIEW_PANEL,
                editing && 'border-status-warning/40 bg-status-warning/5',
              )}
              data-testid="needs-attention"
              data-editing={editing ? 'true' : 'false'}
            >
              {/* data-testid why-review kept for legacy tests — same shell as Critical band */}
              <div data-testid="why-review">
                {/*
                  The open QUESTION is the headline (see desk-question.ts). It replaces both the old
                  `Needs Attention` title and the group title that used to sit above the leading line —
                  two headings for what was often a single bullet — and the verdict buttons below are
                  worded as its answers. The line the headline speaks for becomes its subtext; anything
                  else the leg asks follows under "Also", flat, because a group title per bullet was
                  the nesting that made this card hard to read.
                */}
                <p
                  className={`${REVIEW_FS.topic} font-semibold text-text-primary`}
                  data-testid="desk-question"
                >
                  {deskPick?.question.question ?? 'Needs Attention'}
                </p>

                {deskPick?.detailItem &&
                  (isExpandableMiss(deskPick.detailItem) ? (
                    <ul className="mt-1">
                      <NeedsAttentionMeshMiss item={deskPick.detailItem} />
                    </ul>
                  ) : (
                    <p
                      className={`mt-0.5 ${REVIEW_FS.body} text-text-secondary`}
                      title={deskPick.detailItem.evidence?.join(' · ') || undefined}
                      data-testid="desk-question-detail"
                    >
                      {deskPick.detailItem.text}
                    </p>
                  ))}

                {deskPick?.detailText && (
                  <p
                    className={`mt-0.5 ${REVIEW_FS.body} text-text-secondary`}
                    data-testid="desk-question-detail"
                  >
                    {deskPick.detailText}
                  </p>
                )}

                {(deskPick?.rest.length ?? 0) > 0 && (
                  <div className="mt-2.5 border-t border-border pt-2" data-testid="needs-attention-rest">
                    <p className={`${REVIEW_FS.meta} font-semibold text-text-muted`}>Also</p>
                    <div className="space-y-1">
                      {deskPick!.rest.map((g) => (
                        /* Grouping is real and ordered; the TITLE is earned rather than automatic.
                           One or two lines read fine bare — the item text names its own subject
                           ("Customer not in master — …") and a title per bullet was pure nesting. Past
                           three the bare list turns into a blob, so the titles come back. */
                        <div key={g.groupId} data-testid={`needs-group-${g.groupId}`} aria-label={g.title}>
                          {restNeedsTitles && (
                            <p className={`${REVIEW_FS.meta} font-semibold text-text-secondary`}>
                              {g.title}
                            </p>
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
                  </div>
                )}
                {/* Kept for the case the headline cannot cover: the table has nothing to apply, so the
                    operator is being asked for a judgement, not a diff. One line, inside the prompt it
                    belongs to — it used to float between panels captioning whichever box followed. */}
                {judgmentOnly && (
                  <p
                    className="mt-2.5 border-t border-border pt-2 text-xs text-text-muted"
                    data-testid="review-judgment-only"
                  >
                    No field changes to apply — answer above, or park it if you need to go and ask.
                  </p>
                )}
              </div>
            </div>
          )}

          {deskEmpty && !readOnly && (
            <div
              data-testid="review-ready-state"
              className="rounded-lg border border-status-success/25 bg-status-success/10 px-3 py-2 text-xs text-status-success"
            >
              {/* Name what settled it. "Ready to confirm" alone left the operator wondering what
                  happened to the five-way pick the card used to open with. */}
              {emailKeyPin && !pinOverridden ? (
                <>
                  This email is on the right shipment — its {emailKeyPin.label}{' '}
                  <span className="field-value font-mono">{emailKeyPin.value}</span> matches this
                  shipment and none of the alternatives. Nothing to decide.
                </>
              ) : (
                'Ready to confirm — no open decisions'
              )}
            </div>
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

          {criticReview == null && (
            <p className="text-[11px] text-text-muted" data-testid="no-critic-note">
              No agent analysis on this leg (committed before the critic payload, or created manually) — open the full shipment to compare values.
            </p>
          )}

          {/* Source emails under Needs attention — evidence while picking leg + fields */}
          {emails.length > 0 && (
            <div className="rounded-lg border border-border" data-testid="source-emails">
              <button
                type="button"
                onClick={() => setEmailsOpen((v) => !v)}
                aria-expanded={emailsOpen}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-surface-700/40"
              >
                {emailsOpen ? (
                  <ChevronDown size={14} className="shrink-0 text-text-muted" />
                ) : (
                  <ChevronRight size={14} className="shrink-0 text-text-muted" />
                )}
                <Mail size={14} className="shrink-0 text-text-muted" />
                <h4 className="text-xs font-semibold text-text-primary">
                  Source Emails
                  <span className="ml-2 text-xs font-normal text-text-muted">
                    · {emails.length}
                  </span>
                </h4>
              </button>
              {emailsOpen && (
                <div className="space-y-1.5 border-t border-border p-2.5" data-testid="source-emails-list">
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
            </div>
          )}

          {showIdentify && (
            <div className="rounded-lg border border-border bg-surface-900 px-3 py-2 space-y-2" data-testid="identify-shipment">
              <p className="text-[11px] font-medium text-text-muted">
                {hasCandidateLegs
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
            </div>
          )}

          {/* Rows the email asked for and the leg already stores. One line, not N grid rows pretending
              to be open questions — but openable, because "the email agreed with what we have" is a
              claim the operator should be able to check. */}
          {appliedConflicts.length > 0 && (
            <div className="rounded-lg border border-border" data-testid="review-applied-conflicts">
              <button
                type="button"
                onClick={() => setAppliedOpen((v) => !v)}
                aria-expanded={appliedOpen}
                className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-surface-700/40"
              >
                {appliedOpen ? (
                  <ChevronDown size={13} className="shrink-0 text-text-muted" />
                ) : (
                  <ChevronRight size={13} className="shrink-0 text-text-muted" />
                )}
                <Check size={13} className="shrink-0 text-status-success" />
                <span className="min-w-0 text-text-secondary">
                  <span className="font-semibold text-text-primary">
                    {appliedConflicts.length} field{appliedConflicts.length === 1 ? '' : 's'}
                  </span>{' '}
                  the email proposed {appliedConflicts.length === 1 ? 'is' : 'are'} already on the
                  shipment — nothing to apply
                </span>
              </button>
              {appliedOpen && (
                <ul className="space-y-1.5 border-t border-border px-3 py-2.5">
                  {appliedConflicts.map((c) => (
                    <li key={c.field} className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm">
                      <span className="w-40 shrink-0 font-medium text-text-secondary">
                        {reviewFieldLabel(c.field, c.label)}
                      </span>
                      <span className="field-value min-w-0 font-mono text-status-success">
                        {liveValueForField(c, legValues)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* One decision grid: POs + field conflicts share colgroup, headers, and border. */}
          {(() => {
            const canEditGrid = gridEditing
            const showPos = canEditGrid || (linkedPOs.length > 0 && poNeedsReview)
            const showConflicts = conflicts.length > 0
            if (!showPos && !showConflicts) return null
            // Shared thead only when both blocks show (one header, two section groups).
            // Solo PO / solo conflict each render their own thead via child defaults.
            const sharedThead = showPos && showConflicts
            return (
              <div
                className="max-w-full overflow-x-auto rounded-lg border border-border"
                data-testid="review-decision-grid"
              >
                {sharedThead && (
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
                        <th className={`${REVIEW_COL.reference} ${REVIEW_TH}`}>
                          {REVIEW_HEAD.reference}
                        </th>
                      </tr>
                    </thead>
                  </table>
                )}
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
                    embedded
                    proposedColumnLabel={proposedColumnLabel}
                  />
                )}
                {showConflicts && (
                  <table className={REVIEW_TABLE_CLASS}>
                    <ReviewColGroup />
                    {!sharedThead && (
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
                        </tr>
                      </thead>
                    )}
                    {groupConflictFields(conflicts).map(({ group, conflicts: rows }) => (
                      <tbody key={group}>
                        <tr className="border-b border-border">
                          {/* 4, not 3 — the Reference Email column. A short colSpan leaves the
                              group band ending mid-table with an unshaded box over the last column. */}
                          <td colSpan={4} className={REVIEW_GROUP_HEADER}>
                            {group}
                            <span className="ml-2 font-normal text-text-muted">
                              ({rows.length} {rows.length === 1 ? 'change' : 'changes'})
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
                              existingOverride={
                                isQtyConflict(c)
                                  ? existingQtyDisplay(c, liveQty)
                                  : liveValueForField(c, legValues)
                              }
                              resolveSourceEmail={resolveSourceEmail}
                              onRequestEdit={() => {
                                if (!readOnly) startEditing()
                              }}
                            />
                          )
                        })}
                      </tbody>
                    ))}
                  </table>
                )}
              </div>
            )
          })()}

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
                {!editing && onReject && deskPick?.question.reject && (
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
                    {deskPick.question.reject}
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
                      if (onApprove) void run(() => onApprove())
                    }}
                    disabled={busy || (multiCandNeedsTarget && !linkTargetReady)}
                    title={
                      multiCandNeedsTarget
                        ? 'Link into selected shipment without applying AI field proposals'
                        : keepMeansBlank
                          ? 'Confirm shipment and leave these fields empty — do not apply AI Proposed'
                          : 'Confirm shipment and keep Existing values — do not apply AI Proposed'
                    }
                    className={cn(ACTION_BTN, ACTION_VARIANT.success)}
                  >
                    {busy && <Loader2 size={13} className="animate-spin" />}
                    {multiCandNeedsTarget
                      ? 'Link Without Field Changes'
                      : /* "Keep Current" over an empty Current promises to keep something that is not
                           there. What the click actually does is decline every candidate. */
                        keepMeansBlank
                        ? 'Leave Blank'
                        : 'Keep Current'}
                  </button>
                )}
                {(onSaveAndApprove || onApprove || multiCandNeedsTarget) && (
                  <button
                    type="button"
                    onClick={handleSaveAndApprove}
                    disabled={!canSave}
                    /* The label is a plain verb, so the COUNT of stored values this overwrites lives
                       here — it is the whole reason the leg is queued, and it stays assertable. */
                    title={
                      multiCandNeedsTarget
                        ? linkTargetReady
                          ? `Link into ${selectedJobLabel ?? 'selected shipment'} and apply field decisions`
                          : 'Select a shipment above first'
                        : changeCount > 0
                          ? `Apply ${changeCount} change${changeCount === 1 ? '' : 's'} and confirm`
                          : 'Confirm this shipment — there is nothing to change'
                    }
                    className={cn(ACTION_BTN, ACTION_VARIANT.primary)}
                  >
                    {busy && <Loader2 size={13} className="animate-spin" />}
                    {editing
                      ? 'Submit'
                      : multiCandNeedsTarget
                        ? changeCount > 0
                          ? `Link & Apply ${changeCount} Change${changeCount === 1 ? '' : 's'}`
                          : 'Link & Apply'
                        : changeCount > 0
                          ? /* Name the value, not the ceremony: "Apply FEFALT" over a bare "Approve",
                               which made the operator trust that the highlighted candidate was the one
                               being taken. Plural falls back to the count. */
                            applyToken
                            ? `Apply ${applyToken}`
                            : `Apply ${changeCount} Change${changeCount === 1 ? '' : 's'}`
                          : /* Nothing to apply, so the label answers the headline instead ("Yes — Track
                               It" under "Is this a real shipment?"). Falls back to Confirm Reviewed when
                               the leg asks nothing nameable. Never "Keep Current": nothing is being kept
                               over an alternative, because there is no alternative. */
                            (deskPick?.question.affirm ?? 'Confirm Reviewed')}
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
