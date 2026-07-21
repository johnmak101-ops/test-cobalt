import { describe, it, expect, vi } from 'vitest'
import { BadRequestException } from '@nestjs/common'
import { ShipmentsService } from './shipments.service'
import type { ShipmentRepository } from '../db/repositories/shipment.repository'
import type { BookingRepository } from '../db/repositories/booking.repository'
import type { FieldLockRepository } from '../db/repositories/field-lock.repository'
import type { AuditRepository } from '../db/repositories/audit.repository'
import type { CommitterService } from '../reconcile/committer.service'
import type { QueueLearningClient, CorrectionPayload } from '../review/queue-learning.client'

function makeService(legOverride: Record<string, unknown> = {}, graphId: string | null = 'graph-1') {
  const shipments = {
    findById: vi.fn(
      async (): Promise<Record<string, unknown> | null> => ({
        id: 'leg-1',
        qty: 100,
        bookingNo: 'BK-OLD',
        forwarderRaw: 'FWD',
        ...legOverride,
      }),
    ),
    updateLeg: vi.fn(async () => undefined),
    replaceMatchKeys: vi.fn(async () => undefined),
    sourceGraphIdFor: vi.fn(async () => graphId),
  }
  const fieldLocks = { lock: vi.fn(async () => undefined) }
  const audit = { write: vi.fn(async () => undefined) }
  const committer = {
    apply: vi.fn(async () => ({ shipmentId: 'new-leg', jobNo: 'J1', state: 'provisional', action: 'created' })),
  }
  const queueLearning = { postCorrection: vi.fn(async (_p: CorrectionPayload) => undefined) }
  const svc = new ShipmentsService(
    shipments as unknown as ShipmentRepository,
    {} as unknown as BookingRepository,
    fieldLocks as unknown as FieldLockRepository,
    audit as unknown as AuditRepository,
    committer as unknown as CommitterService,
    queueLearning as unknown as QueueLearningClient,
  )
  return { svc, shipments, fieldLocks, audit, committer, queueLearning }
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

describe('ShipmentsService.editFields — #236 P3 identity learning feed', () => {
  it('posts booking_no correction when identity field edited and graph id present', async () => {
    const { svc, queueLearning } = makeService({ bookingNo: 'BK-OLD' })
    await svc.editFields('leg-1', { bookingNo: 'BK-NEW' }, 'user-1', 'fixed booking')
    expect(queueLearning.postCorrection).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'graph-1',
        field: 'booking_no',
        agentSaid: 'BK-OLD',
        humanCorrected: 'BK-NEW',
        kind: 'correction',
        note: 'fixed booking',
      }),
    )
  })

  it('does not post learning for qty (noise firewall — identity only)', async () => {
    const { svc, queueLearning } = makeService({ qty: 100 })
    await svc.editFields('leg-1', { qty: '120' }, 'user-1', 'count fix')
    expect(queueLearning.postCorrection).not.toHaveBeenCalled()
  })

  it('skips queue post when no source graph id (never ship UUID)', async () => {
    const { svc, queueLearning } = makeService({ bookingNo: 'BK-OLD' }, null)
    await svc.editFields('leg-1', { bookingNo: 'BK-NEW' }, 'user-1', 'fixed')
    expect(queueLearning.postCorrection).not.toHaveBeenCalled()
  })
})

describe('ShipmentsService.createManual — same gate on the New shipment form (agent path untouched)', () => {
  it('rejects a negative quantity before committing anything', async () => {
    const { svc, committer } = makeService()
    await expect(
      svc.createManual({ bookingNo: 'BK1', qty: '-10' }, 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(committer.apply).not.toHaveBeenCalled() // never reaches the committer (the agent's write path)
  })

  it('rejects a malformed container number before committing anything', async () => {
    const { svc, committer } = makeService()
    await expect(
      svc.createManual({ containerNo: 'garbage' }, 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(committer.apply).not.toHaveBeenCalled()
  })

  it('rejects a bad UOM before committing anything', async () => {
    const { svc, committer } = makeService()
    await expect(
      svc.createManual({ bookingNo: 'BK1', qtyUnit: 'wqdqwd' }, 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(committer.apply).not.toHaveBeenCalled()
  })

  it('rejects a bad mode before committing anything', async () => {
    const { svc, committer } = makeService()
    await expect(
      svc.createManual({ bookingNo: 'BK1', mode: 'banana' }, 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(committer.apply).not.toHaveBeenCalled()
  })
})
