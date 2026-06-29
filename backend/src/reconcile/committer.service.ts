import { Injectable } from '@nestjs/common'
import type * as schema from '@cobalt/contracts'
import { keysOverlap, strongKeys, normKey, str, num, date } from './match-keys'
import { guardVendorForwarder } from './vendor-forwarder-guard'
import { deriveState, MILESTONE_OF, normMode } from './state'
import { MastersRepository } from '../db/repositories/masters.repository'
import { BookingRepository } from '../db/repositories/booking.repository'
import { ShipmentRepository } from '../db/repositories/shipment.repository'
import { FieldLockRepository } from '../db/repositories/field-lock.repository'
import { AuditRepository } from '../db/repositories/audit.repository'

/** One reconciled shipment picture, ready to commit. */
export interface ReconGroup {
  fields: Record<string, unknown>
  pos: string[]
  matchKeys: Record<string, unknown>
  emailTypes: string[]
  events: { emailType: string; receivedAt: string; graphId?: string | null }[]
  mode: string | null
  conversationId: string | null
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
    const originCountry = pol?.country ?? null

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
    const legValues: Record<string, unknown> = {
      mode: normMode(g.mode),
      state,
      forwarderId: effForwarderId,
      polId,
      podId,
      originCountry,
      bookingNo: str(f.booking_no),
      soNo: str(f.so_no),
      hblAwbFcrNo: str(f.hbl_awb_fcr_no),
      mbl: str(f.mbl),
      containerNo: str(f.container_no),
      scacCode: str(f.scac_code ?? (f as Record<string, unknown>).scac), // alias: parser still emits `scac`
      cargoReadyDate: date(f.cargo_ready_date),
      warehouseStartDate: date(f.warehouse_start_date),
      warehouseEndDate: date(f.warehouse_end_date),
      etd: date(f.etd),
      atd: date(f.atd),
      eta: date(f.eta),
      inDcDate: date(f.in_dc_date),
      qty: num(f.qty),
      itemStyleNo: str(f.item_style_no),
      consigneeName: str(f.consignee_name),
      consigneeAddress: str(f.consignee_address),
      matchKeys: g.matchKeys,
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
      await this.fillBooking(bookingId, { customerId, vendorId: effVendorId, forwarderId: effForwarderId, crd: date(f.cargo_ready_date) })
      // review gate is metadata, not a lockable field — always reflect the latest agent score
      if (effReviewStatus !== undefined)
        await this.shipments.updateLeg(shipmentId, {
          reviewStatus: effReviewStatus,
          confidence: g.confidence ?? null,
          reviewReasons: effReasons,
        })
    } else {
      jobNo = await this.nextJobNo()
      const booking = await this.bookings.create({ jobNo, customerId, vendorId: effVendorId, forwarderId: effForwarderId, crd: date(f.cargo_ready_date) })
      bookingId = booking.id
      const leg = await this.shipments.insertLeg({
        bookingId,
        legNo: 1,
        legStatus: 'ACTIVE',
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

    for (const poNo of g.pos) {
      const poId = await this.bookings.upsertPo(poNo, customerId, effVendorId)
      await this.bookings.linkPo(bookingId, poId)
      await this.shipments.linkPo(shipmentId, poId, num(f.qty), 'pieces')
    }

    await this.writeIdentifiers(shipmentId, g)
    await this.writeParties(shipmentId, g)
    await this.syncMilestones(shipmentId, g)
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
    const seen = new Set<string>()
    const rows = g.identifiers
      .filter((id) => id.value && id.type in COL)
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

  private async syncMilestones(shipmentId: string, g: ReconGroup) {
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
    await this.shipments.replaceMilestones(shipmentId, rows)
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
