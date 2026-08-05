import { describe, it, expect, vi } from 'vitest'
import { BadRequestException } from '@nestjs/common'
import { ShipmentsService } from './shipments.service'
import type { ShipmentRepository } from '../db/repositories/shipment.repository'
import type { BookingRepository } from '../db/repositories/booking.repository'
import type { FieldLockRepository } from '../db/repositories/field-lock.repository'
import type { AuditRepository } from '../db/repositories/audit.repository'
import type { CommitterService } from '../reconcile/committer.service'
import type { QueueLearningClient, CorrectionPayload } from '../review/queue-learning.client'
import type { MastersRepository } from '../db/repositories/masters.repository'
import type { PriorCorrectionService } from '../review/prior-correction.service'

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
  const fieldLocks = {
    lock: vi.fn(async () => undefined),
    forEntity: vi.fn(async (): Promise<Array<Record<string, unknown>>> => []),
  }
  const audit = { write: vi.fn(async () => undefined) }
  const committer = {
    apply: vi.fn(async () => ({ shipmentId: 'new-leg', jobNo: 'J1', state: 'provisional', action: 'created' })),
  }
  const queueLearning = { postCorrection: vi.fn(async (_p: CorrectionPayload) => undefined) }
  // The prior_correction writer is injected so a unit test never reaches master_resolution. Tests that
  // assert ON it pass their own spy; the rest inject silence.
  const priorCorrections = { recordFromLegEdit: vi.fn(async () => 'skipped' as const), recordFromExtraction: vi.fn(async () => undefined) }
  const masters = {
    portIdByUnlocode: vi.fn(async (): Promise<string | null> => null),
    vendorIdExact: vi.fn(async (): Promise<string | null> => null),
    customerIdExact: vi.fn(async (): Promise<string | null> => null),
    forwarderIdExact: vi.fn(async (): Promise<string | null> => null),
  }
  const bookings = { update: vi.fn(async () => undefined) }
  const svc = new ShipmentsService(
    shipments as unknown as ShipmentRepository,
    bookings as unknown as BookingRepository,
    fieldLocks as unknown as FieldLockRepository,
    audit as unknown as AuditRepository,
    committer as unknown as CommitterService,
    queueLearning as unknown as QueueLearningClient,
    masters as unknown as MastersRepository,
    priorCorrections as unknown as PriorCorrectionService,
  )
  return { svc, shipments, bookings, fieldLocks, audit, committer, queueLearning, masters }
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

describe('ShipmentsService.editFields — POL/POD edits re-resolve the port master (route follows)', () => {
  it('sets polId when the edited POL is a known UN/LOCODE', async () => {
    const { svc, shipments, masters } = makeService()
    masters.portIdByUnlocode.mockResolvedValueOnce('port-hkg')
    await svc.editFields('leg-1', { polRaw: 'HKHKG' }, 'user-1', 'moved to HK')
    expect(masters.portIdByUnlocode).toHaveBeenCalledWith('HKHKG')
    expect(shipments.updateLeg).toHaveBeenCalledWith(
      'leg-1',
      expect.objectContaining({ polRaw: 'HKHKG', polId: 'port-hkg' }),
    )
  })

  it('clears podId when the edited POD is free text with no master match', async () => {
    const { svc, shipments, masters } = makeService({ podRaw: 'JPOSA', podId: 'port-osa' })
    masters.portIdByUnlocode.mockResolvedValueOnce(null)
    await svc.editFields('leg-1', { podRaw: 'Shekou Wharf 3' }, 'user-1', 'free-text pod')
    expect(shipments.updateLeg).toHaveBeenCalledWith(
      'leg-1',
      expect.objectContaining({ podRaw: 'Shekou Wharf 3', podId: null }),
    )
  })

  it('clears the port FK when the raw value is cleared', async () => {
    const { svc, shipments, masters } = makeService({ polRaw: 'CNSHK', polId: 'port-shk' })
    await svc.editFields('leg-1', { polRaw: '' }, 'user-1', 'wrong port removed')
    expect(masters.portIdByUnlocode).not.toHaveBeenCalled()
    expect(shipments.updateLeg).toHaveBeenCalledWith(
      'leg-1',
      expect.objectContaining({ polRaw: null, polId: null }),
    )
  })
})

describe('ShipmentsService.editFields — party edits re-resolve the master FK (display follows)', () => {
  it('sets the booking vendor FK when the edited vendor resolves to a master', async () => {
    const { svc, bookings, masters } = makeService({ bookingId: 'bk-1', vendorRaw: 'SOUOCE' })
    masters.vendorIdExact.mockResolvedValueOnce('v-rose')
    await svc.editFields('leg-1', { vendorRaw: 'ROSE KNITTING FACTORY LIMITED' }, 'user-1', 'correct vendor')
    expect(masters.vendorIdExact).toHaveBeenCalledWith('ROSE KNITTING FACTORY LIMITED')
    expect(bookings.update).toHaveBeenCalledWith('bk-1', { vendorId: 'v-rose' })
  })

  it('unlinks the booking vendor FK when the edited vendor matches no master (raw drives display)', async () => {
    const { svc, bookings, masters } = makeService({ bookingId: 'bk-1', vendorRaw: 'SOUOCE' })
    masters.vendorIdExact.mockResolvedValueOnce(null)
    await svc.editFields('leg-1', { vendorRaw: 'BRAND NEW KNITTERS LTD' }, 'user-1', 'not in Mesh yet')
    expect(bookings.update).toHaveBeenCalledWith('bk-1', { vendorId: null })
  })

  it('sets the booking customer FK for customer edits', async () => {
    const { svc, bookings, masters } = makeService({ bookingId: 'bk-1', customerRaw: 'WYSE' })
    masters.customerIdExact.mockResolvedValueOnce('c-docc')
    await svc.editFields('leg-1', { customerRaw: 'DOCLASSE CO., LTD.' }, 'user-1', 'correct customer')
    expect(masters.customerIdExact).toHaveBeenCalledWith('DOCLASSE CO., LTD.')
    expect(bookings.update).toHaveBeenCalledWith('bk-1', { customerId: 'c-docc' })
  })

  it('re-links the leg forwarder FK inside the same leg patch', async () => {
    const { svc, shipments, masters } = makeService({ forwarderRaw: 'FWD', forwarderId: 'f-old' })
    masters.forwarderIdExact.mockResolvedValueOnce('f-logi')
    await svc.editFields('leg-1', { forwarderRaw: 'LOGIMARK' }, 'user-1', 'correct forwarder')
    expect(shipments.updateLeg).toHaveBeenCalledWith(
      'leg-1',
      expect.objectContaining({ forwarderRaw: 'LOGIMARK', forwarderId: 'f-logi' }),
    )
  })

  it('skips the booking write when the leg has no booking', async () => {
    const { svc, bookings, masters } = makeService({ bookingId: null, vendorRaw: 'SOUOCE' })
    masters.vendorIdExact.mockResolvedValueOnce(null)
    await svc.editFields('leg-1', { vendorRaw: 'ROSE KNITTING FACTORY LIMITED' }, 'user-1', 'no booking')
    expect(bookings.update).not.toHaveBeenCalled()
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

describe('ShipmentsService.lockedFields — human-locked columns for the detail DTO', () => {
  it('returns shipment-scope lock fields only', async () => {
    const { svc, fieldLocks } = makeService()
    fieldLocks.forEntity.mockResolvedValueOnce([
      { entityType: 'shipment', field: 'eta' },
      { entityType: 'shipment', field: 'vendorRaw' },
      { entityType: 'booking', field: 'qty' },
    ])
    await expect(svc.lockedFields('leg-1')).resolves.toEqual(['eta', 'vendorRaw'])
  })
})
