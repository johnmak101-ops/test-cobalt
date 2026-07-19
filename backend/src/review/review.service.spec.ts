import { describe, it, expect, vi } from 'vitest'
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { ReviewService } from './review.service'
import type { ShipmentRepository } from '../db/repositories/shipment.repository'
import type { BookingRepository } from '../db/repositories/booking.repository'
import type { FieldLockRepository } from '../db/repositories/field-lock.repository'
import type { AuditRepository } from '../db/repositories/audit.repository'
import type { CriticCalibrationRepository } from '../db/repositories/critic-calibration.repository'
import type { QueueLearningClient, CorrectionPayload } from './queue-learning.client'
import { normBookingKey } from '../reconcile/match-keys'

const UPDATED_AT = new Date('2026-07-01T12:00:00.000Z')
const leg = { id: 'leg-1', reviewStatus: 'provisional', grossWeight: 5, etd: null, updatedAt: UPDATED_AT }

function makeService(legOverride: Record<string, unknown> | null = {}) {
  const theLeg = legOverride === null ? null : { ...leg, ...legOverride }
  const shipments = {
    // Takes the id and returns a LOOSE shape on purpose: link() looks up two different legs (source +
    // target), so its cases need per-id mockImplementation / mockResolvedValueOnce with shapes other
    // than `leg`. A zero-arg narrow fake made those un-typecheckable (CI: backend tsc covers specs).
    findById: vi.fn(
      async (_id: string): Promise<Record<string, unknown> | null> => (theLeg == null ? null : { ...theLeg }),
    ),
    updateLeg: vi.fn(async () => undefined),
    replaceMatchKeys: vi.fn(async () => undefined),
    sourceGraphIdFor: vi.fn(async () => 'graph-1'),
    candidateLegs: vi.fn(async () => [] as Record<string, unknown>[]),
    linkProvisionalLeg: vi.fn(async () => undefined),
  }
  const bookings = {
    findById: vi.fn(async () => null as { jobNo: string } | null),
  }
  const locks = { lock: vi.fn(async () => undefined) }
  const audit = { write: vi.fn(async () => undefined) }
  const queueLearning = { postCorrection: vi.fn(async (_payload: CorrectionPayload) => undefined) }
  const calibration = {
    insert: vi.fn(async () => undefined),
  }
  const svc = new ReviewService(
    shipments as unknown as ShipmentRepository,
    bookings as unknown as BookingRepository,
    locks as unknown as FieldLockRepository,
    audit as unknown as AuditRepository,
    queueLearning as unknown as QueueLearningClient,
    calibration as unknown as CriticCalibrationRepository,
  )
  return { svc, shipments, bookings, locks, audit, queueLearning, calibration }
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

  it('correct rejects unknown field names with 400 (no SQL explode)', async () => {
    const { svc, shipments } = makeService()
    await expect(svc.correct('leg-1', { fields: { notAColumn: 'x' } }, 'user-1')).rejects.toBeInstanceOf(
      BadRequestException,
    )
    expect(shipments.updateLeg).not.toHaveBeenCalled()
  })

  it('correct rejects a negative quantity with 400 and writes nothing', async () => {
    const { svc, shipments } = makeService()
    await expect(svc.correct('leg-1', { fields: { qty: '-10' } }, 'user-1')).rejects.toBeInstanceOf(
      BadRequestException,
    )
    expect(shipments.updateLeg).not.toHaveBeenCalled()
  })

  it('correct applies multi-field critic resolution including port/forwarder raw columns', async () => {
    const { svc, shipments, locks } = makeService()
    const res = await svc.correct(
      'leg-1',
      {
        fields: {
          eta: '2026-08-01',
          soNo: 'SO-NEW',
          polRaw: 'CNSHK',
          forwarderRaw: 'SEH',
          // customerRaw/vendorRaw are the Mesh-lag party stand-ins — correctable when no master resolves.
          customerRaw: 'OTCX',
          vendorRaw: 'SOUOCE',
          mode: 'SEA',
        },
        reason: 'resolve all conflicts',
      },
      'user-1',
    )
    expect(res.reviewStatus).toBe('confirmed')
    expect(res.corrected).toEqual(
      expect.arrayContaining(['eta', 'soNo', 'polRaw', 'forwarderRaw', 'customerRaw', 'vendorRaw', 'mode']),
    )
    expect(shipments.updateLeg).toHaveBeenCalled()
    expect(locks.lock.mock.calls.length).toBe(7)
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

describe('ReviewService — Phase 3 critic calibration capture', () => {
  const criticHigh = {
    confidence: { score: 90, band: 'high', label: 'High' },
    summary: 'ok', observations: [], priorState: { headline: '', fields: [] },
    proposedChanges: [], riskFlags: [], recommendedHumanAction: 'approve_ok', reasons: [],
  }

  it('confirm → approved / 0 fields / band snapshot', async () => {
    const { svc, calibration } = makeService({ criticReview: criticHigh })
    await svc.confirm('leg-1', 'user-1')
    expect(calibration.insert).toHaveBeenCalledWith(expect.objectContaining({
      shipmentId: 'leg-1',
      band: 'high',
      outcome: 'approved',
      correctedFieldCount: 0,
      actorId: 'user-1',
    }))
  })

  it('correct → corrected + field count', async () => {
    const { svc, calibration } = makeService({ criticReview: criticHigh })
    await svc.correct('leg-1', { fields: { soNo: 'X', bookingNo: 'Y' } }, 'user-1')
    expect(calibration.insert).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'corrected',
      correctedFieldCount: 2,
      band: 'high',
    }))
  })

  it('dismiss → dismissed; actor + band', async () => {
    const { svc, calibration } = makeService({
      kind: 'SHIPMENT', reviewStatus: 'provisional', dismissedAt: null, criticReview: criticHigh,
    })
    await svc.dismiss(['leg-1'], 'user-1', 'portal noise')
    expect(calibration.insert).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'dismissed',
      correctedFieldCount: 0,
      band: 'high',
      actorId: 'user-1',
    }))
  })

  it('legacy leg (no criticReview) → band null', async () => {
    const { svc, calibration } = makeService({ criticReview: null })
    await svc.confirm('leg-1', 'user-1')
    expect(calibration.insert).toHaveBeenCalledWith(expect.objectContaining({
      band: null,
      outcome: 'approved',
    }))
  })

  it('calibration insert throw does NOT fail confirm', async () => {
    const { svc, calibration, shipments } = makeService({ criticReview: criticHigh })
    calibration.insert.mockRejectedValueOnce(new Error('db down'))
    await expect(svc.confirm('leg-1', 'user-1')).resolves.toMatchObject({ reviewStatus: 'confirmed' })
    expect(shipments.updateLeg).toHaveBeenCalled()
  })
})

describe('identify — typed strong ID on a zero-identity leg', () => {
  it('key exists on exactly one other leg → returns a link candidate, writes NOTHING', async () => {
    const { svc, shipments, bookings } = makeService({ id: 'SRC', matchKeys: {} })
    shipments.candidateLegs.mockResolvedValue([
      { id: 'TARGET', bookingId: 'B9', matchKeys: { booking_no: 'BX845666' } },
    ])
    bookings.findById.mockResolvedValue({ jobNo: 'JOB-2026-0017' })
    const r = await svc.identify('SRC', { field: 'booking_no', value: 'BX845666' }, 'user-1')
    expect(r).toEqual({
      outcome: 'candidate',
      candidate: { shipmentId: 'TARGET', jobNo: 'JOB-2026-0017', matchedValue: 'BX845666' },
    })
    expect(shipments.updateLeg).not.toHaveBeenCalled()
  })

  it('key exists nowhere → sets the field like a correction (write + lock + audit + learning + key sync), leg STAYS provisional', async () => {
    const { svc, shipments } = makeService({ id: 'SRC', matchKeys: {} })
    shipments.candidateLegs.mockResolvedValue([])
    const r = await svc.identify('SRC', { field: 'booking_no', value: 'BXNEW1' }, 'user-1')
    expect(r).toEqual({ outcome: 'set', field: 'booking_no', value: 'BXNEW1' })
    expect(shipments.updateLeg).toHaveBeenCalledWith('SRC', { bookingNo: 'BXNEW1' })
    // must NOT confirm the leg — the operator still reviews the rest
    expect(shipments.updateLeg).not.toHaveBeenCalledWith('SRC', expect.objectContaining({ reviewStatus: 'confirmed' }))
  })

  it('key exists on several legs → ambiguous, no link offered', async () => {
    const { svc, shipments } = makeService({ id: 'SRC', matchKeys: {} })
    shipments.candidateLegs.mockResolvedValue([
      { id: 'T1', bookingId: 'B1', matchKeys: { booking_no: 'BX845666' } },
      { id: 'T2', bookingId: 'B2', matchKeys: { booking_no: 'BX845666' } },
    ])
    const r = await svc.identify('SRC', { field: 'booking_no', value: 'BX845666' }, 'user-1')
    expect(r).toEqual({ outcome: 'ambiguous', count: 2 })
    expect(shipments.updateLeg).not.toHaveBeenCalled()
  })

  it('normalizes booking revisions before lookup (BX845666 REV2 finds BX845666)', async () => {
    const { svc, shipments } = makeService({ id: 'SRC', matchKeys: {} })
    shipments.candidateLegs.mockResolvedValue([])
    await svc.identify('SRC', { field: 'booking_no', value: 'BX845666 REV2' }, 'user-1')
    expect(shipments.candidateLegs).toHaveBeenCalledWith(
      [{ type: 'booking_no', value: normBookingKey('BX845666 REV2') }],
      [],
    )
  })
})

describe('link — fold a zero-identity provisional leg into an existing shipment', () => {
  const zeroIdSource = {
    id: 'SRC',
    kind: 'SHIPMENT',
    reviewStatus: 'provisional',
    dismissedAt: null,
    matchKeys: { conversation_id: 'CONV-1' },
  }

  it('happy path: copies POs+emails, stamps linkedShipmentId+dismissedAt, audits both sides, calibrates corrected', async () => {
    const { svc, shipments, audit, calibration } = makeService()
    shipments.findById.mockImplementation(async (id: string) => {
      if (id === 'SRC') return { ...zeroIdSource }
      if (id === 'TARGET') return { id: 'TARGET', kind: 'SHIPMENT', matchKeys: { booking_no: 'BX1' } }
      return null
    })
    const r = await svc.link('SRC', { targetShipmentId: 'TARGET' }, 'user-1')
    expect(r).toEqual({ ok: true, targetShipmentId: 'TARGET' })
    expect(shipments.linkProvisionalLeg).toHaveBeenCalledWith('SRC', 'TARGET')
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({
      entityId: 'SRC', newValue: 'linked:TARGET', note: 'review: linked into existing shipment',
    }))
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({
      entityId: 'TARGET', newValue: 'absorbed:SRC',
    }))
    // calibration outcome MUST be 'corrected' (0014 CHECK); linked-ness goes in reasons
    expect(calibration.insert).toHaveBeenCalledWith(expect.objectContaining({
      shipmentId: 'SRC',
      outcome: 'corrected',
      correctedFieldCount: 0,
      reasons: ['linked-into-existing'],
    }))
  })

  it('link allows a STRONG-keyed provisional that SHARES a strong key with the target (duplicate fold)', async () => {
    const { svc, shipments } = makeService()
    shipments.findById.mockImplementation(async (id: string) => {
      if (id === 'SRC') return {
        ...zeroIdSource,
        matchKeys: { booking_no: 'BX1', so_no: 'GHOST-REF' },
      }
      if (id === 'TARGET') return {
        id: 'TARGET',
        kind: 'SHIPMENT',
        matchKeys: { booking_no: 'BX1', so_no: 'REAL' },
      }
      return null
    })
    const r = await svc.link('SRC', { targetShipmentId: 'TARGET' }, 'user-1')
    expect(r).toEqual({ ok: true, targetShipmentId: 'TARGET' })
    expect(shipments.linkProvisionalLeg).toHaveBeenCalledWith('SRC', 'TARGET')
  })

  it('link still rejects a strong-keyed provisional with NO shared strong key (not a duplicate — a different shipment)', async () => {
    const { svc, shipments } = makeService()
    shipments.findById.mockImplementation(async (id: string) => {
      if (id === 'SRC') return { ...zeroIdSource, matchKeys: { booking_no: 'BX9' } }
      if (id === 'TARGET') return { id: 'TARGET', kind: 'SHIPMENT', matchKeys: { booking_no: 'BX1' } }
      return null
    })
    await expect(svc.link('SRC', { targetShipmentId: 'TARGET' }, 'user-1')).rejects.toThrow(/identity|duplicate/)
    expect(shipments.linkProvisionalLeg).not.toHaveBeenCalled()
  })

  it('rejects self-link and missing target', async () => {
    const { svc, shipments } = makeService()
    shipments.findById.mockImplementation(async (id: string) => {
      if (id === 'SRC') return { ...zeroIdSource }
      return null
    })
    await expect(svc.link('SRC', { targetShipmentId: 'SRC' }, 'user-1')).rejects.toThrow()
    await expect(svc.link('SRC', { targetShipmentId: 'TARGET' }, 'user-1')).rejects.toBeInstanceOf(NotFoundException)
    expect(shipments.linkProvisionalLeg).not.toHaveBeenCalled()
  })

  it('rejects non-provisional / dismissed / non-SHIPMENT sources', async () => {
    const { svc, shipments } = makeService()
    shipments.findById.mockResolvedValueOnce({ ...zeroIdSource, reviewStatus: 'confirmed' })
    await expect(svc.link('SRC', { targetShipmentId: 'TARGET' }, 'user-1')).rejects.toBeInstanceOf(BadRequestException)
  })
})
