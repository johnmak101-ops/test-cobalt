import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ReviewService } from './review.service'
import type { ShipmentRepository } from '../db/repositories/shipment.repository'
import type { BookingRepository } from '../db/repositories/booking.repository'
import type { FieldLockRepository } from '../db/repositories/field-lock.repository'
import type { AuditRepository } from '../db/repositories/audit.repository'
import type { QueueLearningClient } from './queue-learning.client'

const leg = { id: 'leg-1', reviewStatus: 'provisional', grossWeight: 5, etd: null }

function makeService() {
  const shipments = {
    findById: vi.fn(async () => ({ ...leg })),
    updateLeg: vi.fn(async () => undefined),
    sourceGraphIdFor: vi.fn(async () => 'graph-1'),
  }
  const bookings = {}
  const locks = { lock: vi.fn(async () => undefined) }
  const audit = { write: vi.fn(async () => undefined) }
  const queueLearning = { postCorrection: vi.fn(async () => undefined) }
  const svc = new ReviewService(
    shipments as unknown as ShipmentRepository,
    bookings as unknown as BookingRepository,
    locks as unknown as FieldLockRepository,
    audit as unknown as AuditRepository,
    queueLearning as unknown as QueueLearningClient,
  )
  return { svc, shipments, locks, audit, queueLearning }
}

describe('ReviewService.confirm — reviewer note lands in the audit trail', () => {
  it('uses the reviewer note as the audit note when given', async () => {
    const { svc, audit } = makeService()
    await svc.confirm('leg-1', 'user-1', 'parser mapped 进仓单 qty column wrong — use column B')
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({ note: 'parser mapped 进仓单 qty column wrong — use column B' }),
    )
  })

  it('defaults to "review: confirmed as-is" when no note', async () => {
    const { svc, audit } = makeService()
    await svc.confirm('leg-1', 'user-1')
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({ note: 'review: confirmed as-is' }),
    )
  })

  it('ignores a whitespace-only note', async () => {
    const { svc, audit } = makeService()
    await svc.confirm('leg-1', 'user-1', '   ')
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({ note: 'review: confirmed as-is' }),
    )
  })
})

describe('ReviewService.correct — coercion + human-wins locks', () => {
  it('coerces grossWeight and measurement to numbers', async () => {
    const { svc, shipments } = makeService()
    await svc.correct('leg-1', { fields: { grossWeight: '7.5', measurement: '0.04' } }, 'user-1')
    expect(shipments.updateLeg).toHaveBeenCalledWith('leg-1', { grossWeight: 7.5 })
    expect(shipments.updateLeg).toHaveBeenCalledWith('leg-1', { measurement: 0.04 })
  })

  it('locks each corrected field and audits with the reviewer reason', async () => {
    const { svc, locks, audit } = makeService()
    await svc.correct('leg-1', { fields: { etd: '2026-07-12' }, reason: 'ETD was the CFS date' }, 'user-1')
    expect(locks.lock).toHaveBeenCalledWith('shipment', 'leg-1', 'etd', expect.any(String), 'user-1')
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({ field: 'etd', note: 'ETD was the CFS date', sourceType: 'manual' }),
    )
  })

  it('pushes each corrected field to the queue learning feed (old→new, keyed by the source email)', async () => {
    const { svc, queueLearning } = makeService()
    await svc.correct('leg-1', { fields: { etd: '2026-07-12' }, reason: 'ETD was the CFS date' }, 'user-1')
    expect(queueLearning.postCorrection).toHaveBeenCalledWith(expect.objectContaining({
      messageId: 'graph-1', field: 'etd', agentSaid: null, humanCorrected: '2026-07-12T00:00:00.000Z', note: 'ETD was the CFS date',
    }))
  })
})
