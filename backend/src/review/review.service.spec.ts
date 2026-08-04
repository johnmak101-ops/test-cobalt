import { describe, it, expect, vi } from 'vitest'
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { CORRECTABLE_COLUMNS, ReviewService } from './review.service'
import type { ShipmentRepository } from '../db/repositories/shipment.repository'
import type { BookingRepository } from '../db/repositories/booking.repository'
import type { FieldLockRepository } from '../db/repositories/field-lock.repository'
import type { AuditRepository } from '../db/repositories/audit.repository'
import type { CriticCalibrationRepository } from '../db/repositories/critic-calibration.repository'
import type { MastersRepository } from '../db/repositories/masters.repository'
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
    sourceGraphIdFor: vi.fn(async (_id: string): Promise<string | null> => 'graph-1'),
    candidateLegs: vi.fn(async () => [] as Record<string, unknown>[]),
    linkProvisionalLeg: vi.fn(async () => undefined),
  }
  const bookings = {
    findById: vi.fn(async () => null as { jobNo: string } | null),
    update: vi.fn(async () => undefined),
  }
  const locks = { lock: vi.fn(async () => undefined) }
  const audit = { write: vi.fn(async () => undefined) }
  const queueLearning = { postCorrection: vi.fn(async (_payload: CorrectionPayload) => undefined) }
  const calibration = {
    insert: vi.fn(async () => undefined),
  }
  const masters = {
    portIdByUnlocode: vi.fn(async (): Promise<string | null> => null),
    vendorIdExact: vi.fn(async (): Promise<string | null> => null),
    customerIdExact: vi.fn(async (): Promise<string | null> => null),
    forwarderIdExact: vi.fn(async (): Promise<string | null> => null),
  }
  const svc = new ReviewService(
    shipments as unknown as ShipmentRepository,
    bookings as unknown as BookingRepository,
    locks as unknown as FieldLockRepository,
    audit as unknown as AuditRepository,
    queueLearning as unknown as QueueLearningClient,
    calibration as unknown as CriticCalibrationRepository,
    masters as unknown as MastersRepository,
  )
  return { svc, shipments, bookings, locks, audit, queueLearning, calibration, masters }
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

describe('ReviewService.correct — coercion + field locks', () => {
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
      // 'review', not 'manual': the history has to say WHERE the human acted — a Review Queue
      // decision is not an Order Details edit.
      expect.objectContaining({ field: 'etd', note: 'ETD was the CFS date', sourceType: 'review' }),
    )
  })

  it('pushes each corrected field to the queue learning feed (old→new, keyed by the source email)', async () => {
    const { svc, queueLearning } = makeService()
    await svc.correct('leg-1', { fields: { etd: '2026-07-12' }, reason: 'ETD was the CFS date' }, 'user-1')
    expect(queueLearning.postCorrection).toHaveBeenCalledWith(expect.objectContaining({
      // A DATE goes out in the parser's own format. This assertion used to demand
      // '2026-07-12T00:00:00.000Z' — the ISO instant toStr produced — which pinned the defect in place:
      // the queue scores by comparing this string against a re-parse, and no parse ever emits an ISO
      // instant, so every date correction was fuel that could not burn (see queue-field-value.ts).
      messageId: 'graph-1', field: 'etd', agentSaid: null, humanCorrected: '2026-07-12', note: 'ETD was the CFS date',
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

  it('posts the five *Raw party/port columns under the PARSER names (pol, not pol_raw)', async () => {
    // A plain camel→snake gave pol_raw / forwarder_raw / … — field names the parser never emits, so the
    // queue's re-parse could never reproduce them: fuel that could not burn. The alias map speaks parser.
    const cases: [string, string][] = [
      ['polRaw', 'pol'],
      ['podRaw', 'pod'],
      ['forwarderRaw', 'forwarder_name'],
      ['customerRaw', 'customer_code'],
      ['vendorRaw', 'vendor_code'],
    ]
    for (const [column, queueField] of cases) {
      const { svc, queueLearning } = makeService({ [column]: 'OLD' })
      await svc.correct('leg-1', { fields: { [column]: 'NEW' }, reason: 'fix party' }, 'user-1')
      expect(queueLearning.postCorrection).toHaveBeenCalledWith(expect.objectContaining({
        field: queueField, humanCorrected: 'NEW', kind: 'correction',
      }))
    }
  })
})

describe('ReviewService.correct — party/port corrections re-resolve the master FK (display follows)', () => {
  it('sets the booking vendor FK when the corrected vendor resolves to a master', async () => {
    const { svc, bookings, masters } = makeService({ bookingId: 'bk-1', vendorRaw: 'SOUOCE' })
    masters.vendorIdExact.mockResolvedValueOnce('v-rose')
    await svc.correct(
      'leg-1',
      { fields: { vendorRaw: 'ROSE KNITTING FACTORY LIMITED' }, reason: 'this is the correct one' },
      'user-1',
    )
    expect(masters.vendorIdExact).toHaveBeenCalledWith('ROSE KNITTING FACTORY LIMITED')
    expect(bookings.update).toHaveBeenCalledWith('bk-1', { vendorId: 'v-rose' })
  })

  it('unlinks the booking vendor FK when the corrected vendor matches no master', async () => {
    const { svc, bookings, masters } = makeService({ bookingId: 'bk-1', vendorRaw: 'SOUOCE' })
    masters.vendorIdExact.mockResolvedValueOnce(null)
    await svc.correct('leg-1', { fields: { vendorRaw: 'BRAND NEW KNITTERS LTD' } }, 'user-1')
    expect(bookings.update).toHaveBeenCalledWith('bk-1', { vendorId: null })
  })

  it('sets the booking customer FK for customer corrections', async () => {
    const { svc, bookings, masters } = makeService({ bookingId: 'bk-1', customerRaw: 'WYSE' })
    masters.customerIdExact.mockResolvedValueOnce('c-docc')
    await svc.correct('leg-1', { fields: { customerRaw: 'DOCLASSE CO., LTD.' } }, 'user-1')
    expect(bookings.update).toHaveBeenCalledWith('bk-1', { customerId: 'c-docc' })
  })

  it('re-links the leg forwarder FK inside the same leg patch', async () => {
    const { svc, shipments, masters } = makeService({ forwarderRaw: 'FWD', forwarderId: 'f-old' })
    masters.forwarderIdExact.mockResolvedValueOnce('f-logi')
    await svc.correct('leg-1', { fields: { forwarderRaw: 'LOGIMARK' } }, 'user-1')
    expect(shipments.updateLeg).toHaveBeenCalledWith(
      'leg-1',
      expect.objectContaining({ forwarderRaw: 'LOGIMARK', forwarderId: 'f-logi' }),
    )
  })

  it('re-resolves the port FK on review POL corrections (same as the detail-edit fix)', async () => {
    const { svc, shipments, masters } = makeService({ polRaw: 'JPOSA', polId: 'port-osa' })
    masters.portIdByUnlocode.mockResolvedValueOnce('port-hkg')
    await svc.correct('leg-1', { fields: { polRaw: 'HKHKG' } }, 'user-1')
    expect(shipments.updateLeg).toHaveBeenCalledWith(
      'leg-1',
      expect.objectContaining({ polRaw: 'HKHKG', polId: 'port-hkg' }),
    )
  })

  it('skips the booking write when the leg has no booking', async () => {
    const { svc, bookings, masters } = makeService({ bookingId: null, vendorRaw: 'SOUOCE' })
    masters.vendorIdExact.mockResolvedValueOnce(null)
    await svc.correct('leg-1', { fields: { vendorRaw: 'ROSE KNITTING FACTORY LIMITED' } }, 'user-1')
    expect(bookings.update).not.toHaveBeenCalled()
  })
})

/**
 * "Confirmed as-is" is a decision FOR the raw value, so the master link must follow it. This is the
 * only branch that can close the stale-FK gap: keeping the current value writes no field, so it
 * never reaches correctField's re-resolve. Leg 20260405F1 sat with vendor_raw ELSMCO under
 * booking.vendor_id SOUOCE — Order Details printed SOUOCE, the desk read ELSMCO, and no click the
 * operator had could reconcile them.
 */
describe('ReviewService.confirm — re-links the party master to the raw the leg names', () => {
  it('re-points the booking vendor FK when the raw resolves elsewhere', async () => {
    const { svc, bookings, masters } = makeService({ bookingId: 'bk-1', vendorRaw: 'ELSMCO' })
    bookings.findById.mockResolvedValue({ id: 'bk-1', vendorId: 'v-souoce' } as never)
    masters.vendorIdExact.mockResolvedValueOnce('v-elsmco')
    await svc.confirm('leg-1', 'user-1')
    expect(bookings.update).toHaveBeenCalledWith('bk-1', { vendorId: 'v-elsmco' })
  })

  it('UNLINKS rather than leaving a master the leg does not name', async () => {
    const { svc, bookings, masters } = makeService({ bookingId: 'bk-1', vendorRaw: 'BRAND NEW LTD' })
    bookings.findById.mockResolvedValue({ id: 'bk-1', vendorId: 'v-souoce' } as never)
    masters.vendorIdExact.mockResolvedValueOnce(null)
    await svc.confirm('leg-1', 'user-1')
    expect(bookings.update).toHaveBeenCalledWith('bk-1', { vendorId: null })
  })

  it('writes nothing when the link already agrees with the raw', async () => {
    const { svc, bookings, masters } = makeService({ bookingId: 'bk-1', vendorRaw: 'SOUOCE' })
    bookings.findById.mockResolvedValue({ id: 'bk-1', vendorId: 'v-souoce' } as never)
    masters.vendorIdExact.mockResolvedValueOnce('v-souoce')
    await svc.confirm('leg-1', 'user-1')
    expect(bookings.update).not.toHaveBeenCalled()
  })

  it('leaves the link alone when the leg names no party at all', async () => {
    const { svc, bookings, masters } = makeService({ bookingId: 'bk-1', vendorRaw: null })
    bookings.findById.mockResolvedValue({ id: 'bk-1', vendorId: 'v-souoce' } as never)
    await svc.confirm('leg-1', 'user-1')
    expect(masters.vendorIdExact).not.toHaveBeenCalled()
    expect(bookings.update).not.toHaveBeenCalled()
  })
})

describe('ReviewService — skip queue learning when sourceGraphIdFor is null (#236 P2)', () => {
  it('confirm: does NOT call postCorrection (never uses shipment UUID as messageId); still confirms the leg', async () => {
    const { svc, shipments, queueLearning } = makeService({ soNo: 'COSU123', grossWeight: 5 })
    shipments.sourceGraphIdFor.mockResolvedValue(null)
    const res = await svc.confirm('leg-1', 'user-1')
    // `kept` is always present, empty when nothing was ruled — see the keep-rulings block below.
    expect(res).toEqual({ shipmentId: 'leg-1', reviewStatus: 'confirmed', kept: [] })
    expect(queueLearning.postCorrection).not.toHaveBeenCalled()
    expect(shipments.updateLeg).toHaveBeenCalledWith(
      'leg-1',
      expect.objectContaining({ reviewStatus: 'confirmed' }),
    )
  })

  it('correct: does NOT call postCorrection with shipment UUID; still writes fields + confirms', async () => {
    const { svc, shipments, queueLearning, locks } = makeService({ soNo: 'OLD' })
    shipments.sourceGraphIdFor.mockResolvedValue(null)
    const res = await svc.correct('leg-1', { fields: { soNo: 'FIXED-SO' }, reason: 'typo' }, 'user-1')
    expect(res.reviewStatus).toBe('confirmed')
    expect(res.corrected).toEqual(['soNo'])
    expect(queueLearning.postCorrection).not.toHaveBeenCalled()
    // Local review path still applies
    expect(shipments.updateLeg).toHaveBeenCalledWith('leg-1', { soNo: 'FIXED-SO' })
    expect(locks.lock).toHaveBeenCalled()
    // Guard: if anything ever did post, it must not be the leg id
    for (const call of queueLearning.postCorrection.mock.calls) {
      expect(call[0].messageId).not.toBe('leg-1')
    }
  })

  it('identify set path: skips learning when graph id is missing; still sets the field', async () => {
    const { svc, shipments, queueLearning } = makeService({ id: 'SRC', matchKeys: {} })
    shipments.candidateLegs.mockResolvedValue([])
    shipments.sourceGraphIdFor.mockResolvedValue(null)
    const r = await svc.identify('SRC', { field: 'booking_no', value: 'BXNEW1' }, 'user-1')
    expect(r).toEqual({ outcome: 'set', field: 'booking_no', value: 'BXNEW1' })
    expect(shipments.updateLeg).toHaveBeenCalledWith('SRC', { bookingNo: 'BXNEW1' })
    expect(queueLearning.postCorrection).not.toHaveBeenCalled()
  })

  it('link with fields: skips learning when graph id is missing; still folds', async () => {
    const { svc, shipments, queueLearning } = makeService()
    shipments.sourceGraphIdFor.mockResolvedValue(null)
    shipments.findById.mockImplementation(async (id: string) => {
      if (id === 'SRC') {
        return {
          id: 'SRC',
          kind: 'SHIPMENT',
          reviewStatus: 'provisional',
          dismissedAt: null,
          matchKeys: { conversation_id: 'CONV-1' },
          soNo: 'OLD',
        }
      }
      if (id === 'TARGET') return { id: 'TARGET', kind: 'SHIPMENT', matchKeys: { booking_no: 'BX1' }, soNo: null }
      return null
    })
    const r = await svc.link('SRC', { targetShipmentId: 'TARGET', fields: { soNo: 'FROM-SRC' } }, 'user-1')
    expect(r).toEqual({ ok: true, targetShipmentId: 'TARGET' })
    expect(shipments.linkProvisionalLeg).toHaveBeenCalledWith('SRC', 'TARGET')
    expect(queueLearning.postCorrection).not.toHaveBeenCalled()
  })

  it('correct: still posts with graph-1 when sourceGraphIdFor resolves', async () => {
    const { svc, queueLearning, shipments } = makeService({ soNo: 'OLD-SO' })
    expect(await shipments.sourceGraphIdFor('leg-1')).toBe('graph-1')
    await svc.correct('leg-1', { fields: { soNo: 'COSU123' }, reason: 'wrong SO' }, 'user-1')
    expect(queueLearning.postCorrection).toHaveBeenCalledWith(expect.objectContaining({
      messageId: 'graph-1', field: 'so_no', kind: 'correction',
    }))
  })
})

describe('ReviewService — "looks right" confirm-sentinels feed the queue eval', () => {
  it('confirm() emits a confirm-sentinel for each non-null parse field (agentSaid == humanCorrected == frozen value)', async () => {
    const { svc, queueLearning } = makeService({ soNo: 'COSU123', containerNo: 'MSCU1234567' })
    await svc.confirm('leg-1', 'user-1')
    expect(queueLearning.postCorrection).toHaveBeenCalledWith(expect.objectContaining({
      messageId: 'graph-1', field: 'so_no', agentSaid: 'COSU123', humanCorrected: 'COSU123', kind: 'confirm',
    }))
    expect(queueLearning.postCorrection).toHaveBeenCalledWith(expect.objectContaining({
      field: 'container_no', agentSaid: 'MSCU1234567', humanCorrected: 'MSCU1234567', kind: 'confirm',
    }))
  })

  it('confirm() NEVER emits the four desk-hidden columns — no blind endorsements of values the operator cannot see', async () => {
    const { svc, queueLearning } = makeService({
      soNo: 'COSU123', itemStyleNo: 'STYLE-1', grossWeight: 5, measurement: 12.5, htsCode: '6110.20',
    })
    await svc.confirm('leg-1', 'user-1')
    const calls = queueLearning.postCorrection.mock.calls.map((c) => c[0])
    expect(calls).toContainEqual(expect.objectContaining({ field: 'so_no', kind: 'confirm' }))
    for (const hidden of ['item_style_no', 'gross_weight', 'measurement', 'hts_code']) {
      expect(calls).not.toContainEqual(expect.objectContaining({ field: hidden, kind: 'confirm' }))
    }
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

  it('confirm() NEVER emits cfs_cutoff — the parser cannot reproduce it, a confirm would be a permanent phantom regression', async () => {
    const { svc, queueLearning } = makeService({ cfsCutoff: new Date('2026-02-10T00:00:00.000Z'), etd: new Date('2026-02-16T00:00:00.000Z') })
    await svc.confirm('leg-1', 'user-1')
    const calls = queueLearning.postCorrection.mock.calls.map((c) => c[0])
    expect(calls).toContainEqual(expect.objectContaining({ field: 'etd', kind: 'confirm' })) // the click still labels real parse fields
    expect(calls).not.toContainEqual(expect.objectContaining({ field: 'cfs_cutoff' }))
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

/**
 * Waiting: the desk's third outcome. Not "yes" (confirm) and not "no" (dismiss) — "I have to go and
 * ask", so the leg leaves the ACTIVE list without anyone vouching for its data.
 */
describe('wait — park a leg pending an outside answer', () => {
  it('stamps waiting_at + reason, audits, and vouches for nothing', async () => {
    const { svc, shipments, audit, calibration, queueLearning } = makeService({
      kind: 'SHIPMENT', reviewStatus: 'provisional', dismissedAt: null, waitingAt: null,
    })
    await expect(svc.wait('leg-1', 'user-1', '  asked the forwarder  ')).resolves.toEqual({
      shipmentId: 'leg-1', waiting: true,
    })
    expect(shipments.updateLeg).toHaveBeenCalledWith('leg-1', expect.objectContaining({
      waitingAt: expect.any(Date),
      waitingReason: 'asked the forwarder',
    }))
    // Stays provisional — parking is not an answer, so it must not enter alerts/automation.
    expect(shipments.updateLeg).not.toHaveBeenCalledWith('leg-1', expect.objectContaining({
      reviewStatus: 'confirmed',
    }))
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({
      newValue: 'waiting', note: 'review: parked as waiting — asked the forwarder',
    }))
    // No verdict yet → nothing to score the agent against, and no confirm-sentinels.
    expect(calibration.insert).not.toHaveBeenCalled()
    expect(queueLearning.postCorrection).not.toHaveBeenCalled()
  })

  it('blank reason parks with no reason rather than an empty string', async () => {
    const { svc, shipments } = makeService({ kind: 'SHIPMENT', dismissedAt: null, waitingAt: null })
    await svc.wait('leg-1', 'user-1', '   ')
    expect(shipments.updateLeg).toHaveBeenCalledWith('leg-1', expect.objectContaining({
      waitingReason: null,
    }))
  })

  it('missing leg → 404; non-shipment → 400', async () => {
    const { svc } = makeService(null)
    await expect(svc.wait('missing', 'user-1')).rejects.toBeInstanceOf(NotFoundException)
    const doc = makeService({ kind: 'DOCUMENT' })
    await expect(doc.svc.wait('leg-1', 'user-1')).rejects.toBeInstanceOf(BadRequestException)
  })

  it('already answered or already rejected → no-op, not an error', async () => {
    const confirmed = makeService({ kind: 'SHIPMENT', reviewStatus: 'confirmed' })
    await expect(confirmed.svc.wait('leg-1', 'user-1')).resolves.toEqual({ shipmentId: 'leg-1', waiting: false })
    expect(confirmed.shipments.updateLeg).not.toHaveBeenCalled()

    const dismissed = makeService({ kind: 'SHIPMENT', reviewStatus: 'provisional', dismissedAt: new Date() })
    await expect(dismissed.svc.wait('leg-1', 'user-1')).resolves.toEqual({ shipmentId: 'leg-1', waiting: false })
    expect(dismissed.shipments.updateLeg).not.toHaveBeenCalled()
  })

  it('confirm and dismiss both clear the stamp — a parked leg that gets answered is not still parked', async () => {
    const confirmed = makeService({ reviewStatus: 'provisional', waitingAt: new Date() })
    await confirmed.svc.confirm('leg-1', 'user-1')
    expect(confirmed.shipments.updateLeg).toHaveBeenCalledWith('leg-1', expect.objectContaining({
      reviewStatus: 'confirmed', waitingAt: null, waitingReason: null,
    }))

    const rejected = makeService({
      kind: 'SHIPMENT', reviewStatus: 'provisional', dismissedAt: null, waitingAt: new Date(),
    })
    await rejected.svc.dismiss(['leg-1'], 'user-1')
    expect(rejected.shipments.updateLeg).toHaveBeenCalledWith('leg-1', expect.objectContaining({
      dismissedAt: expect.any(Date), waitingAt: null, waitingReason: null,
    }))
  })
})

describe('restore — one reversal for both off-desk stamps', () => {
  it('un-parks a waiting leg', async () => {
    const { svc, shipments, audit } = makeService({ dismissedAt: null, waitingAt: new Date() })
    await expect(svc.restore('leg-1', 'user-1')).resolves.toEqual({ shipmentId: 'leg-1', restored: true })
    expect(shipments.updateLeg).toHaveBeenCalledWith('leg-1', { waitingAt: null, waitingReason: null })
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({ oldValue: 'waiting' }))
  })

  it('un-dismisses a rejected leg', async () => {
    const { svc, shipments, audit } = makeService({ dismissedAt: new Date(), waitingAt: null })
    await svc.restore('leg-1', 'user-1')
    expect(shipments.updateLeg).toHaveBeenCalledWith('leg-1', { dismissedAt: null })
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({ oldValue: 'dismissed' }))
  })

  it('clears BOTH when a leg was parked and then rejected', async () => {
    const { svc, shipments } = makeService({ dismissedAt: new Date(), waitingAt: new Date() })
    await svc.restore('leg-1', 'user-1')
    expect(shipments.updateLeg).toHaveBeenCalledWith('leg-1', {
      dismissedAt: null, waitingAt: null, waitingReason: null,
    })
  })

  it('neither stamp set → no write', async () => {
    const { svc, shipments } = makeService({ dismissedAt: null, waitingAt: null })
    await expect(svc.restore('leg-1', 'user-1')).resolves.toEqual({ shipmentId: 'leg-1', restored: false })
    expect(shipments.updateLeg).not.toHaveBeenCalled()
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

/**
 * The review form and the API allowlist live in different packages, so nothing but a test keeps them
 * honest. They drifted once already: `warehouseSo` got its own input on the form (2026-07-24, split
 * out of the shared SO# row) and this set was never widened, so typing in that box produced
 * "field not correctable: warehouseSo" — a 400 the queue page then reported through the SUCCESS
 * toast, green tick and all. The operator saw a tick over a save that never happened.
 *
 * The list below is the `column` of every entry in frontend/src/lib/review-fields.ts EDITABLE_FIELDS.
 * Its twin in review-fields.test.ts pins the same set from the other side, so ADDING a field to the
 * form fails there and REMOVING one from the allowlist fails here — the two directions this can break.
 */
const REVIEW_FORM_COLUMNS = [
  'bookingNo', 'soNo', 'warehouseSo',
  'qty', 'qtyUnit', 'containerNo', 'hblAwbFcrNo', 'mbl', 'mawb', 'scacCode',
  'mode', 'customerRaw', 'vendorRaw', 'forwarderRaw', 'consigneeName', 'consigneeAddress',
  'vesselName', 'voyageNo', 'flightNo', 'polRaw', 'podRaw',
  'cargoReadyDate', 'warehouseStartDate', 'warehouseEndDate', 'cfsCutoff',
  'etd', 'atd', 'eta', 'ata', 'inDcDate',
]

describe('CORRECTABLE_COLUMNS covers everything the review form can edit', () => {
  it('accepts every column EDITABLE_FIELDS renders an input for', () => {
    const missing = REVIEW_FORM_COLUMNS.filter((c) => !CORRECTABLE_COLUMNS.has(c))
    expect(missing).toEqual([])
  })

  it('correct() 400s on a column outside the set, naming it', async () => {
    const { svc } = makeService()
    await expect(
      svc.correct('leg-1', { fields: { notAColumn: 'x' } } as never, 'user-1'),
    ).rejects.toThrow(/field not correctable: notAColumn/)
  })

  /** The extras are deliberate, not oversight: measurement / gross weight / HTS were taken off Order
   *  Details, and itemStyleNo is per-PO on Customer Purchase Orders. Pinned so a future reader does
   *  not "tidy" them away and silently break the shipment-detail edit path that still writes them. */
  it('keeps the four columns edited elsewhere than the review form', () => {
    for (const c of ['grossWeight', 'measurement', 'htsCode', 'itemStyleNo']) {
      expect(CORRECTABLE_COLUMNS.has(c)).toBe(true)
    }
  })
})

/**
 * "Keep current" as a per-field DECISION: no value moves, but the ruling is recorded — the field is
 * locked at what the leg already holds and the act lands in Change History. Before this the desk had
 * no way to say it at all: a row resolved to the stored value contributed nothing to `fields`, so
 * the approve posted an empty set and the judgement evaporated.
 */
describe('ReviewService — keep rulings lock without writing', () => {
  it('confirm locks each kept field at the value the leg already holds', async () => {
    const { svc, locks, shipments, audit } = makeService({ vesselName: 'EVER GLORY', grossWeight: 5 })
    const res = await svc.confirm('leg-1', 'user-1', undefined, undefined, ['vesselName'])
    expect(res.kept).toEqual(['vesselName'])
    expect(locks.lock).toHaveBeenCalledWith('shipment', 'leg-1', 'vesselName', 'EVER GLORY', 'user-1')
    // The value is read off the LEG, never off the request — a keep that carried its own value would
    // be a write wearing a different name.
    // The repo fakes take no declared params, so their recorded calls are typed as empty tuples —
    // read them as plain arrays rather than widening every fake in the harness.
    const legPatches = shipments.updateLeg.mock.calls as unknown as unknown[][]
    const wroteVessel = legPatches.some(
      (c) => 'vesselName' in ((c[1] ?? {}) as Record<string, unknown>),
    )
    expect(wroteVessel).toBe(false)
    // old === new is the point: a ruling, not a change.
    const row = (audit.write.mock.calls as unknown as unknown[][])
      .map((c) => c[0] as Record<string, unknown>)
      .find((r) => r.field === 'vesselName')
    expect(row).toMatchObject({ oldValue: 'EVER GLORY', newValue: 'EVER GLORY', sourceType: 'review' })
    expect(String(row?.note)).toMatch(/kept the stored value/i)
  })

  it('an absent keep list locks nothing — the common path is untouched', async () => {
    const { svc, locks } = makeService({ vesselName: 'EVER GLORY' })
    const res = await svc.confirm('leg-1', 'user-1')
    expect(res.kept).toEqual([])
    expect(locks.lock).not.toHaveBeenCalled()
  })

  it('correct carries writes and rulings together, and keeps them apart', async () => {
    const { svc, locks } = makeService({ vesselName: 'EVER GLORY', eta: null })
    const res = await svc.correct(
      'leg-1',
      { fields: { eta: '2026-08-01' }, keep: ['vesselName'] },
      'user-1',
    )
    expect(res.corrected).toEqual(['eta'])
    expect(res.kept).toEqual(['vesselName'])
    expect(locks.lock).toHaveBeenCalledWith('shipment', 'leg-1', 'vesselName', 'EVER GLORY', 'user-1')
  })

  it('a field named as BOTH written and kept is a contradiction — 400, nothing written', async () => {
    const { svc, shipments, locks } = makeService({ vesselName: 'EVER GLORY' })
    await expect(
      svc.correct('leg-1', { fields: { vesselName: 'EVER GIVEN' }, keep: ['vesselName'] }, 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException)
    // Rejected in the same pre-flight as a bad value, so the leg is untouched.
    expect(shipments.updateLeg).not.toHaveBeenCalled()
    expect(locks.lock).not.toHaveBeenCalled()
  })

  it('an unknown column cannot be kept either — the allowlist is one allowlist', async () => {
    const { svc, locks } = makeService()
    await expect(svc.confirm('leg-1', 'user-1', undefined, undefined, ['notAColumn'])).rejects.toBeInstanceOf(
      BadRequestException,
    )
    expect(locks.lock).not.toHaveBeenCalled()
    expect([...CORRECTABLE_COLUMNS]).not.toContain('notAColumn')
  })
})
