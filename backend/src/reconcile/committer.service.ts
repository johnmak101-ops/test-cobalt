import { Injectable } from '@nestjs/common'
import type * as schema from '@cobalt/contracts'
import { keysOverlap, strongKeys, normKey, str, num, date } from './match-keys'
import { guardVendorForwarder } from './vendor-forwarder-guard'
import { deriveState, classifyKind, MILESTONE_OF, DERIVED_MILESTONE_OF, normMode } from './state'
import { MastersRepository } from '../db/repositories/masters.repository'
import { BookingRepository } from '../db/repositories/booking.repository'
import { ShipmentRepository } from '../db/repositories/shipment.repository'
import { FieldLockRepository } from '../db/repositories/field-lock.repository'
import { AuditRepository } from '../db/repositories/audit.repository'
import { EvidenceRepository } from '../db/repositories/evidence.repository'
import { resolvePoEnrichment } from './po-enrichment'

/** Dedupe a comma-joined list (order-preserving, case-insensitive) — style/HTS lists pile up across the
 *  multiple PO sheets + B/L rider, so the same value repeats. Applied at commit so it holds without a reparse. */
const dedupeCsv = (s: string | null): string | null => {
  if (!s || !s.includes(',')) return s
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of s.split(',').map((x) => x.trim()).filter(Boolean)) {
    const k = t.toUpperCase()
    if (!seen.has(k)) {
      seen.add(k)
      out.push(t)
    }
  }
  return out.length ? out.join(',') : s
}

/** The ocean carrier SCAC is the leading 4 letters of the MASTER B/L (MEDUP5180997 -> MEDU = MSC). A
 *  deterministic backstop for when the model didn't emit scac_code; SCAC is stored as-is (no master check). */
const scacFromMbl = (mbl: string | null): string | null => {
  // BUG 12: require carrier-BL shape — 4 letters immediately followed by a digit (MAEU5..., MEDU8...) — so a
  // house routing ref like 'HUN-HKG-FXT-...' doesn't coin a bogus SCAC from its leading letters.
  const m = /^([A-Z]{4})\d/.exec((mbl ?? '').toUpperCase())
  return m ? m[1] : null
}

/** Origin countries spelled out in a free-text POL (e.g. "SHAHAJALAL INTL. AIR PORT, BANGLADESH") →
 *  ISO-2. Only used as a last-resort origin_country backstop when the port itself doesn't resolve. */
const COUNTRY_TO_ISO2: Record<string, string> = {
  BANGLADESH: 'BD', CHINA: 'CN', CAMBODIA: 'KH', VIETNAM: 'VN', INDIA: 'IN', INDONESIA: 'ID',
  THAILAND: 'TH', PAKISTAN: 'PK', 'SRI LANKA': 'LK', TURKEY: 'TR', MYANMAR: 'MM', 'HONG KONG': 'HK',
  TAIWAN: 'TW', 'SOUTH KOREA': 'KR', KOREA: 'KR', JAPAN: 'JP', PHILIPPINES: 'PH', MALAYSIA: 'MY',
}

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
  ) {}

  async apply(g: ReconGroup): Promise<CommitResult> {
    const f = g.fields
    const gk = strongKeys(g.matchKeys)

    const [customerId, vendorId, forwarderId, pol, podId] = await Promise.all([
      this.resolveCustomer(f.customer_code),
      this.resolveVendor(f.vendor_code),
      this.resolveForwarder(f.forwarder_name),
      this.resolvePortFull(f.poi ?? (f as Record<string, unknown>).pol), // POL: id + country (origin_country); alias: parser still emits `pol`
      this.resolvePort(f.pod),
    ])
    const polId = pol?.id ?? null
    // origin_country prefers the resolved port's country; but when the POL is UNSEEDED (pol is null) and the
    // raw value is a UN/LOCODE shape (2 ISO-country letters + 3 alnum, e.g. CNPVG → CN), derive the country
    // from its prefix. Guarded to that exact shape so a 3-letter IATA (CKG) or free text never triggers it.
    const originCountry =
      pol?.country ??
      (() => {
        const rawPol = (str(f.poi ?? (f as Record<string, unknown>).pol) ?? '').toUpperCase()
        if (/^[A-Z]{2}[A-Z0-9]{3}$/.test(rawPol)) return rawPol.slice(0, 2)
        // free-text POL that spells out the origin country in its trailing segment
        const tail = (rawPol.split(',').pop() ?? '').replace(/[^A-Z ]+/g, ' ').replace(/\s+/g, ' ').trim()
        return COUNTRY_TO_ISO2[tail] ?? null
      })()

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
    const kind = classifyKind(emailTypes, f)
    const legValues: Record<string, unknown> = {
      mode: normMode(g.mode),
      state,
      kind,
      forwarderId: effForwarderId,
      forwarderRaw: str(f.forwarder_name), // raw — surfaced when forwarderId doesn't resolve
      polId,
      podId,
      originCountry,
      polRaw: str(f.poi ?? (f as Record<string, unknown>).pol), // raw — surfaced when polId doesn't resolve
      podRaw: str(f.pod),
      bookingNo: str(f.booking_no),
      soNo: str(f.so_no),
      hblAwbFcrNo: str(f.hbl_awb_fcr_no),
      mbl: str(f.mbl),
      containerNo: str(f.container_no),
      scacCode: str(f.scac_code ?? (f as Record<string, unknown>).scac) ?? scacFromMbl(str(f.mbl)), // alias `scac`; fall back to MBL prefix
      vesselName: str(f.vessel_name),
      voyageNo: str(f.voyage_no),
      flightNo: str(f.flight_no),
      mawb: str(f.mawb),
      cargoReadyDate: date(f.cargo_ready_date),
      warehouseStartDate: date(f.warehouse_start_date),
      warehouseEndDate: date(f.warehouse_end_date),
      etd: date(f.etd),
      atd: date(f.atd),
      eta: date(f.eta),
      ata: date(f.ata),
      inDcDate: date(f.in_dc_date),
      qty: num(f.qty),
      qtyUnit: str(f.qty_unit) as 'cartons' | 'pieces' | 'cbm' | null,
      grossWeight: num(f.gross_weight),
      measurement: num(f.measurement),
      htsCode: dedupeCsv(str(f.hts_code)),
      itemStyleNo: dedupeCsv(str(f.item_style_no)),
      consigneeName: str(f.consignee_name),
      consigneeAddress: str(f.consignee_address),
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
    const legs = await this.shipments.allLegs()
    let existing: (typeof legs)[number] | undefined
    for (const l of legs) {
      const legStrong = strongKeys(l.matchKeys as Record<string, unknown>)
      // BUG 4: a group whose strong key states a DIFFERENT value for a type the leg already carries is a
      // DIFFERENT shipment (e.g. the grouper split ULLA26060096 off — the 2nd ULLA must never amend the
      // first). Such a leg is never a match here, on ANY path (strong-overlap, PO, or conversationId).
      if (strongKeysConflict(gk, legStrong)) continue
      const bkPos = new Set((await this.bookings.poNumbersFor(l.bookingId)).map((p) => normKey(p)).filter(Boolean))
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

    // A2: a zero-identity group (no strong key AND no PO) has no cross-run handle, so each commit would
    // insert a fresh ghost leg. Fall back to the conversationId persisted in match_keys, matching only
    // another zero-identity leg of the same thread, so a re-ingest UPDATES the provisional row.
    // BUG 4: the fallback ALSO requires the candidate leg to carry no strong key AND the group to be
    // identity-less — so the conversationId can never bridge two identity-conflicting legs. (When gk.size
    // is 0 no strong key can conflict, but the leg-strong==0 guard keeps the fallback strictly zero-identity.)
    if (!existing && gk.size === 0 && groupPos.size === 0 && g.conversationId) {
      const conv = normKey(g.conversationId)
      existing = legs.find((l) => {
        const mk = (l.matchKeys ?? {}) as Record<string, unknown>
        const legStrong = strongKeys(mk)
        if (legStrong.size !== 0) return false
        if (strongKeysConflict(gk, legStrong)) return false
        return normKey(mk.conversation_id) === conv
      })
    }

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
      await this.fillBooking(bookingId, { customerId, vendorId: effVendorId, forwarderId: effForwarderId, brand: str(f.brand), crd: date(f.cargo_ready_date) })
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
    const poEnrichment = g.pos.length ? resolvePoEnrichment(await this.evidence.allWithMessage()) : null

    // per-PO shipped qty: prefer the Matcher's unambiguous per-PO qty map (keyed by normalized po_no) when it
    // provides one for this PO; else fall back to the single-PO case (a shipment carrying ONE PO owns the whole
    // qty). With several POs and no map entry the split is unknown, so qty stays null — never attribute the
    // whole shipment total to each (that inflated every PO to the total).
    for (const poNo of g.pos) {
      const mapped = num(g.poQty?.[normKey(poNo)])
      const perPoQty = mapped ?? (g.pos.length === 1 ? num(f.qty) : null)
      // only default the unit to 'cartons' when there IS a qty — otherwise a phantom 'cartons' shows on the PO
      // table while CARGO shows (pending). No qty -> unit is whatever was extracted, or null.
      const perPoUnit = perPoQty != null ? str(f.qty_unit) ?? 'cartons' : str(f.qty_unit)
      const poId = await this.bookings.upsertPo(poNo, customerId, effVendorId, poEnrichment?.get(normKey(poNo)))
      await this.bookings.linkPo(bookingId, poId)
      await this.shipments.linkPo(shipmentId, poId, perPoQty, perPoUnit)
    }

    await this.writeIdentifiers(shipmentId, g)
    await this.writeParties(shipmentId, g)
    await this.syncMilestones(shipmentId, g, state)
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

  private async fillBooking(bookingId: string, vals: Record<string, unknown>) {
    const bk = await this.bookings.findById(bookingId)
    if (!bk) return
    const patch: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(vals)) if (v != null && (bk as Record<string, unknown>)[k] == null) patch[k] = v
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
    const COL = { so_no: 'soNo', booking_no: 'bookingNo', hbl_awb_fcr_no: 'hblAwbFcrNo', mbl: 'mbl', container_no: 'containerNo' } as const
    const current: Record<string, string> = {}
    for (const [type, col] of Object.entries(COL)) {
      const v = (leg as Record<string, unknown>)[col]
      if (v != null && v !== '') current[type] = alnum(v)
    }
    // 7b: the SAME value can arrive under several identity types (a booking number echoed as an SO number,
    // an MBL echoed as an HBL). In the WRITTEN history keep each alnum-equal value only under its highest-
    // priority type (booking_no > mbl > hbl_awb_fcr_no > so_no), so the identifier table isn't polluted with
    // redundant cross-type rows. match_keys/strongKeys stay type-scoped and are untouched by this.
    const TYPE_PRIORITY: Record<string, number> = { booking_no: 0, mbl: 1, hbl_awb_fcr_no: 2, so_no: 3 }
    const bestTypeForValue = new Map<string, string>()
    for (const id of g.identifiers) {
      if (!id.value || !(id.type in COL)) continue
      const rank = TYPE_PRIORITY[id.type]
      if (rank === undefined) continue // container_no etc. — not cross-type deduped
      const av = alnum(id.value)
      const cur = bestTypeForValue.get(av)
      if (cur === undefined || rank < (TYPE_PRIORITY[cur] ?? Infinity)) bestTypeForValue.set(av, id.type)
    }
    const seen = new Set<string>()
    const rows = g.identifiers
      .filter((id) => id.value && id.type in COL)
      .filter((id) => {
        // drop a prioritizable value that is being kept under a higher-priority type
        if (id.type in TYPE_PRIORITY) {
          const winner = bestTypeForValue.get(alnum(id.value))
          if (winner && winner !== id.type) return false
        }
        return true
      })
      .filter((id) => {
        const k = `${id.type}:${id.value}`
        if (seen.has(k)) return false
        seen.add(k)
        return true
      })
      .map((id) => ({
        shipmentId,
        type: id.type as (typeof schema.shipmentIdentifiers.$inferInsert)['type'],
        value: id.value,
        docType: id.docType ?? null,
        rank: id.rank ?? null,
        isCurrent: current[id.type] === alnum(id.value) || id.isCurrent === true,
        sourceEmailId: id.sourceEmailId ?? null,
        observedAt: id.observedAt ? new Date(id.observedAt) : null,
      }))
    await this.shipments.replaceIdentifiers(shipmentId, rows)
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
    const rows: (typeof schema.shipmentParties.$inferInsert)[] = []
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
        role: (e.role ?? 'other') as (typeof schema.shipmentParties.$inferInsert)['role'],
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
    const seen = new Set<string>()
    const rows: (typeof schema.shipmentMilestones.$inferInsert)[] = []
    for (const ev of [...g.events].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))) {
      const mt = MILESTONE_OF[ev.emailType]
      if (!mt || seen.has(mt)) continue
      seen.add(mt)
      rows.push({
        shipmentId,
        milestoneType: mt as (typeof schema.shipmentMilestones.$inferInsert)['milestoneType'],
        occurredAt: new Date(ev.receivedAt),
        senderType: 'forwarder',
        emailMessageId: ev.graphId ?? null, // graph id → "view original" re-fetch
      })
    }
    // BUG 7: also emit milestones DERIVED from field presence (warehouse_start_date → AT_WAREHOUSE,
    // atd → SAILED), dated by that field, so the timeline matches the state deriveState already reached from
    // the same fields. Idempotent via `seen` (a field-derived type never duplicates an email-derived one of
    // the same type). Only when the field has a parseable date.
    for (const { field, milestone } of DERIVED_MILESTONE_OF) {
      if (seen.has(milestone)) continue
      const occurredAt = date(g.fields[field])
      if (!occurredAt) continue
      seen.add(milestone)
      rows.push({
        shipmentId,
        milestoneType: milestone as (typeof schema.shipmentMilestones.$inferInsert)['milestoneType'],
        occurredAt,
        senderType: 'forwarder',
        notes: 'derived', // field-derived, not email-type-mapped
      })
    }
    // BUG 3: deriveState can reach SAILED via the Invoice/Billing + mbl + past-etd path with atd NULL, so the
    // atd→SAILED derived milestone above never fires and the timeline shows a blank departure. When the committed
    // state IS SAILED but no SAILED milestone was emitted (neither email- nor atd-derived) and atd is absent,
    // emit one dated by etd. Idempotent via `seen`; never double-emits when atd already produced a SAILED row.
    if (state === 'SAILED' && !seen.has('SAILED') && !date(g.fields.atd)) {
      const etd = date(g.fields.etd)
      if (etd) {
        seen.add('SAILED')
        rows.push({
          shipmentId,
          milestoneType: 'SAILED' as (typeof schema.shipmentMilestones.$inferInsert)['milestoneType'],
          occurredAt: etd,
          senderType: 'forwarder',
          notes: 'derived from etd',
        })
      }
    }
    await this.shipments.replaceMilestones(shipmentId, rows)
    // Related Emails: EVERY source email (deduped by graph id) — including unmapped "Other"/Customs emails
    // that carry the shipment's data but map to no milestone, so they were invisible before.
    const seenEmail = new Set<string>()
    const emailRows: (typeof schema.shipmentEmails.$inferInsert)[] = []
    for (const ev of g.events) {
      if (!ev.graphId || seenEmail.has(ev.graphId)) continue
      seenEmail.add(ev.graphId)
      emailRows.push({ shipmentId, graphMessageId: ev.graphId, emailType: ev.emailType, receivedAt: new Date(ev.receivedAt) })
    }
    await this.shipments.replaceEmails(shipmentId, emailRows)
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
  private resolveForwarder(name: unknown) {
    const n = str(name)
    return n ? this.masters.forwarderIdByName(n) : Promise.resolve(null)
  }
  private resolvePort(code: unknown) {
    const c = str(code)
    return c ? this.masters.portIdByCodeOrName(c) : Promise.resolve(null)
  }
  private resolvePortFull(code: unknown) {
    const c = str(code)
    return c ? this.masters.portByCodeOrName(c) : Promise.resolve(null)
  }
  private async nextJobNo(): Promise<string> {
    return `JOB-2026-${String(await this.bookings.nextJobSeq()).padStart(4, '0')}`
  }
}

/** What to surface in the review queue: the agent gate's reasons when present, else the raw conflicts. */
const reviewReasonsFor = (g: ReconGroup): string[] | null =>
  g.reviewReasons?.length ? g.reviewReasons : g.conflicts.length ? g.conflicts : null

const toStr = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v))
const same = (a: unknown, b: unknown) => toStr(a) === toStr(b)
const alnum = (v: unknown): string => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
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
