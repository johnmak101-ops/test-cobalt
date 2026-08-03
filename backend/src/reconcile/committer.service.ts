import { Injectable } from '@nestjs/common'
import type { Insertable } from 'kysely'
import type { DB } from '../db/kysely/db'
import { strongKeys, keysOverlap, normKey, str, date } from './match-keys'
import {
  guardVendorForwarder,
  isPlatformNotForwarder,
  isNotificationPlatformSender,
  setPlatformNotForwarderPatterns,
} from './vendor-forwarder-guard'
import { deriveState, classifyKindDetail, normMode } from './state'
import { currentIdentifierValues, deriveIdentifierRows } from './identifier-rows'
import { matchKeyIndexRows, mergeIdentityKeys } from './match-key-index'
import { MastersRepository } from '../db/repositories/masters.repository'
import { BookingRepository } from '../db/repositories/booking.repository'
import { PurchaseOrderRepository } from '../db/repositories/purchase-order.repository'
import { ShipmentRepository } from '../db/repositories/shipment.repository'
import { FieldLockRepository } from '../db/repositories/field-lock.repository'
import { SettingsRepository } from '../db/repositories/settings.repository'
import { loadEtdFallback } from '../settings/etd-fallback'
import { AuditRepository } from '../db/repositories/audit.repository'
import { EvidenceRepository } from '../db/repositories/evidence.repository'
import { resolvePoEnrichment, unattributedBrandStyle } from './po-enrichment'
import { needsHumanReview } from './committer-helpers'
import type { CriticReview } from '../decisions/critic-review.types'
import { mapFieldsToLegColumns, scheduleRetractionColumns } from './committer-leg-mapping'
import {
  findExistingLeg,
  findAdoptableZeroIdLeg,
  findSupersededByIdentityCorrection,
  findManualIdentityClash,
  findPoOnlyDuplicateRisk,
  findUnabsorbedStatedSiblings,
  findSiblingBooking,
  strongKeysConflict,
} from './committer-match'
import { aliasMapsFromFacts, MasterResolver } from './committer-master-resolver'
import { planPoReconcile, mergeReviewReasonsWithDataIssues, type SiblingPoHbl } from './committer-po-reconciler'
import { MilestoneSynchronizer } from './committer-milestones'
import { isAuditedBookingFill } from './fill-booking-audit'
import { collectSourceEvents } from './source-events'

// Re-export for any external import sites that still pull findExistingLeg from the service module.
export { findExistingLeg, findSupersededByIdentityCorrection, findSiblingBooking } from './committer-match'

/**
 * How many legs the QUEUE's matcher put forward for this group.
 *
 * Recorded beside the committer's own decision so a later reader can see the two disagreeing — the
 * matcher proposing N while the committer created a leg anyway — without re-deriving it from the
 * payload. That disagreement is invisible today: 179 of 181 active legs were created, 13 of them while
 * candidates were on the table.
 */
/** What happened to each field the merge proposed. See applyFields. */
export type FieldApplyOutcome = {
  /** Written to the leg. */
  applied: string[]
  /** Skipped — the leg already held exactly this value. Nothing for a human to look at. */
  alreadySame: string[]
  /** Written OVER a human-locked value (latest-email-wins, PR #232) — flagged for the operator. */
  contested: string[]
}

function matchCandidateCount(criticReview: unknown): number | null {
  const amb = (criticReview as { matchAmbiguity?: { candidates?: unknown[] } } | null | undefined)
    ?.matchAmbiguity
  return Array.isArray(amb?.candidates) ? amb.candidates.length : null
}


/** One reconciled shipment picture, ready to commit. */
export interface ReconGroup {
  fields: Record<string, unknown>
  pos: string[]
  /** POs the agent STATED on a B/L-anchored record without committing them as this shipment's contents
   *  (queue's `posStated`). Used ONLY to widen candidate lookup + findExistingLeg, so an AWB email reaches
   *  the sibling legs holding its other POs instead of minting a booking each. Never written to
   *  shipment_pos, never counted as this leg's cargo — see `matchPos` below and statedPosOf in the queue.
   *  Empty/undefined on the legacy path → matching is byte-identical to before. */
  posStated?: string[]
  /** The subset of `pos` the agent SWEPT UP rather than stated (queue `posInferred`) — typically rows
   *  from a programme-wide attachment that inherited the email's B/L. Stored on each link (0029) so a
   *  later email that NAMES the PO can displace this weak claim instead of losing to arrival order.
   *  Omitted → every PO is a stated claim, and the cross-HAWB guard behaves exactly as before. */
  posInferred?: string[]
  /** Per-PO unambiguous shipped qty, keyed by normalized po_no (normKey). Present only when the Matcher can
   *  attribute a real qty to an individual PO; absent (or a PO omitted) when the qty is a broadcast total. */
  poQty?: Record<string, number>
  matchKeys: Record<string, unknown>
  /** A PERSON typed this shipment into the New Shipment form (POST /shipments), rather than the
   *  pipeline deriving it from mail. Stamped on the leg (0028) because two committer rules must not
   *  act automatically on a hand-typed row — see findPoOnlyDuplicateRisk / findManualIdentityClash. */
  createdManually?: boolean
  emailTypes: string[]
  events: { emailType: string; receivedAt: string; graphId?: string | null }[]
  mode: string | null
  conversationId: string | null
  /** The booking was cancelled — the committed leg's leg_status becomes 'CANCELLED' instead of 'ACTIVE'.
   *  Undefined/false on the legacy path → leg stays 'ACTIVE' (unchanged). */
  cancelled?: boolean
  /** The journey chain (queue groupJourney, latest-carrying-wins). Stored as JSON on
   *  `shipments.journey`; the route string renders it as `PVG->DEL->LHR`. Null/absent = no statement —
   *  applyFields skips nulls, so a later decision without a chain never erases an earlier one, which
   *  matches the queue's latest-CARRYING-wins lift exactly. */
  journey?: { seq: number; mode: string; pol: string; pod: string; doc: string | null }[] | null
  /** DIVISION statements riding the decision (queue `groupDivisions` — dedup'd events, verbatim quotes).
   *  Evidence for the stated-link removal in `apply`: a PO named here AND absent from `pos` leaves the
   *  matched leg's shipment_pos, audited with the statement's own words. Never merged as a field. */
  divisions?: { pos: string[]; direction?: string; target?: string; quote?: string; statedAt?: string }[]
  /** True when EVERY source email was sent by the CVP/TradeLinkOne notification platform — the leg is a
   *  vendor/PO notification, not a booked move (drives classifyKind rule (c)). Set on the rebuild path
   *  (senders known); undefined on the agent path, where the committer resolves it from the source emails. */
  fromPlatform?: boolean
  conflicts: string[]
  evidenceIds: string[]
  /** Critic's per-shipment confidence (0-100) and the resulting review gate. Undefined on the
   *  legacy reconcile path (those legs stay `confirmed`); set on the agent decision path. */
  confidence?: number | null
  reviewStatus?: 'provisional' | 'confirmed'
  /** the agent gate's reasons for routing to review — preferred over raw conflicts in the review queue */
  reviewReasons?: string[] | null
  /** Critic advisory JSON (agent path). Undefined on legacy reconcile — do not wipe existing column on amend. */
  criticReview?: object | null
  /** #173 dual-auto pin from queue — honor after strong-match verify. */
  dualAutoTarget?: { shipmentId: string; basis?: string } | null
  /** every value each identity field ever held (current + alternates) — persisted as searchable history */
  identifiers?: {
    type: string
    value: string
    docType?: string | null
    rank?: number | null
    isCurrent?: boolean
    sourceEmailId?: string | null
    observedAt?: string | null
  }[]
  /** co-valid customer entities with roles — persisted as shipment_parties (the primary == booking.customerId) */
  entities?: {
    type: string
    value: string
    role?: string | null
    docType?: string | null
    rank?: number | null
    isPrimary?: boolean
    sourceEmailId?: string | null
    observedAt?: string | null
  }[]
}

export interface CommitResult {
  action: 'create_booking' | 'amend_fields'
  jobNo: string
  bookingId: string
  shipmentId: string
  state: string
  conflicts: string[]
  supersededLockedFields: string[]
  /** Per-field result of the amend (null on a create — everything was written). */
  fieldOutcome?: FieldApplyOutcome | null
}

/**
 * Deterministic committer: applies a reconciled group to the tracking truth.
 * Safety invariants live HERE (tested code), not in the LLM: latest-email-wins field updates (a newer
 * email that disagrees with a human-locked field is applied and the field flagged CONTESTED for review,
 * not silently dropped), audit on every change, idempotency (find-or-update a leg by its match_keys + PO
 * consistency). All DB access is delegated to repositories.
 */
@Injectable()
export class CommitterService {
  private readonly mastersResolver: MasterResolver
  private readonly milestones: MilestoneSynchronizer

  constructor(
    private readonly masters: MastersRepository,
    private readonly bookings: BookingRepository,
    private readonly shipments: ShipmentRepository,
    private readonly fieldLocks: FieldLockRepository,
    private readonly audit: AuditRepository,
    private readonly evidence: EvidenceRepository,
    private readonly purchaseOrders: PurchaseOrderRepository,
    private readonly settings: SettingsRepository,
  ) {
    // nestjs-doctor-ignore-next-line architecture/no-manual-instantiation -- lightweight collaborator, not a Nest provider
    this.mastersResolver = new MasterResolver(masters)
    this.milestones = new MilestoneSynchronizer(shipments)
  }

  async apply(g: ReconGroup): Promise<CommitResult> {
    const f = g.fields
    const gk = strongKeys(g.matchKeys)

    // MOVE 3: overlay platform_not_forwarder patterns from Resolution Rules (lhs = regex/substring).
    // SEED patterns in vendor-forwarder-guard always apply; admin facts extend without redeploy.
    const approvedFacts = await this.masters.listResolution('approved')
    const platformFacts = approvedFacts.filter(
      (row) => row.kind === 'platform_not_forwarder' && row.lhs,
    )
    setPlatformNotForwarderPatterns(platformFacts.map((row) => row.lhs))
    // Curated exact aliases for forwarder/port — load once per apply, pass into resolver (#145)
    const aliasMaps = aliasMapsFromFacts(approvedFacts)

    // de-correction STEP 2/3 (2026-07-12): no silent model-corrections, no shadow metering.
    // Platform names stay on the field for display but never link (LLM master-matcher on queue owns
    // party resolution; track only exact/code + curated exact facts for ports).
    const platformForwarder = isPlatformNotForwarder(str(f.forwarder_name))
    // `reviewHints` = the shipment itself is doubtful → always review.
    // `masterMissHints` = the shipment is fine but a party/port is not in master data → curation, not a
    // review; gated on the critic band by needsHumanReview (see its doc). BOTH are kept on the leg's
    // review_reasons either way, so the record survives even when the leg commits confirmed.
    const reviewHints: string[] = []
    const masterMissHints: string[] = []
    if (platformForwarder) {
      reviewHints.push(
        `forwarder_name "${str(f.forwarder_name)}" looks like a notification platform, not a freight forwarder — left unlinked for review`,
      )
    }

    const { customerId, vendorId, forwarderLink, polLink, podLink } = await this.mastersResolver.resolveAll(
      platformForwarder ? { ...f, forwarder_name: null } : f,
      aliasMaps,
    )
    // Exact-only link; unresolved free-text is a MASTER-DATA gap (queue LLM should have resolved codes
    // upstream), not a shipment defect — needsHumanReview gates it on the band.
    if (!platformForwarder && str(f.forwarder_name) && !forwarderLink.id) {
      masterMissHints.push(
        `forwarder_name "${str(f.forwarder_name)}" did not exact-match a master (LLM matcher owns fuzzy; left unlinked)`,
      )
    }
    const polRaw = str(f.poi ?? (f as Record<string, unknown>).pol)
    const podRaw = str(f.pod)
    if (polRaw && !polLink)
      masterMissHints.push(`pol "${polRaw}" did not exact/curated-match a port master — left unlinked`)
    if (podRaw && !podLink)
      masterMissHints.push(`pod "${podRaw}" did not exact/curated-match a port master — left unlinked`)

    const forwarderId = forwarderLink.id
    const polId = polLink?.id ?? null
    const podId = podLink?.id ?? null
    const originCountry = polLink?.country ?? null

    // Phase-4 guard: a forwarder mislabeled as the vendor must never land in the vendor slot.
    // If flagged, the vendor link is dropped, the (empty) forwarder slot is filled, and the leg
    // is routed to provisional review with a reason. See cobalt-master-data-governance.
    const vendorCodeStr = str(f.vendor_code)
    const guard = guardVendorForwarder({
      vendorCode: vendorCodeStr,
      vendorId,
      forwarderId,
      forwarderIdForVendorCode: vendorCodeStr ? await this.masters.forwarderIdByName(vendorCodeStr) : null,
      approvedKeys: await this.masters.approvedKeys(),
    })
    const effVendorId = guard.vendorId
    const effForwarderId = guard.forwarderId

    const emailTypes = new Set(g.emailTypes)
    // Tunable transit allowances for the no-arrival-data Delivered fallback (Settings page).
    const state = deriveState(emailTypes, f, new Date(), { etdFallback: await loadEtdFallback(this.settings) })
    // A cancelled booking is marked leg_status='CANCELLED' (the UI surfaces it as Cancelled); otherwise the
    // leg keeps the existing 'ACTIVE' default. This is a lifecycle flag, not a lockable field.
    const legStatus: 'ACTIVE' | 'CANCELLED' = g.cancelled ? 'CANCELLED' : 'ACTIVE'
    // SHIPMENT vs DOCUMENT: Unlinked Documents is Invoice/Billing only; bare orphans stay SHIPMENT.
    // fromPlatform: the rebuild path pre-computes it (senders in hand); on the agent path the DTO carries no
    // sender, so resolve it here from the source emails' graph ids (defense in depth — see classifyKind (c)).
    const fromPlatform = g.fromPlatform ?? (await this.allSourceEmailsFromPlatform(g))
    const { kind, rule: kindRule } = classifyKindDetail(emailTypes, f, { fromPlatform })
    if (kindRule === 'bare_orphan')
      reviewHints.push('no booking/SO/HBL identity and no lifecycle email type — verify this is a real shipment')
    if (kindRule === 'platform_only')
      reviewHints.push('platform/portal email without carrier identity — verify booking_no is not a portal LPO')
    if (kindRule === 'invoice_with_booking')
      reviewHints.push(
        'Typed as Invoice/Billing but booking number is present — confirm this is a shipment, not an unlinked invoice',
      )

    // The critic's band decides whether a pure master-data gap is worth a human (see needsHumanReview).
    // A `high` band with no blocking hint keeps the agent's own verdict (gate + band both said confirm) —
    // it must not be silently overridden into the queue by a forwarder that is merely missing upstream.
    const criticBand = (g.criticReview as CriticReview | null | undefined)?.confidence?.band ?? null
    const needsReview =
      // the vendor/forwarder guard is an unconditional force, exactly as before — never band-gated
      guard.misclassified ||
      needsHumanReview({ band: criticBand, blocking: reviewHints, masterMiss: masterMissHints })
    const effReviewStatus = needsReview ? 'provisional' : g.reviewStatus
    // Reasons are recorded on the leg either way — a confirmed leg keeps the master-data gap as a record
    // (the detail page's review banner is gated on reviewStatus==='provisional', so it stays quiet).
    const effReasons = ((): string[] | null => {
      // #129: never stack duplicate multi-leg / gate strings across rematches
      const all = [...new Set([...(reviewReasonsFor(g) ?? []), ...guard.reasons, ...reviewHints, ...masterMissHints])]
      return all.length ? all : null
    })()

    const legValues: Record<string, unknown> = {
      ...mapFieldsToLegColumns(f), // direct field→column mapping (raws, cargo, dates, scac fallback, CSV dedupe)
      mode: normMode(g.mode),
      state,
      kind,
      forwarderId: effForwarderId,
      polId,
      podId,
      originCountry,
      // persist the conversationId so a zero-identity (keyless, PO-less) leg has a cross-run handle (A2).
      matchKeys: g.conversationId ? { ...g.matchKeys, conversation_id: g.conversationId } : g.matchKeys,
      // the journey chain, as JSON (migration 0031). One site covers both create paths and the
      // applyFields update path, exactly like every other legValues column.
      journey: g.journey?.length ? JSON.stringify(g.journey).slice(0, 2000) : null,
    }

    // matching / idempotency. A leg matches when:
    //  - it shares a STRONG key with the group AND is PO-consistent (the normal case); OR
    //  - they share a PO and at least ONE side has NO strong id — i.e. a nascent PO-only leg gaining its
    //    first id, or a PO-only follow-up/re-POST. This stops Option A's strong-id-less legs from spawning a
    //    duplicate on the next email. It deliberately does NOT match by PO when BOTH carry DIFFERENT strong
    //    ids — that is a PO reassignment the gate reviews, never a silent merge here.
    const groupPos = new Set(g.pos.map((p) => normKey(p)).filter(Boolean))
    // MATCHING set = the POs we commit ∪ the POs a B/L-anchored record merely STATED (g.posStated). The two
    // are deliberately different sets: `groupPos` is this leg's CARGO and drives shipment_pos, poQty and the
    // duplicate-risk checks below; `matchPos` only answers "which existing leg is this email about".
    // Without the widening, an AWB email that states POs 28739/28747/28740 but anchors on 28739 cannot see
    // the legs holding the other two, so each mints its own booking (prod: JOB-2026-0009/0010). The queue
    // only fills posStated for records carrying an hbl/mbl, so this can never glue PO-to-PO on subject text.
    const matchPos = new Set([...groupPos, ...(g.posStated ?? []).map((p) => normKey(p)).filter(Boolean)])
    // Candidate SUPERSET instead of an allLegs() full-scan: the strong-key index (shipment_match_keys, 0003)
    // ∪ the shared-PO index (purchase_orders.po_number_norm, 0004). Same normalization + source as
    // findExistingLeg, so it provably contains every leg the strong-overlap / shared-PO branches could match.
    // The A2 zero-identity fallback (matches by conversationId inside match_keys — not index-covered) only
    // fires when the group has NO strong key AND NO PO; in that rare orphan-thread case we keep the full scan.
    const strongPairs = [...gk].map((k) => ({ type: k.slice(0, k.indexOf(':')), value: k.slice(k.indexOf(':') + 1) }))
    const legs =
      gk.size > 0 || matchPos.size > 0
        ? await this.shipments.candidateLegs(strongPairs, [...matchPos])
        : await this.shipments.allLegs()
    // ONE bulk load of the candidate bookings' PO numbers (bookingId -> [poNumber]) — the PO data findExistingLeg
    // sees is byte-identical to the old per-leg poNumbersFor; the matching itself is the pure, unit-tested fn.
    const posByBooking = await this.bookings.poNumbersByBooking(legs.map((l) => l.bookingId))
    let existing = findExistingLeg(legs, posByBooking, gk, matchPos, g.conversationId)

    // #173 C1.5: dual-auto pin — honor target after verify (never silent first-match when pin present)
    if (g.dualAutoTarget?.shipmentId) {
      const pinId = g.dualAutoTarget.shipmentId
      const pinned = legs.find((l) => l.id === pinId && l.linkedShipmentId == null)
      if (!pinned) {
        reviewHints.push(
          `dualAutoTarget ${pinId} not among candidate legs — provisional (no silent re-match)`,
        )
        // keep first-match existing only if it is the pin (impossible here) — else leave existing for
        // normal path but force provisional via reviewHints → needsReview
      } else {
        const legStrong = strongKeys(pinned.matchKeys as Record<string, unknown>)
        const conflict = strongKeysConflict(gk, legStrong)
        const overlap = gk.size > 0 && keysOverlap(legStrong, gk)
        if (conflict || !overlap) {
          reviewHints.push(
            `dualAutoTarget ${pinId} failed strong-key verify — provisional (no silent re-match)`,
          )
        } else {
          existing = pinned
        }
      }
    }

    // Thread-gains-its-first-identity: a keyed group that matched nothing may still be the SAME nascent
    // shipment as the thread's zero-identity provisional leg (created before any booking/SO/HBL arrived).
    // Adopt it — the normal amend path fills the identity + match_keys — instead of spawning a duplicate.
    let adoptedZeroId = false
    if (!existing && gk.size > 0 && g.conversationId) {
      const threadLegs = await this.shipments.legsByConversationId(g.conversationId)
      const threadPos = await this.bookings.poNumbersByBooking(threadLegs.map((l) => l.bookingId))
      const adopted = findAdoptableZeroIdLeg(threadLegs, threadPos, g.conversationId)
      if (adopted) {
        existing = adopted
        adoptedZeroId = true
      }
    }

    let bookingId: string
    let shipmentId: string
    let jobNo: string
    let action: CommitResult['action']
    const supersededLockedFields: string[] = []
    /** Only the amend path applies over an existing leg; a create writes every field by definition. */
    let fieldOutcome: FieldApplyOutcome | null = null
    /** 0027: what this commit DID, recorded on every branch — never by absence. */
    const candidatesConsidered = matchCandidateCount(g.criticReview)

    if (existing) {
      bookingId = existing.bookingId
      shipmentId = existing.id
      action = 'amend_fields'
      const bk = await this.bookings.findById(bookingId)
      jobNo = bk?.jobNo ?? '(unknown)'
      fieldOutcome = await this.applyFields(shipmentId, existing as Record<string, unknown>, legValues, supersededLockedFields, g, scheduleRetractionColumns(f))
      if (adoptedZeroId) {
        await this.audit.write({
          entityType: 'shipment', entityId: shipmentId, field: 'match_keys',
          oldValue: null, newValue: [...gk].join(', '), changeType: 'update',
          sourceType: 'system', actorUserId: null,
          note: 'zero-identity leg adopted — thread gained its first strong identity',
        })
      }
      await this.fillBooking(bookingId, shipmentId, { customerId, vendorId: effVendorId, forwarderId: effForwarderId, brand: str(f.brand), crd: date(f.cargo_ready_date) }, g)
      // AMEND path only: fillBooking above is first-writer-wins, so this is where a later email's
      // party value would otherwise leave the original master linked and winning display.
      await this.reResolveBookingParties(bookingId, shipmentId, g)
      // review gate + cancellation are lifecycle metadata, not lockable fields — always reflect the latest.
      // leg_status only ever moves to CANCELLED here; never resurrect a leg the reconcile path superseded.
      const metaPatch: Record<string, unknown> = {}
      if (effReviewStatus !== undefined) {
        metaPatch.reviewStatus = effReviewStatus
        metaPatch.confidence = g.confidence ?? null
        metaPatch.reviewReasons = effReasons
      }
      // Only write criticReview when the group carried it — legacy / field-only amends must not wipe.
      // #175: surface which leg absorbed the fields (first-match or dual-auto pin).
      if (g.criticReview !== undefined) {
        metaPatch.criticReview = {
          ...(typeof g.criticReview === 'object' && g.criticReview ? g.criticReview : {}),
          committerChosenLegId: shipmentId,
          dualAutoTarget: g.dualAutoTarget ?? null,
        }
      } else {
        metaPatch.criticReview = {
          committerChosenLegId: shipmentId,
          dualAutoTarget: g.dualAutoTarget ?? null,
        }
      }
      if (g.cancelled) metaPatch.legStatus = 'CANCELLED'
      // An existing leg absorbed the fields. `adopted_zero_id` is kept distinct because the leg had no
      // identity of its own until this email gave it one — a different provenance from a key match.
      metaPatch.committerAction = adoptedZeroId ? 'adopted_zero_id' : 'matched'
      metaPatch.committerTargetLegId = shipmentId
      metaPatch.committerCandidatesConsidered = candidatesConsidered
      if (Object.keys(metaPatch).length) await this.shipments.updateLeg(shipmentId, metaPatch)
    } else {
      // #151 Phase 2: same booking-layer value + own HBL → sibling ship of an EXISTING booking.
      // Attach as next legNo instead of minting a new jobNo/booking. UNIQUE (booking_id, leg_no) backstops.
      const siblingBookingId = findSiblingBooking(legs, gk)
      if (siblingBookingId) {
        bookingId = siblingBookingId
        const siblings = await this.shipments.legsForBooking(bookingId)
        const legNo = Math.max(0, ...siblings.map((s) => (s as { legNo?: number | null }).legNo ?? 0)) + 1
        const bk = await this.bookings.findById(bookingId)
        jobNo = bk?.jobNo ?? '(unknown)'
        const leg = await this.shipments.insertLeg({
          bookingId,
          legNo,
          legStatus,
          ...(legValues as object),
          reviewStatus: effReviewStatus ?? 'confirmed',
          confidence: g.confidence ?? null,
          reviewReasons: effReviewStatus !== undefined ? effReasons : null,
          criticReview: g.criticReview ?? null,
          committerAction: 'sibling_leg',
          committerCandidatesConsidered: candidatesConsidered,
          createdManually: g.createdManually === true,
        })
        shipmentId = leg.id
        action = 'create_booking'
        await this.fillBooking(
          bookingId,
          shipmentId,
          { customerId, vendorId: effVendorId, forwarderId: effForwarderId, brand: str(f.brand), crd: date(f.cargo_ready_date) },
          g,
        )
        // A sibling leg joins a booking that ALREADY has party masters, so fillBooking fills nothing
        // and this leg's own raw twins can name someone else from the moment it is created.
        await this.reResolveBookingParties(bookingId, shipmentId, g)
        await this.writeAudit('shipment', shipmentId, 'create', null, state, g)
        await this.audit.write({
          entityType: 'shipment',
          entityId: shipmentId,
          field: 'leg_no',
          oldValue: null,
          newValue: String(legNo),
          changeType: 'create',
          sourceType: 'system',
          actorUserId: null,
          note: `sibling leg ${legNo} under existing booking ${jobNo} (#151)`,
        })
      } else {
        // Mints job_no with a unique-violation retry — concurrent posts otherwise collide on
        // uq_bookings_job_no (MAX()+1 read) and all but one fail with 400.
        const booking = await this.bookings.createWithGeneratedJobNo({
          customerId,
          vendorId: effVendorId,
          forwarderId: effForwarderId,
          brand: str(f.brand),
          crd: date(f.cargo_ready_date),
        })
        jobNo = booking.jobNo
        bookingId = booking.id
        const leg = await this.shipments.insertLeg({
          bookingId,
          legNo: 1,
          legStatus,
          ...(legValues as object),
          reviewStatus: effReviewStatus ?? 'confirmed',
          confidence: g.confidence ?? null,
          reviewReasons: effReviewStatus !== undefined ? effReasons : null,
          criticReview: g.criticReview ?? null,
          // Created WHILE the matcher offered alternatives is its own state: committed, but possibly a
          // duplicate. Previously indistinguishable from a settled match, which is what let the desk ask
          // "which shipment does this email update?" about a leg this email had just minted.
          committerAction:
            candidatesConsidered != null && candidatesConsidered >= 2 ? 'created_pending_dedup' : 'created',
          committerCandidatesConsidered: candidatesConsidered,
          // 0028 — provenance, stamped only where a leg is BORN. An amend leaves it alone: a human
          // filling gaps on an agent leg does not make the agent's leg hand-made.
          createdManually: g.createdManually === true,
        })
        shipmentId = leg.id
        action = 'create_booking'
        await this.writeAudit('booking', bookingId, 'create', null, jobNo, g)
        await this.writeAudit('shipment', shipmentId, 'create', null, state, g)
        // Even a brand-new booking can be born inconsistent: the FK comes from resolveAll (which may
        // match on a fuzzier tier) while the raw twin is written straight from the parsed value, so
        // the two can name different companies from the first commit.
        await this.reResolveBookingParties(bookingId, shipmentId, g)
      }
    }

    // #146: strongKeysConflict blocked matching a provisional sibling whose SO/booking was corrected by
    // re-parse — either we just minted a new leg, or we amended the live successor. Retire the zombie so
    // the review queue is not left with an unreachable empty card. The predicate requires conflict on one
    // strong-id type + OVERLAP on another (same shipment re-keyed) — mere conversation co-residence must
    // never retire (a consolidated thread holds several REAL shipments). Because overlap is required, the
    // strong-key-indexed `legs` candidates already contain every possible sibling — no conversation scan.
    // Retire = dismissedAt + linkedShipmentId(successor): dismissal alone leaves the zombie visible to
    // candidate lookups (2 candidates → phantom 'ambiguous' → the REAL leg gets stuck in review); the
    // linked stamp is what findExistingLeg's husk guard and the lookup filter key on.
    if (gk.size > 0) {
      const superseded = findSupersededByIdentityCorrection(legs, gk, shipmentId)
      const now = new Date()
      for (const z of superseded) {
        await this.shipments.updateLeg(z.id, { dismissedAt: now, linkedShipmentId: shipmentId })
        await this.audit.write({
          entityType: 'shipment',
          entityId: z.id,
          field: null,
          oldValue: null,
          newValue: `superseded:${shipmentId}`,
          changeType: 'update',
          sourceType: 'system',
          actorUserId: null,
          note: 'identity corrected by re-parse — superseded by a newer leg',
        })
      }
    }

    // 0028 — the two situations the committer must REPORT rather than settle, because a leg a PERSON
    // typed is on one side of them. Neither can be decided from the data: whether two legs are one
    // shipment is a judgement about physical cargo, and acting either way silently (merging them, or
    // dismissing the human's row) destroys information the operator would need to undo it. So both
    // become review reasons naming the other leg's job number — the desk already has the link action.
    // Recomputed every commit and stripped when they stop holding (isRecomputedDataIssueReason), so a
    // pair the operator has since folded or re-keyed does not leave a warning on the leg forever.
    const duplicateRiskReasons: string[] = []
    const seenRisk = new Set<string>()
    const riskLegs = [
      ...(gk.size > 0 ? findManualIdentityClash(legs, gk, shipmentId) : []).map((l) => ({ leg: l, kind: 'clash' as const })),
      ...findPoOnlyDuplicateRisk(legs, posByBooking, gk, groupPos, g.createdManually === true, shipmentId).map(
        (l) => ({ leg: l, kind: 'shared_po' as const }),
      ),
    ]
    // Same REPORT-don't-settle contract, third case: this B/L names POs that are sitting on OTHER nascent
    // legs. findExistingLeg joined ONE of them and stopped, so the rest go unmentioned unless we say so.
    //
    // Keyed on matchPos, NOT posStated. A healthy parse puts every PO the B/L names into `pos` — Set 5's
    // AWB email yields pos=[28739,28740,28747] with posStated EMPTY — so keying on posStated silently
    // disabled this flag in exactly the case it exists for (three nascent legs, one absorbed, two orphaned
    // with nobody told). posStated only fills in when a parse degrades and drops the sibling records.
    //
    // Gated on the group carrying a B/L: posStated implied one (statedPosOf requires hbl/mbl), matchPos
    // does not, and without that gate every PO-only email would flag every nascent leg sharing a PO —
    // which is the ordinary early-thread shape, not a duplicate.
    const groupBl = str(f.hbl_awb_fcr_no) ?? str(f.mbl)
    if (groupBl) {
      for (const l of findUnabsorbedStatedSiblings(legs, posByBooking, matchPos, shipmentId)) {
        if (seenRisk.has(l.id)) continue
        seenRisk.add(l.id)
        const bk = await this.bookings.findById(l.bookingId)
        const shared = (posByBooking.get(l.bookingId) ?? []).find((p) => matchPos.has(normKey(p)))
        duplicateRiskReasons.push(
          `likely the same shipment as ${bk?.jobNo ?? l.id} — ${groupBl} also covers PO ${
            shared ?? '(unknown)'
          }, which has no identity of its own yet; kept both`,
        )
      }
    }

    for (const { leg: l, kind } of riskLegs) {
      if (seenRisk.has(l.id)) continue
      seenRisk.add(l.id)
      const bk = await this.bookings.findById(l.bookingId)
      const other = bk?.jobNo ?? l.id
      if (kind === 'clash') {
        duplicateRiskReasons.push(
          `possible duplicate of ${other} — that shipment was entered by hand and its booking/SO number disagrees with this email; kept both`,
        )
      } else {
        const shared = (posByBooking.get(l.bookingId) ?? []).find((p) => groupPos.has(normKey(p)))
        duplicateRiskReasons.push(
          `possible duplicate of ${other} — shares PO ${shared ?? '(unknown)'} but states a different booking/SO/HBL; one of the two was entered by hand`,
        )
      }
    }

    // Per-PO master enrichment (brand / item_style_no / total_quantity + unit): pulled from the parsed_record
    // whose PO matches — NOT the shipment-level aggregate — so a brand stated at the SO level never leaks onto
    // every PO, and a PO showing two brands across a thread resolves latest-received-wins. See resolvePoEnrichment.
    // INCREMENT 4 (Ingest N+1): forCommitEnrichment (po_no_norm index + message-complete + no-PO residual)
    // instead of allWithMessage() full scan — same pure resolve/unattributed semantics, smaller read set.
    const allEvidence = g.pos.length
      ? await this.evidence.forCommitEnrichment([...groupPos], strongPairs)
      : []
    const poEnrichment = g.pos.length ? resolvePoEnrichment(allEvidence) : null
    // de-correction (b2 no-PO): brand/style stated with no PO to attach to — surfaced, never silently dropped.
    const unattributed = g.pos.length ? unattributedBrandStyle(allEvidence) : []

    // Defense-in-depth for multi-HAWB splits: other candidate legs' shipment_pos + HBL. One bulk
    // query over already-indexed candidates — empty when no siblings (Set1 single-leg unchanged).
    const siblingPoHbls: SiblingPoHbl[] = []
    if (g.pos.length && legs.length) {
      const otherIds = legs.filter((l) => l.id !== shipmentId).map((l) => l.id)
      if (otherIds.length) {
        const posByShipment = await this.shipments.linkedPosForShipments(otherIds)
        for (const leg of legs) {
          if (leg.id === shipmentId) continue
          const mk = (leg.matchKeys ?? {}) as Record<string, unknown>
          const hbl =
            str((leg as { hblAwbFcrNo?: unknown }).hblAwbFcrNo) ?? str(mk.hbl_awb_fcr_no)
          if (!hbl) continue
          const legMode = str((leg as { mode?: unknown }).mode) ?? str(mk.mode)
          for (const p of posByShipment.get(leg.id) ?? []) {
            if (!p.poNumber) continue
            siblingPoHbls.push({
              po: p.poNumber,
              hbl,
              mode: legMode,
              // 0029: how strongly that leg claims it, + the row to drop if a stated claim takes over
              inferred: p.inferred === true,
              linkId: p.linkId,
              shipmentId: leg.id,
            })
          }
        }
      }
    }

    // PoQtyReconciler: pure plan (qty/unit/enrichment flags) then side-effect links. Reasons stay byte-stable
    // with the pre-extract loop (see committer-po-reconciler.spec).
    const { links, poQtyIssues, poFlagReasons, displaced } = planPoReconcile({
      pos: g.pos,
      posInferred: g.posInferred,
      // f (=g.fields) is the Matcher's consolidated field bag — it does NOT carry mode; mode is a
      // separate top-level decision field (dto.mode / g.mode), applied to this leg's own shipment row
      // via normMode() above (legValues.mode). Mirror that same normalization here so the cross-mode
      // sibling guard compares this leg against siblingPoHbls' (already normMode'd) stored mode column.
      fields: { ...f, mode: normMode(g.mode) },
      poQty: g.poQty,
      poEnrichment,
      unattributed,
      gk,
      siblingPoHbls,
    })
    // 0029 displacement: a sibling held this PO only because its group SWEPT it up; this email STATES it.
    // Drop the weak link FIRST so the insert below does not collide with the cross-HAWB invariant, and
    // audit it on the losing leg — a PO leaving a shipment must never be silent, even when it is right.
    for (const d of displaced) {
      await this.shipments.unlinkPoById(d.linkId)
      await this.audit.write({
        entityType: 'shipment',
        entityId: d.shipmentId,
        field: 'shipment_pos',
        oldValue: d.po,
        newValue: null,
        changeType: 'delete',
        sourceType: 'system',
        actorUserId: null,
        note: `PO ${d.po} moved to ${str(f.hbl_awb_fcr_no) ?? str(f.mbl) ?? 'another B/L'} — ${d.fromHbl} swept it up without stating it (0029)`,
      })
    }
    // DIVISION removal — the one evidence-backed way a STATED link leaves a leg. Two conditions, BOTH
    // required: a division statement on this decision names the PO as moved (the factory's own words,
    // audited below), AND the decision's PO list no longer carries it. Each protects against the other's
    // failure mode: absence alone never removes (a thin reparse must not strip cargo), and a statement
    // alone never removes (the queue keeps a PARTIAL division's PO in `pos` — a 3-carton urgent split
    // keeps its trunk link). Only the amend path — a fresh leg has no stale links — and never on a
    // hand-typed leg, like every automatic rule.
    if (existing && g.divisions?.length && !(existing as { manualEntry?: unknown }).manualEntry) {
      const movedAway = new Map<string, { quote?: string; target?: string }>()
      for (const d of g.divisions) {
        for (const p of d.pos ?? []) {
          const n = normKey(p)
          if (n && !groupPos.has(n)) movedAway.set(n, { quote: d.quote, target: d.target })
        }
      }
      for (const linked of movedAway.size ? await this.shipments.linkedPosForShipment(shipmentId) : []) {
        const div = movedAway.get(normKey(linked.poNumber))
        if (!div) continue
        await this.shipments.unlinkPoByShipmentAndPo(shipmentId, linked.id)
        await this.audit.write({
          entityType: 'shipment',
          entityId: shipmentId,
          field: 'shipment_pos',
          oldValue: linked.poNumber,
          newValue: null,
          changeType: 'delete',
          sourceType: 'system',
          actorUserId: null,
          note: `PO ${linked.poNumber} moved off this booking by a stated division${div.target ? ` (→ ${div.target})` : ''}${div.quote ? ` — "${div.quote}"` : ''}`.slice(0, 400),
        })
      }
    }
    for (const link of links) {
      const poId = await this.purchaseOrders.upsertPo(link.poNo, customerId, effVendorId, link.enr ?? undefined)
      await this.bookings.linkPo(bookingId, poId)
      await this.shipments.linkPo(
        shipmentId,
        poId,
        link.perPoQty,
        link.perPoUnit,
        (g.posInferred ?? []).some((p) => normKey(p) === normKey(link.poNo)),
      )
    }
    // Data-completeness escalations route the shipment to human review.
    // Recomputed each commit (not accumulated): brand/style conflicts, PO qty issues, cargo-missing.
    // Gate/master-miss reasons from earlier in apply are preserved; stale enrichment flags are stripped
    // so a resolved OCR style family (#124) does not leave "kept 951" on the leg forever.
    //  (i)  per-PO shipped qty contradicts the ERP order (poQtyIssues, above).
    //  (ii) EMPTY CARGO — a real booked leg NAMES a cargo unit but carries no qty/gross weight/volume. That
    //       almost always means the booking form / original email (which held the numbers) was never
    //       ingested (e.g. only "RE:" replies captured — see S2600240871A). Gated on qtyUnit-present so a
    //       nascent booking that simply hasn't stated cargo yet (no unit either) is NOT flagged.
    const committed = await this.shipments.findById(shipmentId)
    const c = committed as Record<string, unknown> | null
    const isRealLeg = gk.size > 0 || g.pos.length > 0
    const cargoUnitButNoNumbers =
      c != null && c.qtyUnit != null && c.qty == null && c.grossWeight == null && c.measurement == null
    const cargoMissing = isRealLeg && cargoUnitButNoNumbers
    // NOTE: stale-ETD ("ETD implausibly before the email") is owned by the QUEUE (cobalt-queue
    // validate.ts) — its note flows here as a review reason and is humanized by review-reasons.ts.
    // The former committer-side staleEtdReasons flag was retired to avoid double-flagging.
    const dataIssues = [
      ...poQtyIssues,
      ...poFlagReasons,
      ...(cargoMissing ? ['booked shipment missing cargo detail (qty/weight/volume) — source attachment likely not ingested'] : []),
      // (iii) DUPLICATE RISK against a hand-typed leg (0028). Recomputed here rather than pushed into
      //       `reviewHints` above because it needs the candidate legs, which are not loaded until after
      //       the gate is decided — and because it must CLEAR when the pair is resolved, which is
      //       exactly what this pass gives it.
      ...duplicateRiskReasons,
    ]
    const priorReasons = parseReasonList(c?.reviewReasons)
    const mergedReasons = mergeReviewReasonsWithDataIssues(priorReasons, dataIssues)
    const reasonsChanged =
      mergedReasons.length !== priorReasons.length ||
      mergedReasons.some((r, i) => r !== priorReasons[i])
    if (dataIssues.length || reasonsChanged) {
      // Escalate to provisional when current data issues exist; when only stripping stale flags,
      // keep existing reviewStatus (still provisional if gate/master reasons remain).
      await this.shipments.updateLeg(shipmentId, {
        ...(dataIssues.length ? { reviewStatus: 'provisional' as const } : {}),
        reviewReasons: mergedReasons.length ? mergedReasons : null,
      })
      if (poQtyIssues.length) await this.writeAudit('shipment', shipmentId, 'update', null, poQtyIssues.join('; '), g, 'po_qty_conflict')
      if (poFlagReasons.length) await this.writeAudit('shipment', shipmentId, 'update', null, poFlagReasons.join('; '), g, 'po_enrichment_flag')
      if (cargoMissing) await this.writeAudit('shipment', shipmentId, 'update', null, 'missing cargo qty/weight/volume', g, 'cargo_missing')
    }

    await this.writeIdentifiers(shipmentId, g)
    await this.writeMatchKeyIndex(shipmentId, g)
    await this.writeParties(shipmentId, g)
    // Defense in depth: re-collect events from identifiers/evidenceIds so a partial ReconGroup
    // (rebuild path, empty events) still links Related Emails when source_email_id is known.
    const sourceEvents = collectSourceEvents({
      events: g.events,
      identifiers: g.identifiers,
      evidenceIds: g.evidenceIds,
    })
    await this.milestones.sync(shipmentId, sourceEvents, g.fields, state)
    return { action, jobNo, bookingId, shipmentId, state, conflicts: g.conflicts, supersededLockedFields, fieldOutcome }
  }

  /**
   * Update a leg field-by-field, auditing each change. Latest-email-wins, INCLUDING over a human lock:
   * a newer email that disagrees with a human-locked field is applied so tracking stays current, and the
   * field is recorded in `superseded`. The lock ROW is left untouched (it still holds the human value), so
   * `column !== lockedValue` now marks the field CONTESTED — surfaced on the detail page for the user to
   * keep the new value or restore their edit.
   */
  private async applyFields(
    shipmentId: string,
    current: Record<string, unknown>,
    next: Record<string, unknown>,
    superseded: string[],
    g: ReconGroup,
    retractions: string[] = [],
  ): Promise<FieldApplyOutcome> {
    const locks = await this.fieldLocks.forEntity(shipmentId)
    const locked = new Set(locks.filter((l) => l.entityType === 'shipment').map((l) => l.field))
    const patch: Record<string, unknown> = {}
    /**
     * The outcome per field. This loop always knew it — `same()` is "the leg already holds what the
     * email proposes" and `locked` is "a human's value stood in the way" — and threw it away, so the
     * desk had to guess later why a proposal never landed. Two very different stories: one needs no
     * attention at all, the other is a contested human edit.
     */
    const outcome: FieldApplyOutcome = { applied: [], alreadySame: [], contested: [] }
    for (const [k, v] of Object.entries(next)) {
      if (v == null) continue
      if (same(current[k], v)) {
        outcome.alreadySame.push(k)
        continue
      }
      patch[k] = v
      outcome.applied.push(k)
      await this.writeAudit('shipment', shipmentId, 'update', toStr(current[k]), toStr(v), g, k)
      if (locked.has(k)) {
        superseded.push(k)
        outcome.contested.push(k)
      }
    }
    // Schedule retraction (the stale-ATD class): the merge asserted an EXPLICIT null for these columns
    // — a full-thread re-derivation found the stored statement contradicted/unsupported — so a stored
    // value CLEARS (audited old→null; a locked field follows the same contested supersede flow). The
    // normal loop above skips every null, so absent fields still never clear anything.
    for (const col of retractions) {
      if (current[col] == null) continue
      patch[col] = null
      await this.writeAudit('shipment', shipmentId, 'update', toStr(current[col]), null, g, col)
      if (locked.has(col)) superseded.push(col)
    }
    if (Object.keys(patch).length) await this.shipments.updateLeg(shipmentId, patch)
    return outcome
  }

  /**
   * Keep the booking's party master consistent with the raw twin the leg now names.
   *
   * The stale master-FK class, third path. The two human write paths (detail edit, review correct)
   * already re-link-or-unlink the master whenever a raw party value changes; the COMMITTER never did.
   * It writes `vendor_raw` / `customer_raw` onto the LEG, but those masters hang off the BOOKING and
   * `fillBooking` is first-writer-wins — so once a booking had a vendor, a later email naming a
   * different factory could never move it.
   *
   * Leg 20260405F1 is the result: `vendor_raw = ELSMCO` with `booking.vendor_id` still SOUOCE, so
   * Order Details (which prefers the master) printed SOUOCE while the review desk's Current — read
   * from the raw twin — said ELSMCO. One field, two screens, two companies, and no way to settle it.
   *
   * This is NOT a correction of the agent's reading: the raw value is left exactly as written, and
   * nothing is invented. Only the link that display follows is kept honest — re-pointed to whatever
   * the raw value exactly matches, or UNLINKED when it matches nothing, so display falls back to the
   * raw twin rather than asserting a company the leg does not name.
   */
  private async reResolveBookingParties(bookingId: string, shipmentId: string, g: ReconGroup) {
    const [leg, bk] = await Promise.all([
      this.shipments.findById(shipmentId),
      this.bookings.findById(bookingId),
    ])
    if (!leg || !bk) return
    const slots = [
      { raw: 'vendorRaw', fk: 'vendorId', exact: (v: string) => this.masters.vendorIdExact(v) },
      { raw: 'customerRaw', fk: 'customerId', exact: (v: string) => this.masters.customerIdExact(v) },
    ] as const
    const patch: Record<string, unknown> = {}
    for (const slot of slots) {
      const raw = str((leg as Record<string, unknown>)[slot.raw])
      if (raw == null) continue // absent raw asserts nothing — leave the existing link alone
      const linkedId = (bk as Record<string, unknown>)[slot.fk] as string | null | undefined
      const resolved = await slot.exact(raw)
      /**
       * Re-point only on a CONFIDENT match — never unlink, unlike the two human paths.
       *
       * They may unlink because a person typed the raw value and meant it. Here the resolver that set
       * the link is strictly smarter than this check: `resolveAll` folds aliases and canonical
       * customer facts (COLEB → COLE), which `customerIdExact` cannot see. Unlinking on "no exact
       * match" therefore destroyed correct alias links — it broke the co-valid-parties integration
       * test the moment it ran.
       *
       * Leaving a link the resolver chose is the safer failure: the raw twin still shows beside it,
       * and the desk's party-mismatch row asks a human when the two disagree.
       */
      if (resolved == null) continue
      if (resolved === (linkedId ?? null)) continue
      patch[slot.fk] = resolved
      await this.writeAudit(
        'shipment',
        shipmentId,
        'update',
        linkedId ?? null,
        resolved ?? null,
        g,
        slot.fk,
      )
    }
    if (Object.keys(patch).length) await this.bookings.update(bookingId, patch)
  }

  private async fillBooking(bookingId: string, shipmentId: string, vals: Record<string, unknown>, g: ReconGroup) {
    const bk = await this.bookings.findById(bookingId)
    if (!bk) return
    const patch: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(vals)) {
      if (v == null || (bk as Record<string, unknown>)[k] != null) continue
      patch[k] = v
      // rule 5: only AUDITED_BOOKING_FILL_FIELDS (brand) — never raw UUID master-link fills.
      if (isAuditedBookingFill(k)) await this.writeAudit('shipment', shipmentId, 'update', null, toStr(v), g, k)
    }
    if (Object.keys(patch).length) await this.bookings.update(bookingId, patch)
  }

  /**
   * Persist the identifier history (every value each identity field ever held). CO-CURRENT semantics: a
   * consolidation / multi-container shipment legitimately has MANY current booking/SO/HBL numbers, so a
   * value is `is_current` when it is the agent-marked co-current member (every top-rank value) OR equals
   * the ACTUAL committed column — the latter keeps a human-locked primary current regardless of the agent.
   * Idempotent (delete+insert per shipment), so re-applying a decision never piles up duplicate rows.
   */
  private async writeIdentifiers(shipmentId: string, g: ReconGroup) {
    if (!g.identifiers?.length) return
    const leg = await this.shipments.findById(shipmentId)
    if (!leg) return
    const rows = deriveIdentifierRows(shipmentId, g.identifiers, currentIdentifierValues(leg as Record<string, unknown>))
    await this.shipments.replaceIdentifiers(shipmentId, rows)
  }

  /**
   * Persist the leg's queryable strong-key INDEX: the normalized `strongKeys(matchKeys)` that `findExistingLeg`
   * matches on, as `(type, value)` rows a future candidate query can hit in place of the `allLegs()` scan.
   * Derives from `match_keys` (NOT the agent's identifier history) — the SAME source, same normalization the
   * matcher reads — so it stays provably consistent on EVERY path (agent / rebuild / manual, create + amend).
   * Idempotent (delete+insert per shipment). Read by `candidateLegs` (committer.apply INCREMENT 2 +
   * lookupByMatchKey INCREMENT 3).
   *
   * 🔴 Derives from the leg's STORED bag folded with this decision's — never from `g.matchKeys` alone. The
   * amend path does not rewrite `match_keys`, so building the index from the incoming keys DELETED every key
   * type this decision happened to omit while `findExistingLeg` went on matching the stored bag. Measured
   * live: a leg stored `{booking_no: CA771, hbl_awb_fcr_no: A26050003, …}` while its index held
   * `hbl_awb_fcr_no=SZA26050003, mbl=…` and no `CA771` — so a later decision keyed on CA771 could not
   * retrieve it and would have minted a duplicate. The merged bag is written BACK to the leg, so the
   * index and the thing `findExistingLeg` reads are the same object rather than two drifting copies.
   * See `mergeIdentityKeys` for why this is a per-type overwrite and not a union.
   */
  private async writeMatchKeyIndex(shipmentId: string, g: ReconGroup) {
    const leg = await this.shipments.findById(shipmentId)
    const stored = (leg?.matchKeys ?? {}) as Record<string, unknown>
    const merged = mergeIdentityKeys(stored, g.matchKeys)
    // Only touch the column when the fold actually added or changed something — an unchanged amend must not
    // bump the row (and `updateLeg` is where field locks / audit hang off).
    if (JSON.stringify(merged) !== JSON.stringify(stored)) {
      await this.shipments.updateLeg(shipmentId, { matchKeys: merged })
    }
    await this.shipments.replaceMatchKeys(shipmentId, matchKeyIndexRows(shipmentId, merged))
  }

  /**
   * Persist co-valid customer PARTIES (bill-to + importer-of-record + booking entity of one buyer) — the
   * entity analogue of writeIdentifiers, written only when the agent sent ≥2 related entities. isPrimary is
   * RECOMPUTED here by canonical equality with the code that actually became booking.customer_id (the agent
   * cannot demote/replace the primary even with a malformed payload). Last-line over-merge defence: an
   * alternate whose buyer group differs from — or shares no NON-EMPTY group with — the primary is DROPPED,
   * so a wrong/blank group fact can never co-list an unrelated party. The CANONICAL code is stored (so the
   * (shipment,role,code) unique key agrees with the dedupe). Idempotent (delete+insert); never touches
   * booking.customer_id. */
  private async writeParties(shipmentId: string, g: ReconGroup) {
    if (!g.entities?.length) return
    const primaryCanon = await this.masters.canonicalCode(str(g.fields.customer_code) ?? '')
    if (!primaryCanon) return
    const primaryGroup = await this.masters.customerGroupOf(primaryCanon)
    const seen = new Set<string>()
    const rows: Insertable<DB['shipmentParties']>[] = []
    for (const e of g.entities) {
      if (e.type !== 'customer_code' || !e.value) continue
      const canon = await this.masters.canonicalCode(String(e.value))
      const isPrimary = canon === primaryCanon
      if (!isPrimary) {
        const grp = await this.masters.customerGroupOf(canon)
        if (!primaryGroup || !grp || grp !== primaryGroup) continue // unrelated/blank → never co-list
      }
      const key = `${e.role ?? 'other'}:${canon}`
      if (seen.has(key)) continue
      seen.add(key)
      const cust = await this.masters.customerByCode(canon)
      rows.push({
        shipmentId,
        role: (e.role ?? 'other') as Insertable<DB['shipmentParties']>['role'],
        customerId: cust?.id ?? null,
        customerCode: canon,
        customerName: cust?.name ?? null,
        isPrimary,
        docType: e.docType ?? null,
        rank: e.rank ?? null,
        isCurrent: true,
        sourceEmailId: e.sourceEmailId ?? null,
        observedAt: e.observedAt ? new Date(e.observedAt) : null,
      })
    }
    await this.shipments.replaceParties(shipmentId, rows)
  }

  private writeAudit(
    entityType: string,
    entityId: string,
    changeType: 'create' | 'update',
    oldValue: string | null,
    newValue: string | null,
    g: ReconGroup,
    field?: string,
  ) {
    return this.audit.write({
      entityType: entityType as never,
      entityId,
      field: field ?? null,
      oldValue,
      newValue,
      changeType: changeType as never,
      sourceType: 'agent',
      sourceId: g.evidenceIds[0] ?? null,
    })
  }

  /** Agent-path resolution of ReconGroup.fromPlatform: true only when EVERY source email of the leg resolves
   *  to a CVP/TradeLinkOne platform sender. Requires all graph ids to resolve (an unresolved sender — e.g. a
   *  2-VM split where queue_message isn't local — yields false, so we never falsely demote a real shipment). */
  private async allSourceEmailsFromPlatform(g: ReconGroup): Promise<boolean> {
    const graphIds = g.events.map((e) => e.graphId).filter((x): x is string => !!x)
    if (!graphIds.length) return false
    const rows = await this.evidence.sendersByGraphIds(graphIds)
    const senderOf = new Map(rows.map((r) => [r.graphMessageId, r.sender]))
    return graphIds.every((id) => isNotificationPlatformSender(senderOf.get(id) ?? null))
  }
}

/** What to surface in the review queue: the agent gate's reasons when present, else the raw conflicts. */
const reviewReasonsFor = (g: ReconGroup): string[] | null =>
  g.reviewReasons?.length ? g.reviewReasons : g.conflicts.length ? g.conflicts : null

/** review_reasons is nvarchar JSON — findById may return a string or an already-parsed array. */
const parseReasonList = (raw: unknown): string[] => {
  if (raw == null) return []
  if (Array.isArray(raw)) return raw.map(String)
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw)
      return Array.isArray(p) ? p.map(String) : []
    } catch {
      return raw.trim() ? [raw] : []
    }
  }
  return []
}

const toStr = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v))
const same = (a: unknown, b: unknown) => toStr(a) === toStr(b)
