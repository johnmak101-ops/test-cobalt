import { Injectable } from '@nestjs/common'
import { formatJobNo } from '../common/job-no'
import type { Insertable } from 'kysely'
import type { DB } from '../db/kysely/db'
import { strongKeys, normKey, str, date } from './match-keys'
import {
  guardVendorForwarder,
  isPlatformNotForwarder,
  isNotificationPlatformSender,
  setPlatformNotForwarderPatterns,
} from './vendor-forwarder-guard'
import { deriveState, classifyKindDetail, normMode } from './state'
import { currentIdentifierValues, deriveIdentifierRows } from './identifier-rows'
import { matchKeyIndexRows } from './match-key-index'
import { MastersRepository } from '../db/repositories/masters.repository'
import { BookingRepository } from '../db/repositories/booking.repository'
import { PurchaseOrderRepository } from '../db/repositories/purchase-order.repository'
import { ShipmentRepository } from '../db/repositories/shipment.repository'
import { FieldLockRepository } from '../db/repositories/field-lock.repository'
import { AuditRepository } from '../db/repositories/audit.repository'
import { EvidenceRepository } from '../db/repositories/evidence.repository'
import { resolvePoEnrichment, unattributedBrandStyle } from './po-enrichment'
import { mapFieldsToLegColumns } from './committer-leg-mapping'
import { findExistingLeg } from './committer-match'
import { MasterResolver } from './committer-master-resolver'
import { planPoReconcile } from './committer-po-reconciler'
import { MilestoneSynchronizer } from './committer-milestones'
import { isAuditedBookingFill } from './fill-booking-audit'
import { collectSourceEvents } from './source-events'

// Re-export for any external import sites that still pull findExistingLeg from the service module.
export { findExistingLeg } from './committer-match'

/** One reconciled shipment picture, ready to commit. */
export interface ReconGroup {
  fields: Record<string, unknown>
  pos: string[]
  /** Per-PO unambiguous shipped qty, keyed by normalized po_no (normKey). Present only when the Matcher can
   *  attribute a real qty to an individual PO; absent (or a PO omitted) when the qty is a broadcast total. */
  poQty?: Record<string, number>
  matchKeys: Record<string, unknown>
  emailTypes: string[]
  events: { emailType: string; receivedAt: string; graphId?: string | null }[]
  mode: string | null
  conversationId: string | null
  /** The booking was cancelled — the committed leg's leg_status becomes 'CANCELLED' instead of 'ACTIVE'.
   *  Undefined/false on the legacy path → leg stays 'ACTIVE' (unchanged). */
  cancelled?: boolean
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
  skippedLockedFields: string[]
}

/**
 * Deterministic committer: applies a reconciled group to the tracking truth.
 * Safety invariants live HERE (tested code), not in the LLM: field-locks (human-wins),
 * audit on every change, idempotency (find-or-update a leg by its match_keys + PO consistency).
 * All DB access is delegated to repositories.
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
  ) {
    this.mastersResolver = new MasterResolver(masters)
    this.milestones = new MilestoneSynchronizer(shipments)
  }

  async apply(g: ReconGroup): Promise<CommitResult> {
    const f = g.fields
    const gk = strongKeys(g.matchKeys)

    // MOVE 3: overlay platform_not_forwarder patterns from Resolution Rules (lhs = regex/substring).
    // SEED patterns in vendor-forwarder-guard always apply; admin facts extend without redeploy.
    const platformFacts = (await this.masters.listResolution('approved')).filter(
      (row) => row.kind === 'platform_not_forwarder' && row.lhs,
    )
    setPlatformNotForwarderPatterns(platformFacts.map((row) => row.lhs))

    // de-correction STEP 2/3 (2026-07-12): no silent model-corrections, no shadow metering.
    // Platform names stay on the field for display but never link (LLM master-matcher on queue owns
    // party resolution; track only exact/code + curated exact facts for ports).
    const platformForwarder = isPlatformNotForwarder(str(f.forwarder_name))
    const reviewHints: string[] = []
    if (platformForwarder) {
      reviewHints.push(
        `forwarder_name "${str(f.forwarder_name)}" looks like a notification platform, not a freight forwarder — left unlinked for review`,
      )
    }

    const { customerId, vendorId, forwarderLink, polLink, podLink } = await this.mastersResolver.resolveAll(
      platformForwarder ? { ...f, forwarder_name: null } : f,
    )
    // Exact-only link; unresolved free-text → review (queue LLM should have resolved codes upstream)
    if (!platformForwarder && str(f.forwarder_name) && !forwarderLink.id) {
      reviewHints.push(
        `forwarder_name "${str(f.forwarder_name)}" did not exact-match a master (LLM matcher owns fuzzy; left unlinked)`,
      )
    }
    const polRaw = str(f.poi ?? (f as Record<string, unknown>).pol)
    const podRaw = str(f.pod)
    if (polRaw && !polLink)
      reviewHints.push(`pol "${polRaw}" did not exact/curated-match a port master — left unlinked`)
    if (podRaw && !podLink)
      reviewHints.push(`pod "${podRaw}" did not exact/curated-match a port master — left unlinked`)

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
    const state = deriveState(emailTypes, f)
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

    const needsReview = guard.misclassified || reviewHints.length > 0
    const effReviewStatus = needsReview ? 'provisional' : g.reviewStatus
    const effReasons = ((): string[] | null => {
      const all = [...(reviewReasonsFor(g) ?? []), ...guard.reasons, ...reviewHints]
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
    }

    // matching / idempotency. A leg matches when:
    //  - it shares a STRONG key with the group AND is PO-consistent (the normal case); OR
    //  - they share a PO and at least ONE side has NO strong id — i.e. a nascent PO-only leg gaining its
    //    first id, or a PO-only follow-up/re-POST. This stops Option A's strong-id-less legs from spawning a
    //    duplicate on the next email. It deliberately does NOT match by PO when BOTH carry DIFFERENT strong
    //    ids — that is a PO reassignment the gate reviews, never a silent merge here.
    const groupPos = new Set(g.pos.map((p) => normKey(p)).filter(Boolean))
    // Candidate SUPERSET instead of an allLegs() full-scan: the strong-key index (shipment_match_keys, 0003)
    // ∪ the shared-PO index (purchase_orders.po_number_norm, 0004). Same normalization + source as
    // findExistingLeg, so it provably contains every leg the strong-overlap / shared-PO branches could match.
    // The A2 zero-identity fallback (matches by conversationId inside match_keys — not index-covered) only
    // fires when the group has NO strong key AND NO PO; in that rare orphan-thread case we keep the full scan.
    const strongPairs = [...gk].map((k) => ({ type: k.slice(0, k.indexOf(':')), value: k.slice(k.indexOf(':') + 1) }))
    const legs =
      gk.size > 0 || groupPos.size > 0
        ? await this.shipments.candidateLegs(strongPairs, [...groupPos])
        : await this.shipments.allLegs()
    // ONE bulk load of the candidate bookings' PO numbers (bookingId -> [poNumber]) — the PO data findExistingLeg
    // sees is byte-identical to the old per-leg poNumbersFor; the matching itself is the pure, unit-tested fn.
    const posByBooking = await this.bookings.poNumbersByBooking(legs.map((l) => l.bookingId))
    const existing = findExistingLeg(legs, posByBooking, gk, groupPos, g.conversationId)

    let bookingId: string
    let shipmentId: string
    let jobNo: string
    let action: CommitResult['action']
    const skippedLockedFields: string[] = []

    if (existing) {
      bookingId = existing.bookingId
      shipmentId = existing.id
      action = 'amend_fields'
      const bk = await this.bookings.findById(bookingId)
      jobNo = bk?.jobNo ?? '(unknown)'
      await this.applyFields(shipmentId, existing as Record<string, unknown>, legValues, skippedLockedFields, g)
      await this.fillBooking(bookingId, shipmentId, { customerId, vendorId: effVendorId, forwarderId: effForwarderId, brand: str(f.brand), crd: date(f.cargo_ready_date) }, g)
      // review gate + cancellation are lifecycle metadata, not lockable fields — always reflect the latest.
      // leg_status only ever moves to CANCELLED here; never resurrect a leg the reconcile path superseded.
      const metaPatch: Record<string, unknown> = {}
      if (effReviewStatus !== undefined) {
        metaPatch.reviewStatus = effReviewStatus
        metaPatch.confidence = g.confidence ?? null
        metaPatch.reviewReasons = effReasons
      }
      // Only write criticReview when the group carried it — legacy / field-only amends must not wipe.
      if (g.criticReview !== undefined) metaPatch.criticReview = g.criticReview ?? null
      if (g.cancelled) metaPatch.legStatus = 'CANCELLED'
      if (Object.keys(metaPatch).length) await this.shipments.updateLeg(shipmentId, metaPatch)
    } else {
      jobNo = await this.nextJobNo()
      const booking = await this.bookings.create({ jobNo, customerId, vendorId: effVendorId, forwarderId: effForwarderId, brand: str(f.brand), crd: date(f.cargo_ready_date) })
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
      })
      shipmentId = leg.id
      action = 'create_booking'
      await this.writeAudit('booking', bookingId, 'create', null, jobNo, g)
      await this.writeAudit('shipment', shipmentId, 'create', null, state, g)
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

    // PoQtyReconciler: pure plan (qty/unit/enrichment flags) then side-effect links. Reasons stay byte-stable
    // with the pre-extract loop (see committer-po-reconciler.spec).
    const { links, poQtyIssues, poFlagReasons } = planPoReconcile({
      pos: g.pos,
      fields: f,
      poQty: g.poQty,
      poEnrichment,
      unattributed,
      gk,
    })
    for (const link of links) {
      const poId = await this.purchaseOrders.upsertPo(link.poNo, customerId, effVendorId, link.enr ?? undefined)
      await this.bookings.linkPo(bookingId, poId)
      await this.shipments.linkPo(shipmentId, poId, link.perPoQty, link.perPoUnit)
    }
    // Data-completeness escalations route the shipment to human review. Additive: only ever escalate to
    // provisional + append (deduped) reasons — data is kept, never dropped; the reviewer resolves it.
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
    ]
    if (dataIssues.length) {
      const priorReasons = (c?.reviewReasons as string[] | null) ?? []
      const mergedReasons = [...new Set([...priorReasons, ...dataIssues])]
      await this.shipments.updateLeg(shipmentId, { reviewStatus: 'provisional', reviewReasons: mergedReasons })
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
    return { action, jobNo, bookingId, shipmentId, state, conflicts: g.conflicts, skippedLockedFields }
  }

  /** Update a leg field-by-field, skipping human-locked fields and auditing each change. */
  private async applyFields(
    shipmentId: string,
    current: Record<string, unknown>,
    next: Record<string, unknown>,
    skipped: string[],
    g: ReconGroup,
  ) {
    const locks = await this.fieldLocks.forEntity(shipmentId)
    const locked = new Set(locks.filter((l) => l.entityType === 'shipment').map((l) => l.field))
    const patch: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(next)) {
      if (v == null) continue
      if (locked.has(k)) {
        if (!same(current[k], v)) skipped.push(k)
        continue
      }
      if (!same(current[k], v)) {
        patch[k] = v
        await this.writeAudit('shipment', shipmentId, 'update', toStr(current[k]), toStr(v), g, k)
      }
    }
    if (Object.keys(patch).length) await this.shipments.updateLeg(shipmentId, patch)
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
   */
  private async writeMatchKeyIndex(shipmentId: string, g: ReconGroup) {
    await this.shipments.replaceMatchKeys(shipmentId, matchKeyIndexRows(shipmentId, g.matchKeys))
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

  private async nextJobNo(): Promise<string> {
    return formatJobNo(await this.bookings.nextJobSeq())
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

const toStr = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v))
const same = (a: unknown, b: unknown) => toStr(a) === toStr(b)
