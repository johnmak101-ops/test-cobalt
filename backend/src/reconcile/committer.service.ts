import { Injectable } from '@nestjs/common'
import { formatJobNo } from '../common/job-no'
import type { Insertable } from 'kysely'
import type { DB } from '../db/kysely/db'
import { keysOverlap, strongKeys, normKey, normBookingKey, str, num, date } from './match-keys'
import { guardVendorForwarder, isPlatformNotForwarder, isNotificationPlatformSender } from './vendor-forwarder-guard'
import { deriveState, classifyKindDetail, normMode } from './state'
import { deriveMilestoneRows, deriveEmailRows } from './milestone-rows'
import { currentIdentifierValues, deriveIdentifierRows } from './identifier-rows'
import { matchKeyIndexRows } from './match-key-index'
import { MastersRepository, FUZZY_FORWARDER_TIERS, type ForwarderLinkTier, type PortLinkTier } from '../db/repositories/masters.repository'
import { BookingRepository } from '../db/repositories/booking.repository'
import { PurchaseOrderRepository } from '../db/repositories/purchase-order.repository'
import { ShipmentRepository } from '../db/repositories/shipment.repository'
import { FieldLockRepository } from '../db/repositories/field-lock.repository'
import { AuditRepository } from '../db/repositories/audit.repository'
import { EvidenceRepository } from '../db/repositories/evidence.repository'
import { resolvePoEnrichment, unattributedBrandStyle } from './po-enrichment'
import { poQtyIssue, describePoQtyIssue } from './po-qty-consistency'
import { mapFieldsToLegColumns } from './committer-leg-mapping'

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
  constructor(
    private readonly masters: MastersRepository,
    private readonly bookings: BookingRepository,
    private readonly shipments: ShipmentRepository,
    private readonly fieldLocks: FieldLockRepository,
    private readonly audit: AuditRepository,
    private readonly evidence: EvidenceRepository,
    private readonly purchaseOrders: PurchaseOrderRepository,
  ) {}

  async apply(g: ReconGroup): Promise<CommitResult> {
    const f = g.fields
    const gk = strongKeys(g.matchKeys)

    // de-correction (c) — SOUL-FIRST shadow: the classifiers below still fire exactly as today (they are
    // load-bearing), but each model-correction is recorded as a 'shadow' audit row so the gap is measurable.
    // The rows are flushed after the leg id is known and never surface in the user-facing history.
    const shadows: { field: string; oldValue: string | null; newValue: string | null; note: string }[] = []

    // c3: normBookingKey folds a revision suffix ('BX845666 V3' → 'BX845666') so a re-issue amends its base.
    // Kept byte-identical to the matcher's mirror (parity mandated) — only shadow-measured here, never changed.
    const bnRaw = str(g.matchKeys?.booking_no) ?? str(f.booking_no)
    if (bnRaw && normBookingKey(bnRaw) !== normKey(bnRaw))
      shadows.push({ field: 'booking_no', oldValue: bnRaw, newValue: normBookingKey(bnRaw), note: 'normBookingKey revision fold' })

    // A notification platform (TradeLinkOne CVP portal) is never the forwarder — scrub before resolution
    // so its synced forwarder master row (code 603) can't link. Parser-side validate 4c is the first line;
    // this covers evidence parsed before that rule (and any other producer).
    // c1: keep the scrub (behavior unchanged); shadow-record what it removed.
    const scrubbedForwarder = isPlatformNotForwarder(str(f.forwarder_name)) ? str(f.forwarder_name) : null
    if (scrubbedForwarder) {
      shadows.push({ field: 'forwarder_name', oldValue: scrubbedForwarder, newValue: null, note: 'platform-not-forwarder scrub' })
      f.forwarder_name = null
    }

    const [customerId, vendorId, forwarderLink, polLink, podLink] = await Promise.all([
      this.resolveCustomer(f.customer_code),
      this.resolveVendor(f.vendor_code),
      this.resolveForwarderLink(f.forwarder_name),
      this.resolvePortLink(f.poi ?? (f as Record<string, unknown>).pol), // POL: id + country (origin_country); alias: parser still emits `pol`
      this.resolvePortLink(f.pod),
    ])
    const forwarderId = forwarderLink.id
    const polId = polLink?.id ?? null
    const podId = podLink?.id ?? null
    // origin_country: the resolved port's country, else derived from an unseeded LOCODE-shaped/free-text POL.
    const originCountry = polLink?.country ?? null // resolved-port country only; no code-side guessing from a raw POL

    // all-AI spec §2 — shadow-meter the deterministic linkers: a link the LLM path did not produce
    // (fuzzy forwarder tier / non-exact port tier) is recorded WITHOUT changing behavior; deleting the
    // tiers is a follow-up gated on these going quiet.
    if (forwarderLink.id && forwarderLink.tier && FUZZY_FORWARDER_TIERS.has(forwarderLink.tier))
      shadows.push({ field: 'forwarder_link', oldValue: str(f.forwarder_name), newValue: forwarderLink.id, note: `fuzzy-tier ${forwarderLink.tier} linked — LLM path missed this name` })
    if (polLink && polLink.tier !== 'unlocode_exact')
      shadows.push({ field: 'port_link', oldValue: str(f.poi ?? (f as Record<string, unknown>).pol), newValue: polLink.id, note: `port tier ${polLink.tier} linked — LLM path missed this value` })
    if (podLink && podLink.tier !== 'unlocode_exact')
      shadows.push({ field: 'port_link', oldValue: str(f.pod), newValue: podLink.id, note: `port tier ${podLink.tier} linked — LLM path missed this value` })

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
    const effReviewStatus = guard.misclassified ? 'provisional' : g.reviewStatus
    const effReasons = ((): string[] | null => {
      const all = [...(reviewReasonsFor(g) ?? []), ...guard.reasons]
      return all.length ? all : null
    })()

    const emailTypes = new Set(g.emailTypes)
    const state = deriveState(emailTypes, f)
    // A cancelled booking is marked leg_status='CANCELLED' (the UI surfaces it as Cancelled); otherwise the
    // leg keeps the existing 'ACTIVE' default. This is a lifecycle flag, not a lockable field.
    const legStatus: 'ACTIVE' | 'CANCELLED' = g.cancelled ? 'CANCELLED' : 'ACTIVE'
    // SHIPMENT (real leg) vs DOCUMENT (orphan invoice/misc with no shipping identity → Unlinked Documents).
    // fromPlatform: the rebuild path pre-computes it (senders in hand); on the agent path the DTO carries no
    // sender, so resolve it here from the source emails' graph ids (defense in depth — see classifyKind (c)).
    const fromPlatform = g.fromPlatform ?? (await this.allSourceEmailsFromPlatform(g))
    const { kind, rule: kindRule } = classifyKindDetail(emailTypes, f, { fromPlatform })
    // c2: rules (b) invoice-only-SO-ref and (c) platform-only are model-correcting demotions (CVP phantom
    // suppression) — shadow-record them. Rule (a) bare_orphan is a genuine no-identity document, not a
    // correction, so it is NOT recorded. Behavior (the demotion itself) is unchanged.
    if (kind === 'DOCUMENT' && (kindRule === 'invoice_so_ref' || kindRule === 'platform_only'))
      shadows.push({ field: 'kind', oldValue: 'SHIPMENT', newValue: 'DOCUMENT', note: `classifyKind ${kindRule}` })
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
      })
      shipmentId = leg.id
      action = 'create_booking'
      await this.writeAudit('booking', bookingId, 'create', null, jobNo, g)
      await this.writeAudit('shipment', shipmentId, 'create', null, state, g)
    }

    // Per-PO master enrichment (brand / item_style_no / total_quantity + unit): pulled from the parsed_record
    // whose PO matches — NOT the shipment-level aggregate — so a brand stated at the SO level never leaks onto
    // every PO, and a PO showing two brands across a thread resolves latest-received-wins. See resolvePoEnrichment.
    const allEvidence = g.pos.length ? await this.evidence.allWithMessage() : []
    const poEnrichment = g.pos.length ? resolvePoEnrichment(allEvidence) : null
    // de-correction (b2 no-PO): brand/style stated with no PO to attach to — surfaced, never silently dropped.
    const unattributed = g.pos.length ? unattributedBrandStyle(allEvidence) : []

    // per-PO shipped qty: prefer the Matcher's unambiguous per-PO qty map (keyed by normalized po_no) when it
    // provides one for this PO; else fall back to the single-PO case (a shipment carrying ONE PO owns the whole
    // qty). With several POs and no map entry the split is unknown, so qty stays null — never attribute the
    // whole shipment total to each (that inflated every PO to the total).
    // Deterministic PO-qty guard: the ERP order is authoritative, so a per-PO shipped qty that EXCEEDS the
    // ordered total, or uses a DIFFERENT unit, is a bad attribution (a broadcast total / wrong unit). Collect
    // any such inconsistency and route the shipment to review below — the qty is kept (not dropped), never
    // silently accepted as fact.
    const poQtyIssues: string[] = []
    // de-correction (b1/b2): the model's per-PO facts are KEPT and SURFACED, never silently corrected —
    // a suspected broadcast total and a brand/style conflict route the leg to review with the raw value intact.
    const poFlagReasons: string[] = []
    for (const poNo of g.pos) {
      const mapped = num(g.poQty?.[normKey(poNo)])
      const perPoQty = mapped ?? (g.pos.length === 1 ? num(f.qty) : null)
      const perPoUnit = str(f.qty_unit) // no code-side default — a missing unit stays null (the parser owns it)
      const enr = poEnrichment?.get(normKey(poNo))
      const qctx = { legQty: perPoQty, legUnit: perPoUnit, poTotal: enr?.totalQuantity ?? null, poUnit: enr?.quantityUnit ?? null }
      const issue = poQtyIssue(qctx)
      if (issue) poQtyIssues.push(`PO ${poNo}: ${describePoQtyIssue(issue, qctx)}`)
      if (enr?.broadcastSuspected && enr.totalQuantity != null)
        poFlagReasons.push(`PO ${poNo}: total_quantity ${enr.totalQuantity} looks like a broadcast total (same value across ≥3 POs) — verify`)
      if (enr?.brandConflict)
        poFlagReasons.push(`PO ${poNo}: brand conflict ${enr.brandConflict.join(' vs ')} (kept ${enr.brand}) — verify`)
      if (enr?.styleConflict)
        poFlagReasons.push(`PO ${poNo}: item_style_no conflict ${enr.styleConflict.join(' vs ')} (kept ${enr.itemStyleNo}) — verify`)
      const poId = await this.purchaseOrders.upsertPo(poNo, customerId, effVendorId, enr)
      await this.bookings.linkPo(bookingId, poId)
      await this.shipments.linkPo(shipmentId, poId, perPoQty, perPoUnit)
    }
    // de-correction (b2 no-PO): a brand/style stated with NO PO is not leaked onto every PO (the LLM did not
    // say per-PO) and no longer silently dropped — flagged for a human on the shipment whose identity it
    // shares, but only when no PO here already carries that field (so a genuine per-PO value isn't drowned).
    const poGotBrand = g.pos.some((p) => poEnrichment?.get(normKey(p))?.brand != null)
    const poGotStyle = g.pos.some((p) => poEnrichment?.get(normKey(p))?.itemStyleNo != null)
    const seenUnattributed = new Set<string>()
    for (const u of unattributed) {
      if (u.field === 'brand' && poGotBrand) continue
      if (u.field === 'item_style_no' && poGotStyle) continue
      if (!keysOverlap(strongKeys(u.matchKeys), gk)) continue // gk = strongKeys(g.matchKeys), computed above
      const dedupe = `${u.field}:${u.value}`
      if (seenUnattributed.has(dedupe)) continue
      seenUnattributed.add(dedupe)
      poFlagReasons.push(`shipment-level ${u.field} "${u.value}" not attributed to any PO — verify per-PO ${u.field}`)
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
    await this.syncMilestones(shipmentId, g, state)
    // de-correction (c): flush the shadow measurements now that the leg id exists (never changes behavior).
    for (const s of shadows) await this.writeShadow(shipmentId, s.field, s.oldValue, s.newValue, s.note, g)
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
      // rule 5 (change-history completeness): brand is a booking-only field with no shipments column, so
      // without an audit here a later-learned brand never appears in the shipment's change-history. crd/
      // customer/vendor/forwarder are already covered (leg audit / resolved-link display), so only the
      // human-readable brand is surfaced here (never a raw UUID).
      if (k === 'brand') await this.writeAudit('shipment', shipmentId, 'update', null, toStr(v), g, 'brand')
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

  private async syncMilestones(shipmentId: string, g: ReconGroup, state: string) {
    await this.shipments.replaceMilestones(shipmentId, deriveMilestoneRows(shipmentId, g.events, g.fields, state))
    await this.shipments.replaceEmails(shipmentId, deriveEmailRows(shipmentId, g.events))
  }

  /** de-correction shadow: record "code would have corrected X" WITHOUT changing behavior, so the model's
   *  error-rate is queryable (count by field/note; distinct entity_id per shipment). changeType='shadow'
   *  keeps these rows out of every user-facing audit/history read (see AuditRepository.listForEntity). */
  private writeShadow(
    shipmentId: string,
    field: string,
    oldValue: string | null,
    newValue: string | null,
    note: string,
    g: ReconGroup,
  ) {
    return this.audit.write({
      entityType: 'shipment',
      entityId: shipmentId,
      field,
      oldValue,
      newValue,
      changeType: 'shadow',
      sourceType: 'system',
      sourceId: g.evidenceIds[0] ?? null,
      note,
    })
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

  private async resolveCustomer(code: unknown): Promise<string | null> {
    const c = str(code)
    if (!c) return null
    // canonical-aware: COLEB silently resolves to COLE's id. A canonical fact must never NULL an otherwise
    // -resolvable customer, so fall back to the original code when the canonical has no master row (Hole-2 guard).
    const canon = await this.masters.canonicalCode(c)
    return (await this.masters.customerIdByCode(canon)) ?? (canon !== c.toUpperCase() ? await this.masters.customerIdByCode(c) : null)
  }
  private resolveVendor(code: unknown) {
    const c = str(code)
    return c ? this.masters.vendorIdByCode(c) : Promise.resolve(null)
  }
  private async resolveForwarderLink(name: unknown): Promise<{ id: string | null; tier: ForwarderLinkTier | null }> {
    const n = str(name)
    if (!n) return { id: null, tier: null }
    const byCode = await this.masters.forwarderIdByCode(n)
    if (byCode) return { id: byCode, tier: 'code_exact' }
    const link = await this.masters.forwarderLinkByName(n)
    return link ?? { id: null, tier: null }
  }
  private async resolvePortLink(code: unknown): Promise<{ id: string; country: string | null; tier: PortLinkTier } | null> {
    const c = str(code)
    return c ? this.masters.portLinkByCodeOrName(c) : null
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
const setsOverlap = (a: Set<string>, b: Set<string>) => {
  for (const x of a) if (b.has(x)) return true
  return false
}
/** BUG 4: two strong-key sets CONFLICT when they state DIFFERENT values for the SAME identity type
 *  (e.g. booking_no:ULLA26060096 on the leg vs booking_no:ULLA26060102 on the group). A conflicting leg
 *  is a different shipment and must never be amended — insert a new leg + route to review instead. Keys
 *  are `type:value`; group by the type prefix and flag any type present on both sides with unequal values. */
const strongKeysConflict = (a: Set<string>, b: Set<string>): boolean => {
  const byType = (s: Set<string>): Map<string, Set<string>> => {
    const m = new Map<string, Set<string>>()
    for (const k of s) {
      const i = k.indexOf(':')
      if (i < 0) continue
      const type = k.slice(0, i)
      const val = k.slice(i + 1)
      if (!m.has(type)) m.set(type, new Set())
      m.get(type)!.add(val)
    }
    return m
  }
  const am = byType(a)
  const bm = byType(b)
  for (const [type, avals] of am) {
    const bvals = bm.get(type)
    if (!bvals) continue // type absent on the other side → no conflict for that type
    // present on both sides: conflict unless they SHARE at least one value for this type
    let shared = false
    for (const v of avals) if (bvals.has(v)) { shared = true; break }
    if (!shared) return true
  }
  return false
}

/**
 * PURE leg-matching (extracted verbatim from apply() so the subtle rules are unit-tested and the per-leg PO
 * lookup becomes ONE bulk load). Given all legs, a bookingId->[poNumber] map, and the group's keys, return the
 * existing leg this group amends — or undefined (→ new leg). A leg matches when:
 *   - it shares a STRONG key with the group AND is PO-consistent (never when their strong keys CONFLICT); OR
 *   - they share a PO and at least ONE side has no strong id (a nascent PO-only leg gaining its first id).
 * A2 fallback: a zero-identity group (no strong key AND no PO) matches another zero-identity leg of the same
 * thread by the conversationId persisted in match_keys — so a re-ingest UPDATES the provisional row.
 */
export function findExistingLeg<L extends { bookingId: string; matchKeys: unknown }>(
  legs: L[],
  posByBooking: Map<string, string[]>,
  gk: Set<string>,
  groupPos: Set<string>,
  conversationId: string | null,
): L | undefined {
  let existing: L | undefined
  for (const l of legs) {
    const legStrong = strongKeys(l.matchKeys as Record<string, unknown>)
    // BUG 4: a group whose strong key states a DIFFERENT value for a type the leg already carries is a
    // DIFFERENT shipment — never a match here, on ANY path (strong-overlap, PO, or conversationId).
    if (strongKeysConflict(gk, legStrong)) continue
    const bkPos = new Set((posByBooking.get(l.bookingId) ?? []).map((p) => normKey(p)).filter(Boolean))
    const sharePo = groupPos.size > 0 && setsOverlap(groupPos, bkPos)
    if (gk.size > 0 && keysOverlap(legStrong, gk)) {
      if (bkPos.size && !sharePo) continue // strong match but clashing POs → not the same shipment
      existing = l
      break
    }
    if (sharePo && (legStrong.size === 0 || gk.size === 0)) {
      existing = l
      break
    }
  }
  // A2: zero-identity group → match another zero-identity leg of the same thread by conversationId. The
  // leg-strong==0 guard keeps it strictly zero-identity, so conversationId can never bridge two legs.
  if (!existing && gk.size === 0 && groupPos.size === 0 && conversationId) {
    const conv = normKey(conversationId)
    existing = legs.find((l) => {
      const mk = (l.matchKeys ?? {}) as Record<string, unknown>
      const legStrong = strongKeys(mk)
      if (legStrong.size !== 0) return false
      if (strongKeysConflict(gk, legStrong)) return false
      return normKey(mk.conversation_id) === conv
    })
  }
  return existing
}
