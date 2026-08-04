import { describe, it, expect } from 'vitest'
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { PurchaseOrdersService } from './purchase-orders.service'

interface Over {
  poByNumber?: unknown
  poById?: unknown
  linkCounts?: { shipments: number; bookings: number }
  customerExists?: boolean
  vendorExists?: boolean
  /** null = the link id does not belong to this PO. */
  linkRow?: null
}

function harness(over: Over = {}) {
  const calls: Array<{ method: string; args: unknown[] }> = []
  const log = (method: string, ...args: unknown[]) => calls.push({ method, args })
  const pos = {
    async findPoByNumber(n: string) {
      log('findPoByNumber', n)
      return over.poByNumber ?? null
    },
    async poById(id: string) {
      log('poById', id)
      return over.poById ?? null
    },
    async createPo(v: Record<string, unknown>) {
      log('createPo', v)
      return { id: 'po-new', ...v }
    },
    async updatePo(id: string, p: Record<string, unknown>) {
      log('updatePo', id, p)
      return { id, ...p }
    },
    async poLinkCounts(id: string) {
      log('poLinkCounts', id)
      return over.linkCounts ?? { shipments: 0, bookings: 0 }
    },
    async deletePo(id: string) {
      log('deletePo', id)
      return { id }
    },
    async linkShipmentPo(poId: string, shipmentId: string, q: number | null) {
      log('linkShipmentPo', poId, shipmentId, q)
      return { id: 'link-1', poId, shipmentId }
    },
    async unlinkShipmentPo(poId: string, linkId: string) {
      log('unlinkShipmentPo', poId, linkId)
      return { id: linkId }
    },
    async updateShipmentPo(poId: string, linkId: string, patch: Record<string, unknown>) {
      log('updateShipmentPo', poId, linkId, patch)
      return over.linkRow === null
        ? null
        : { id: linkId, poId, quantity: 26, quantityUnit: 'pieces', ...patch }
    },
  }
  const masters = {
    async customerExists(id: string) {
      log('customerExists', id)
      return over.customerExists ?? true
    },
    async vendorExists(id: string) {
      log('vendorExists', id)
      return over.vendorExists ?? true
    },
  }
  const audit = {
    async write(row: Record<string, unknown>) {
      log('audit.write', row)
    },
  }

  const svc = new PurchaseOrdersService(pos as any, masters as any, audit as any)
  return { svc, calls }
}

describe('PurchaseOrdersService.create', () => {
  it('rejects a blank PO number', async () => {
    const { svc } = harness()
    await expect(svc.create({ poNumber: '   ' }, 'u1')).rejects.toBeInstanceOf(BadRequestException)
  })

  it('rejects a duplicate PO number', async () => {
    const { svc } = harness({ poByNumber: { id: 'po-x', poNumber: 'PO-1' } })
    await expect(svc.create({ poNumber: 'PO-1' }, 'u1')).rejects.toBeInstanceOf(ConflictException)
  })

  it('rejects an invalid quantity unit', async () => {
    const { svc } = harness()
    await expect(svc.create({ poNumber: 'PO-2', quantityUnit: 'tonnes' }, 'u1')).rejects.toBeInstanceOf(BadRequestException)
  })

  it('rejects an unknown customer — masters are never auto-created', async () => {
    const { svc } = harness({ customerExists: false })
    await expect(svc.create({ poNumber: 'PO-3', customerId: 'cust-x' }, 'u1')).rejects.toBeInstanceOf(BadRequestException)
  })

  it('persists a valid PO (trimmed) and writes a create audit row attributed to the actor', async () => {
    const { svc, calls } = harness()
    const po = await svc.create({ poNumber: ' PO-4 ', quantityUnit: 'pieces', totalQuantity: 100, notes: 'rush' }, 'u1')
    expect((po as { id: string }).id).toBe('po-new')
    const created = calls.find((c) => c.method === 'createPo')!.args[0] as Record<string, unknown>
    expect(created.poNumber).toBe('PO-4')
    expect(created.quantityUnit).toBe('pieces')
    expect(created.notes).toBe('rush')
    const audited = calls.find((c) => c.method === 'audit.write')!.args[0] as Record<string, unknown>
    expect(audited.entityType).toBe('purchase_order')
    expect(audited.changeType).toBe('create')
    expect(audited.sourceType).toBe('manual')
    expect(audited.actorUserId).toBe('u1')
  })
})

describe('PurchaseOrdersService.remove', () => {
  it('refuses to delete a PO linked to shipments (FK-safety)', async () => {
    const { svc } = harness({ poById: { id: 'po-1', poNumber: 'PO-1' }, linkCounts: { shipments: 2, bookings: 0 } })
    await expect(svc.remove('po-1', 'u1')).rejects.toBeInstanceOf(ConflictException)
  })

  it('deletes an unlinked PO and writes a delete audit row', async () => {
    const { svc, calls } = harness({ poById: { id: 'po-1', poNumber: 'PO-1' }, linkCounts: { shipments: 0, bookings: 0 } })
    await svc.remove('po-1', 'u1')
    expect(calls.some((c) => c.method === 'deletePo')).toBe(true)
    const audited = calls.find((c) => c.method === 'audit.write')!.args[0] as Record<string, unknown>
    expect(audited.changeType).toBe('delete')
  })

  it('404s when the PO does not exist', async () => {
    const { svc } = harness({ poById: null })
    await expect(svc.remove('missing', 'u1')).rejects.toBeInstanceOf(NotFoundException)
  })
})

/**
 * The quantity and its unit lived only on the link, and the link could only be created or deleted —
 * so fixing "26 pieces" that should read "26 cartons" meant unlink-and-relink, losing the row's id
 * and its history. The review desk edits it in place.
 */
describe('PurchaseOrdersService.updateLink', () => {
  it('patches only the keys that were sent', async () => {
    const { svc, calls } = harness()
    await svc.updateLink('po-1', 'link-1', { quantityUnit: 'cartons' }, 'u1')
    const call = calls.find((c) => c.method === 'updateShipmentPo')!
    // No `quantity` key: an untouched quantity must not ride along and overwrite itself.
    expect(call.args[2]).toEqual({ quantityUnit: 'cartons' })
  })

  it('treats an explicit null as a clear', async () => {
    const { svc, calls } = harness()
    await svc.updateLink('po-1', 'link-1', { quantity: null }, 'u1')
    expect(calls.find((c) => c.method === 'updateShipmentPo')!.args[2]).toEqual({ quantity: null })
  })

  it('normalises a blank unit to null rather than storing an empty string', async () => {
    const { svc, calls } = harness()
    await svc.updateLink('po-1', 'link-1', { quantityUnit: '  ' }, 'u1')
    expect(calls.find((c) => c.method === 'updateShipmentPo')!.args[2]).toEqual({
      quantityUnit: null,
    })
  })

  it('refuses a negative or non-numeric quantity', async () => {
    const { svc } = harness()
    await expect(svc.updateLink('po-1', 'link-1', { quantity: -3 }, 'u1')).rejects.toBeInstanceOf(
      BadRequestException,
    )
    await expect(
      svc.updateLink('po-1', 'link-1', { quantity: 'twelve' as never }, 'u1'),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('refuses an empty patch', async () => {
    const { svc } = harness()
    await expect(svc.updateLink('po-1', 'link-1', {}, 'u1')).rejects.toBeInstanceOf(
      BadRequestException,
    )
  })

  /** `poId` is in the repository predicate, so a link id from another PO simply matches nothing. */
  it('404s when the link is not this PO\u2019s', async () => {
    const { svc } = harness({ linkRow: null })
    await expect(
      svc.updateLink('po-1', 'link-other', { quantity: 5 }, 'u1'),
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('writes an audit row naming the new line', async () => {
    const { svc, calls } = harness()
    await svc.updateLink('po-1', 'link-1', { quantity: 30, quantityUnit: 'cartons' }, 'u1')
    const audit = calls.find((c) => c.method === 'audit.write')!.args[0] as Record<string, unknown>
    expect(audit.entityType).toBe('shipment_po')
    expect(audit.entityId).toBe('link-1')
    expect(audit.changeType).toBe('update')
    expect(String(audit.note)).toMatch(/30 cartons/)
  })
})
