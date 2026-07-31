import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { QTY_UNIT } from '../db/enums'
import { PurchaseOrderRepository } from '../db/repositories/purchase-order.repository'
import { MastersRepository } from '../db/repositories/masters.repository'
import { AuditRepository } from '../db/repositories/audit.repository'

export interface CreatePoInput {
  poNumber: string
  customerId?: string | null
  vendorId?: string | null
  itemStyleNo?: string | null
  totalQuantity?: number | null
  quantityUnit?: string | null
  notes?: string | null
}

/**
 * PO writes. POs are APP-OWNED (the Cobalt Mesh API has none), so create/edit/delete live here. Master refs
 * (customer/vendor) are VALIDATED against the read-only masters but never created — governance:
 * resolve-or-reject (see cobalt-master-data-governance). Every mutation lands an audit row.
 */
@Injectable()
export class PurchaseOrdersService {
  constructor(
    private readonly pos: PurchaseOrderRepository,
    private readonly masters: MastersRepository,
    private readonly audit: AuditRepository,
  ) {}

  private normalizeUnit(u: string | null | undefined): string | null {
    if (u == null || u === '') return null
    if (!(QTY_UNIT as readonly string[]).includes(u))
      throw new BadRequestException(`invalid quantityUnit "${u}" (expected one of ${QTY_UNIT.join(', ')})`)
    return u
  }

  private async assertMasters(customerId?: string | null, vendorId?: string | null) {
    if (customerId && !(await this.masters.customerExists(customerId)))
      throw new BadRequestException('customer not found — masters are managed in the Cobalt Mesh API and cannot be created here')
    if (vendorId && !(await this.masters.vendorExists(vendorId)))
      throw new BadRequestException('vendor not found — masters are managed in the Cobalt Mesh API and cannot be created here')
  }

  async create(input: CreatePoInput, actorId: string) {
    const poNumber = (input.poNumber ?? '').trim()
    if (!poNumber) throw new BadRequestException('poNumber is required')
    if (await this.pos.findPoByNumber(poNumber)) throw new ConflictException(`PO ${poNumber} already exists`)
    const quantityUnit = this.normalizeUnit(input.quantityUnit)
    await this.assertMasters(input.customerId, input.vendorId)
    const po = await this.pos.createPo({
      poNumber,
      customerId: input.customerId ?? null,
      vendorId: input.vendorId ?? null,
      itemStyleNo: input.itemStyleNo ?? null,
      totalQuantity: input.totalQuantity ?? null,
      quantityUnit: quantityUnit as never,
      notes: input.notes ?? null,
    })
    await this.audit.write({
      entityType: 'purchase_order',
      entityId: po.id,
      changeType: 'create',
      sourceType: 'manual',
      actorUserId: actorId,
      note: `PO ${poNumber} created`,
    })
    return po
  }

  async update(id: string, patch: Record<string, unknown>, actorId: string) {
    const existing = await this.pos.poById(id)
    if (!existing) throw new NotFoundException('purchase order not found')
    const next: Record<string, unknown> = {}
    if ('poNumber' in patch) {
      const n = String(patch.poNumber ?? '').trim()
      if (!n) throw new BadRequestException('poNumber cannot be blank')
      if (n !== existing.poNumber) {
        const clash = await this.pos.findPoByNumber(n)
        if (clash && clash.id !== id) throw new ConflictException(`PO ${n} already exists`)
        next.poNumber = n
      }
    }
    if ('quantityUnit' in patch) next.quantityUnit = this.normalizeUnit(patch.quantityUnit as string | null)
    if ('customerId' in patch || 'vendorId' in patch)
      await this.assertMasters(patch.customerId as string | undefined, patch.vendorId as string | undefined)
    for (const k of ['customerId', 'vendorId', 'totalQuantity', 'notes', 'brand', 'itemStyleNo'] as const) {
      if (k in patch) next[k] = patch[k]
    }
    const row = await this.pos.updatePo(id, next)
    await this.audit.write({
      entityType: 'purchase_order',
      entityId: id,
      changeType: 'update',
      sourceType: 'manual',
      actorUserId: actorId,
      note: `PO updated: ${Object.keys(next).join(', ') || 'no-op'}`,
    })
    return row
  }

  async remove(id: string, actorId: string) {
    const existing = await this.pos.poById(id)
    if (!existing) throw new NotFoundException('purchase order not found')
    const links = await this.pos.poLinkCounts(id)
    if (links.shipments > 0 || links.bookings > 0)
      throw new ConflictException(
        `PO is linked to ${links.shipments} shipment(s) and ${links.bookings} booking(s) — unlink first`,
      )
    await this.pos.deletePo(id)
    await this.audit.write({
      entityType: 'purchase_order',
      entityId: id,
      changeType: 'delete',
      sourceType: 'manual',
      actorUserId: actorId,
      note: `PO ${existing.poNumber} deleted`,
    })
    return { success: true }
  }

  async link(poId: string, shipmentId: string, quantity: number | null, actorId: string) {
    if (!shipmentId) throw new BadRequestException('shipmentId is required')
    const po = await this.pos.poById(poId)
    if (!po) throw new NotFoundException('purchase order not found')
    const row = await this.pos.linkShipmentPo(poId, shipmentId, quantity ?? null, null)
    if (row)
      await this.audit.write({
        entityType: 'shipment_po',
        entityId: row.id,
        changeType: 'create',
        sourceType: 'manual',
        actorUserId: actorId,
        note: `linked shipment ${shipmentId} to PO ${po.poNumber}`,
      })
    return row ?? { alreadyLinked: true }
  }

  /**
   * Correct the quantity / unit a shipment carries of a PO, in place.
   *
   * Only the two fields the link owns. The PO NUMBER is not settable here on purpose: renaming the
   * order is `update()` and moving the line to a different order is unlink-then-link, and folding
   * either into a quantity patch would let one endpoint mean three different things.
   *
   * An omitted key is left alone; an explicit `null` clears. That distinction is load-bearing — the
   * review desk sends only what the operator touched, so a patch of `{quantityUnit: 'cartons'}` must
   * not blank the quantity beside it.
   */
  async updateLink(
    poId: string,
    linkId: string,
    body: { quantity?: number | null; quantityUnit?: string | null },
    actorId: string,
  ) {
    const patch: { quantity?: number | null; quantityUnit?: string | null } = {}
    if ('quantity' in body) {
      const q = body.quantity
      if (q != null && (typeof q !== 'number' || !Number.isFinite(q) || q < 0))
        throw new BadRequestException('quantity must be a non-negative number')
      patch.quantity = q ?? null
    }
    if ('quantityUnit' in body) {
      const u = String(body.quantityUnit ?? '').trim()
      patch.quantityUnit = u === '' ? null : u
    }
    if (Object.keys(patch).length === 0) throw new BadRequestException('nothing to update')

    const row = await this.pos.updateShipmentPo(poId, linkId, patch)
    if (!row) throw new NotFoundException('link not found')
    await this.audit.write({
      entityType: 'shipment_po',
      entityId: linkId,
      changeType: 'update',
      sourceType: 'manual',
      actorUserId: actorId,
      note: `shipment PO line set to ${patch.quantity ?? row.quantity ?? '—'} ${
        patch.quantityUnit ?? row.quantityUnit ?? ''
      }`.trim(),
    })
    return row
  }

  async unlink(poId: string, linkId: string, actorId: string) {
    const row = await this.pos.unlinkShipmentPo(poId, linkId)
    if (!row) throw new NotFoundException('link not found')
    await this.audit.write({
      entityType: 'shipment_po',
      entityId: linkId,
      changeType: 'delete',
      sourceType: 'manual',
      actorUserId: actorId,
      note: 'unlinked shipment from PO',
    })
    return { success: true }
  }
}
