import { Inject, Injectable } from '@nestjs/common'
import { eq, ilike, sql } from 'drizzle-orm'
import * as schema from '@cobalt/contracts'
import { DRIZZLE, type DrizzleDB } from '../db/drizzle.provider'
import { keysOverlap, strongKeys, normKey, str, num, date } from './match-keys'
import { deriveState, MILESTONE_OF, normMode } from './state'

/** One reconciled shipment picture, ready to commit. */
export interface ReconGroup {
  fields: Record<string, unknown>
  pos: string[]
  matchKeys: Record<string, unknown>
  emailTypes: string[]
  events: { emailType: string; receivedAt: string }[]
  mode: string | null
  conversationId: string | null
  conflicts: string[]
  evidenceIds: string[]
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
 * audit on every change, idempotency (find-or-update a leg by its match_keys bag).
 */
@Injectable()
export class CommitterService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async apply(g: ReconGroup): Promise<CommitResult> {
    const f = g.fields
    const gk = strongKeys(g.matchKeys)

    // resolve masters (best-effort; leave null when unknown)
    const [customerId, vendorId, forwarderId, polId, podId] = await Promise.all([
      this.customerId(f.customer_code),
      this.vendorId(f.vendor_code),
      this.forwarderId(f.forwarder_name),
      this.portId(f.poi),
      this.portId(f.pod),
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

    // matching / idempotency: a leg matches only if it shares a strong key AND is PO-consistent
    // (its booking shares a PO with this group) — guards against rotating-ID false positives.
    const groupPos = new Set(g.pos.map((p) => normKey(p)).filter(Boolean))
    const legs = await this.db.select().from(schema.shipments)
    let existing: (typeof legs)[number] | undefined
    for (const l of legs) {
      if (!keysOverlap(strongKeys(l.matchKeys as Record<string, unknown>), gk)) continue
      const bkPos = await this.bookingPoNumbers(l.bookingId)
      // if the candidate booking has POs, this group MUST share one (a weak PO-less group
      // never attaches to an established booking on a rotating-ID collision alone)
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
      const [bk] = await this.db.select().from(schema.bookings).where(eq(schema.bookings.id, bookingId))
      jobNo = bk?.jobNo ?? '(unknown)'
      await this.applyFields('shipment', shipmentId, existing as Record<string, unknown>, legValues, skippedLockedFields)
      // fill booking parent fields that were empty
      await this.fillBooking(bookingId, { customerId, vendorId, forwarderId, crd: date(f.cargo_ready_date) })
    } else {
      jobNo = await this.nextJobNo()
      const [booking] = await this.db
        .insert(schema.bookings)
        .values({ jobNo, customerId, vendorId, forwarderId, crd: date(f.cargo_ready_date) })
        .returning()
      bookingId = booking.id
      const [leg] = await this.db
        .insert(schema.shipments)
        .values({ bookingId, legNo: 1, legStatus: 'ACTIVE', ...(legValues as object) })
        .returning()
      shipmentId = leg.id
      action = 'create_booking'
      await this.audit('booking', bookingId, 'create', null, jobNo, g)
      await this.audit('shipment', shipmentId, 'create', null, state, g)
    }

    // link POs (union) at booking + leg level
    for (const poNo of g.pos) {
      const poId = await this.upsertPo(poNo, customerId, vendorId)
      await this.db.insert(schema.bookingPos).values({ bookingId, poId }).onConflictDoNothing()
      await this.db
        .insert(schema.shipmentPos)
        .values({ shipmentId, poId, quantity: num(f.qty), quantityUnit: 'pieces' })
        .onConflictDoNothing()
    }

    await this.syncMilestones(shipmentId, g)
    return { action, jobNo, bookingId, shipmentId, state, conflicts: g.conflicts, skippedLockedFields }
  }

  // ---- field-lock-aware update + audit ----
  private async applyFields(
    entityType: 'booking' | 'shipment',
    entityId: string,
    current: Record<string, unknown>,
    next: Record<string, unknown>,
    skipped: string[],
  ) {
    const locks = await this.db
      .select()
      .from(schema.fieldLocks)
      .where(eq(schema.fieldLocks.entityId, entityId))
    const locked = new Set(locks.filter((l) => l.entityType === entityType).map((l) => l.field))

    const patch: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(next)) {
      if (v == null) continue // never blank out an existing value
      if (locked.has(k)) {
        if (!same(current[k], v)) skipped.push(k) // human-wins: agent must not overwrite
        continue
      }
      if (!same(current[k], v)) {
        patch[k] = v
        await this.audit(entityType, entityId, 'update', toStr(current[k]), toStr(v), undefined, k)
      }
    }
    if (Object.keys(patch).length) {
      patch.updatedAt = new Date()
      await this.db.update(schema.shipments).set(patch).where(eq(schema.shipments.id, entityId))
    }
  }

  private async fillBooking(bookingId: string, vals: Record<string, unknown>) {
    const [bk] = await this.db.select().from(schema.bookings).where(eq(schema.bookings.id, bookingId))
    if (!bk) return
    const patch: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(vals)) if (v != null && (bk as Record<string, unknown>)[k] == null) patch[k] = v
    if (Object.keys(patch).length) {
      patch.updatedAt = new Date()
      await this.db.update(schema.bookings).set(patch).where(eq(schema.bookings.id, bookingId))
    }
  }

  // ---- milestones (idempotent: replace the leg's set from the email events) ----
  private async syncMilestones(shipmentId: string, g: ReconGroup) {
    await this.db.delete(schema.shipmentMilestones).where(eq(schema.shipmentMilestones.shipmentId, shipmentId))
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
      })
    }
    if (rows.length) await this.db.insert(schema.shipmentMilestones).values(rows)
  }

  // ---- audit ----
  private async audit(
    entityType: string,
    entityId: string,
    changeType: 'create' | 'update',
    oldValue: string | null,
    newValue: string | null,
    g?: ReconGroup,
    field?: string,
  ) {
    await this.db.insert(schema.changeLog).values({
      entityType: entityType as never,
      entityId,
      field: field ?? null,
      oldValue,
      newValue,
      changeType: changeType as never,
      sourceType: 'agent',
      sourceId: g?.evidenceIds[0] ?? null,
    })
  }

  // ---- resolvers ----
  private async customerId(code: unknown) {
    const c = str(code)
    if (!c) return null
    const [r] = await this.db.select().from(schema.customers).where(eq(schema.customers.code, c.toUpperCase()))
    return r?.id ?? null
  }
  private async vendorId(code: unknown) {
    const c = str(code)
    if (!c) return null
    const [r] = await this.db.select().from(schema.vendors).where(eq(schema.vendors.code, c.toUpperCase()))
    return r?.id ?? null
  }
  private async forwarderId(name: unknown) {
    const n = str(name)
    if (!n) return null
    const [r] = await this.db.select().from(schema.forwarders).where(ilike(schema.forwarders.name, `%${n}%`))
    if (r) return r.id
    const [a] = await this.db
      .select()
      .from(schema.forwarderAliases)
      .where(ilike(schema.forwarderAliases.value, `%${n}%`))
    return a?.forwarderId ?? null
  }
  private async portId(code: unknown) {
    const c = str(code)
    if (!c) return null
    const [byCode] = await this.db.select().from(schema.ports).where(eq(schema.ports.unlocode, c.toUpperCase()))
    if (byCode) return byCode.id
    const [byName] = await this.db.select().from(schema.ports).where(ilike(schema.ports.name, `%${c}%`))
    return byName?.id ?? null
  }
  private async upsertPo(poNo: string, customerId: string | null, vendorId: string | null) {
    const [existing] = await this.db
      .select()
      .from(schema.purchaseOrders)
      .where(eq(schema.purchaseOrders.poNumber, poNo))
    if (existing) return existing.id
    const [created] = await this.db
      .insert(schema.purchaseOrders)
      .values({ poNumber: poNo, customerId, vendorId })
      .returning()
    return created.id
  }
  private async nextJobNo(): Promise<string> {
    const [{ n }] = await this.db.select({ n: sql<number>`count(*)::int` }).from(schema.bookings)
    return `JOB-2026-${String(n + 1).padStart(4, '0')}`
  }

  private async bookingPoNumbers(bookingId: string): Promise<Set<string>> {
    const rows = await this.db
      .select({ poNumber: schema.purchaseOrders.poNumber })
      .from(schema.bookingPos)
      .innerJoin(schema.purchaseOrders, eq(schema.bookingPos.poId, schema.purchaseOrders.id))
      .where(eq(schema.bookingPos.bookingId, bookingId))
    return new Set(rows.map((r) => normKey(r.poNumber)).filter(Boolean))
  }
}

const toStr = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v))
const same = (a: unknown, b: unknown) => toStr(a) === toStr(b)
const setsOverlap = (a: Set<string>, b: Set<string>) => {
  for (const x of a) if (b.has(x)) return true
  return false
}
