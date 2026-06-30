import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { QTY_UNIT } from '@cobalt/contracts'
import { BookingRepository } from '../db/repositories/booking.repository'
import { MastersRepository } from '../db/repositories/masters.repository'
import { AuditRepository } from '../db/repositories/audit.repository'

export interface CreatePoInput {
  poNumber: string
  customerId?: string | null
  vendorId?: string | null
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
    private readonly bookings: BookingRepository,
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
    if (await this.bookings.findPoByNumber(poNumber)) throw new ConflictException(`PO ${poNumber} already exists`)
    const quantityUnit = this.normalizeUnit(input.quantityUnit)
    await this.assertMasters(input.customerId, input.vendorId)
    const po = await this.bookings.createPo({
      poNumber,
      customerId: input.customerId ?? null,
      vendorId: input.vendorId ?? null,
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
    const existing = await this.bookings.poById(id)
    if (!existing) throw new NotFoundException('purchase order not found')
    const next: Record<string, unknown> = {}
    if ('poNumber' in patch) {
      const n = String(patch.poNumber ?? '').trim()
      if (!n) throw new BadRequestException('poNumber cannot be blank')
      if (n !== existing.poNumber) {
        const clash = await this.bookings.findPoByNumber(n)
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
    const row = await this.bookings.updatePo(id, next)
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
    const existing = await this.bookings.poById(id)
    if (!existing) throw new NotFoundException('purchase order not found')
    const links = await this.bookings.poLinkCounts(id)
    if (links.shipments > 0 || links.bookings > 0)
      throw new ConflictException(
        `PO is linked to ${links.shipments} shipment(s) and ${links.bookings} booking(s) — unlink first`,
      )
    await this.bookings.deletePo(id)
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
    const po = await this.bookings.poById(poId)
    if (!po) throw new NotFoundException('purchase order not found')
    const row = await this.bookings.linkShipmentPo(poId, shipmentId, quantity ?? null, null)
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

  async unlink(poId: string, linkId: string, actorId: string) {
    const row = await this.bookings.unlinkShipmentPo(poId, linkId)
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
