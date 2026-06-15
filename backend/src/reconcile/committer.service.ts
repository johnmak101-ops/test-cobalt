import { Injectable } from '@nestjs/common'
import type * as schema from '@cobalt/contracts'
import { keysOverlap, strongKeys, normKey, str, num, date } from './match-keys'
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

    const [customerId, vendorId, forwarderId, polId, podId] = await Promise.all([
      this.resolveCustomer(f.customer_code),
      this.resolveVendor(f.vendor_code),
      this.resolveForwarder(f.forwarder_name),
      this.resolvePort(f.poi),
      this.resolvePort(f.pod),
    ])

    const emailTypes = new Set(g.emailTypes)
    const state = deriveState(emailTypes, f)
    const legValues: Record<string, unknown> = {
      mode: normMode(g.mode),
      state,
      forwarderId,
      polId,
      podId,
      bookingNo: str(f.booking_no),
      soNo: str(f.so_no),
      hblAwbFcrNo: str(f.hbl_awb_fcr_no),
      mbl: str(f.mbl),
      containerNo: str(f.container_no),
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

    // matching / idempotency: a leg matches only if it shares a strong key AND is PO-consistent.
    const groupPos = new Set(g.pos.map((p) => normKey(p)).filter(Boolean))
    const legs = await this.shipments.allLegs()
    let existing: (typeof legs)[number] | undefined
    for (const l of legs) {
      if (!keysOverlap(strongKeys(l.matchKeys as Record<string, unknown>), gk)) continue
      const bkPos = new Set((await this.bookings.poNumbersFor(l.bookingId)).map((p) => normKey(p)).filter(Boolean))
      if (bkPos.size && !setsOverlap(groupPos, bkPos)) continue
      existing = l
      break
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
      await this.fillBooking(bookingId, { customerId, vendorId, forwarderId, crd: date(f.cargo_ready_date) })
      // review gate is metadata, not a lockable field — always reflect the latest agent score
      if (g.reviewStatus !== undefined)
        await this.shipments.updateLeg(shipmentId, {
          reviewStatus: g.reviewStatus,
          confidence: g.confidence ?? null,
          reviewReasons: g.conflicts.length ? g.conflicts : null,
        })
    } else {
      jobNo = await this.nextJobNo()
      const booking = await this.bookings.create({ jobNo, customerId, vendorId, forwarderId, crd: date(f.cargo_ready_date) })
      bookingId = booking.id
      const leg = await this.shipments.insertLeg({
        bookingId,
        legNo: 1,
        legStatus: 'ACTIVE',
        ...(legValues as object),
        reviewStatus: g.reviewStatus ?? 'confirmed',
        confidence: g.confidence ?? null,
        reviewReasons: g.reviewStatus !== undefined && g.conflicts.length ? g.conflicts : null,
      })
      shipmentId = leg.id
      action = 'create_booking'
      await this.writeAudit('booking', bookingId, 'create', null, jobNo, g)
      await this.writeAudit('shipment', shipmentId, 'create', null, state, g)
    }

    for (const poNo of g.pos) {
      const poId = await this.bookings.upsertPo(poNo, customerId, vendorId)
      await this.bookings.linkPo(bookingId, poId)
      await this.shipments.linkPo(shipmentId, poId, num(f.qty), 'pieces')
    }

    await this.writeIdentifiers(shipmentId, g)
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
   * Persist the identifier history (every value each identity field ever held). `is_current` is
   * re-derived from the ACTUAL committed column value — so a human-locked value stays current — not
   * the agent's flag. Idempotent (delete+insert per shipment), so re-applying a decision never piles
   * up duplicate rows.
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
        isCurrent: current[id.type] === alnum(id.value),
        sourceEmailId: id.sourceEmailId ?? null,
        observedAt: id.observedAt ? new Date(id.observedAt) : null,
      }))
    await this.shipments.replaceIdentifiers(shipmentId, rows)
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

  private resolveCustomer(code: unknown) {
    const c = str(code)
    return c ? this.masters.customerIdByCode(c) : Promise.resolve(null)
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
  private async nextJobNo(): Promise<string> {
    return `JOB-2026-${String((await this.bookings.count()) + 1).padStart(4, '0')}`
  }
}

const toStr = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v))
const same = (a: unknown, b: unknown) => toStr(a) === toStr(b)
const alnum = (v: unknown): string => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
const setsOverlap = (a: Set<string>, b: Set<string>) => {
  for (const x of a) if (b.has(x)) return true
  return false
}
