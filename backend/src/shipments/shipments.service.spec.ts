import { describe, it, expect, vi } from 'vitest'
import { BadRequestException } from '@nestjs/common'
import { ShipmentsService } from './shipments.service'
import type { ShipmentRepository } from '../db/repositories/shipment.repository'
import type { BookingRepository } from '../db/repositories/booking.repository'
import type { FieldLockRepository } from '../db/repositories/field-lock.repository'
import type { AuditRepository } from '../db/repositories/audit.repository'
import type { CommitterService } from '../reconcile/committer.service'

function makeService(legOverride: Record<string, unknown> = {}) {
  const shipments = {
    findById: vi.fn(
      async (): Promise<Record<string, unknown> | null> => ({ id: 'leg-1', qty: 100, ...legOverride }),
    ),
    updateLeg: vi.fn(async () => undefined),
    replaceMatchKeys: vi.fn(async () => undefined),
  }
  const fieldLocks = { lock: vi.fn(async () => undefined) }
  const audit = { write: vi.fn(async () => undefined) }
  const svc = new ShipmentsService(
    shipments as unknown as ShipmentRepository,
    {} as unknown as BookingRepository,
    fieldLocks as unknown as FieldLockRepository,
    audit as unknown as AuditRepository,
    {} as unknown as CommitterService,
  )
  return { svc, shipments, fieldLocks, audit }
}

describe('ShipmentsService.editFields — numeric sanity gate (manual edit path)', () => {
  it('rejects a negative quantity with 400 and writes nothing', async () => {
    const { svc, shipments, fieldLocks, audit } = makeService()
    await expect(svc.editFields('leg-1', { qty: '-10' }, 'user-1', 'typo')).rejects.toBeInstanceOf(
      BadRequestException,
    )
    expect(shipments.updateLeg).not.toHaveBeenCalled()
    expect(fieldLocks.lock).not.toHaveBeenCalled()
    expect(audit.write).not.toHaveBeenCalled()
  })

  it('rejects the whole edit when ONE field is bad — the valid sibling is not written either', async () => {
    const { svc, shipments } = makeService()
    await expect(
      svc.editFields('leg-1', { soNo: 'SO-NEW', qty: '-10' }, 'user-1', 'fix'),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(shipments.updateLeg).not.toHaveBeenCalled() // all-or-nothing, no partial save
  })

  it('rejects negative gross weight with 400', async () => {
    const { svc, shipments } = makeService()
    await expect(
      svc.editFields('leg-1', { grossWeight: '-5' }, 'user-1', 'weight'),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(shipments.updateLeg).not.toHaveBeenCalled()
  })
})
