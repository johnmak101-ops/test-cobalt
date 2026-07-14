import { describe, it, expect, vi } from 'vitest'
import { ConflictException, NotFoundException } from '@nestjs/common'
import { ReviewService } from './review.service'
import type { ShipmentRepository } from '../db/repositories/shipment.repository'
import type { BookingRepository } from '../db/repositories/booking.repository'
import type { FieldLockRepository } from '../db/repositories/field-lock.repository'
import type { AuditRepository } from '../db/repositories/audit.repository'
import type { QueueLearningClient, CorrectionPayload } from './queue-learning.client'

const UPDATED_AT = new Date('2026-07-01T12:00:00.000Z')
const leg = { id: 'leg-1', reviewStatus: 'provisional', grossWeight: 5, etd: null, updatedAt: UPDATED_AT }

function makeService(legOverride: Record<string, unknown> | null = {}) {
  const theLeg = legOverride === null ? null : { ...leg, ...legOverride }
  const shipments = {
    findById: vi.fn(async () => (theLeg == null ? null : { ...theLeg })),
    updateLeg: vi.fn(async () => undefined),
    sourceGraphIdFor: vi.fn(async () => 'graph-1'),
  }
  const bookings = {}
  const locks = { lock: vi.fn(async () => undefined) }
  const audit = { write: vi.fn(async () => undefined) }
  const queueLearning = { postCorrection: vi.fn(async (_payload: CorrectionPayload) => undefined) }
  const svc = new ReviewService(
    shipments as unknown as ShipmentRepository,
    bookings as unknown as BookingRepository,
    locks as unknown as FieldLockRepository,
    audit as unknown as AuditRepository,
    queueLearning as unknown as QueueLearningClient,
  )
  return { svc, shipments, locks, audit, queueLearning }
}

describe('ReviewService.confirm/correct — provisional-only + optimistic concurrency', () => {
  it('confirm throws NotFoundException when the leg is missing', async () => {
    const { svc } = makeService(null)
    await expect(svc.confirm('missing', 'user-1')).rejects.toBeInstanceOf(NotFoundException)
  })

  it('correct throws NotFoundException when the leg is missing', async () => {
    const { svc } = makeService(null)
    await expect(svc.correct('missing', { fields: { soNo: 'X' } }, 'user-1')).rejects.toBeInstanceOf(NotFoundException)
  })

  it('confirm rejects non-provisional legs with 409', async () => {
    const { svc, shipments } = makeService({ reviewStatus: 'confirmed' })
    await expect(svc.confirm('leg-1', 'user-1')).rejects.toBeInstanceOf(ConflictException)
    await expect(svc.confirm('leg-1', 'user-1')).rejects.toThrow(/not provisional/i)
    expect(shipments.updateLeg).not.toHaveBeenCalled()
  })

  it('correct rejects non-provisional legs with 409', async () => {
    const { svc, shipments } = makeService({ reviewStatus: 'confirmed' })
    await expect(svc.correct('leg-1', { fields: { soNo: 'X' } }, 'user-1')).rejects.toBeInstanceOf(ConflictException)
    await expect(svc.correct('leg-1', { fields: { soNo: 'X' } }, 'user-1')).rejects.toThrow(/not provisional/i)
    expect(shipments.updateLeg).not.toHaveBeenCalled()
  })

  it('confirm rejects stale expectedUpdatedAt with 409', async () => {
    const { svc, shipments } = makeService()
    await expect(
      svc.confirm('leg-1', 'user-1', undefined, '2026-06-01T00:00:00.000Z'),
    ).rejects.toBeInstanceOf(ConflictException)
    expect(shipments.updateLeg).not.toHaveBeenCalled()
  })

  it('correct rejects stale expectedUpdatedAt with 409', async () => {
    const { svc, shipments } = makeService()
    await expect(
      svc.correct(
        'leg-1',
        { fields: { soNo: 'X' }, expectedUpdatedAt: '2026-06-01T00:00:00.000Z' },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(ConflictException)
    expect(shipments.updateLeg).not.toHaveBeenCalled()
  })

  it('confirm succeeds when expectedUpdatedAt matches leg.updatedAt', async () => {
    const { svc, shipments } = makeService()
    await svc.confirm('leg-1', 'user-1', undefined, UPDATED_AT.toISOString())
    expect(shipments.updateLeg).toHaveBeenCalledWith(
      'leg-1',
      expect.objectContaining({ reviewStatus: 'confirmed' }),
    )
  })

  it('correct succeeds when expectedUpdatedAt matches leg.updatedAt', async () => {
    const { svc, shipments } = makeService()
    await svc.correct(
      'leg-1',
      { fields: { soNo: 'NEW' }, expectedUpdatedAt: UPDATED_AT.toISOString() },
      'user-1',
    )
    expect(shipments.updateLeg).toHaveBeenCalled()
  })

  it('confirm/correct skip the concurrency check when expectedUpdatedAt is omitted', async () => {
    const { svc, shipments } = makeService()
    await svc.confirm('leg-1', 'user-1')
    await svc.correct('leg-1', { fields: { soNo: 'Y' } }, 'user-1')
    expect(shipments.updateLeg).toHaveBeenCalled()
  })
})

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
      kind: 'correction',
    }))
  })

  it('posts the correction under the queue parse-field name, not the camelCase leg column', async () => {
    const { svc, queueLearning } = makeService({ soNo: 'OLD-SO' })
    await svc.correct('leg-1', { fields: { soNo: 'COSU123' }, reason: 'wrong SO' }, 'user-1')
    // soNo (leg column) must be posted as so_no (the queue's parse field) or the queue can't score it.
    expect(queueLearning.postCorrection).toHaveBeenCalledWith(expect.objectContaining({
      field: 'so_no', agentSaid: 'OLD-SO', humanCorrected: 'COSU123', kind: 'correction',
    }))
  })
})

describe('ReviewService — "looks right" confirm-sentinels feed the queue eval', () => {
  it('confirm() emits a confirm-sentinel for each non-null parse field (agentSaid == humanCorrected == frozen value)', async () => {
    const { svc, queueLearning } = makeService({ soNo: 'COSU123', grossWeight: 5 })
    await svc.confirm('leg-1', 'user-1')
    expect(queueLearning.postCorrection).toHaveBeenCalledWith(expect.objectContaining({
      messageId: 'graph-1', field: 'so_no', agentSaid: 'COSU123', humanCorrected: 'COSU123', kind: 'confirm',
    }))
    expect(queueLearning.postCorrection).toHaveBeenCalledWith(expect.objectContaining({
      field: 'gross_weight', agentSaid: '5', humanCorrected: '5', kind: 'confirm',
    }))
  })

  it('confirm() freezes a date field as YYYY-MM-DD (the parser format), not a full ISO timestamp', async () => {
    const { svc, queueLearning } = makeService({ etd: new Date('2026-02-16T00:00:00.000Z') })
    await svc.confirm('leg-1', 'user-1')
    expect(queueLearning.postCorrection).toHaveBeenCalledWith(expect.objectContaining({
      field: 'etd', agentSaid: '2026-02-16', humanCorrected: '2026-02-16', kind: 'confirm',
    }))
  })

  it('confirm() does NOT emit a sentinel for a null parse field', async () => {
    const { svc, queueLearning } = makeService({ etd: null })
    await svc.confirm('leg-1', 'user-1')
    const posted = queueLearning.postCorrection.mock.calls.map((c) => c[0].field)
    expect(posted).not.toContain('etd')
  })

  it('correct() confirms the fields left untouched but NOT the one just edited', async () => {
    const { svc, queueLearning } = makeService({ soNo: 'COSU123', grossWeight: 5 })
    await svc.correct('leg-1', { fields: { grossWeight: '7.5' }, reason: 'weight was gross not net' }, 'user-1')
    const calls = queueLearning.postCorrection.mock.calls.map((c) => c[0])
    // grossWeight was edited → it is a correction, never a confirm.
    expect(calls).toContainEqual(expect.objectContaining({ field: 'gross_weight', kind: 'correction' }))
    expect(calls).not.toContainEqual(expect.objectContaining({ field: 'gross_weight', kind: 'confirm' }))
    // soNo was left untouched → implicitly confirmed.
    expect(calls).toContainEqual(expect.objectContaining({ field: 'so_no', kind: 'confirm' }))
  })
})
