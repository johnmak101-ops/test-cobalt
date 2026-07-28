import { describe, it, expect, vi } from 'vitest'
import { PartyRelinkService } from './party-relink.service'
import type { ShipmentRepository } from '../db/repositories/shipment.repository'
import type { BookingRepository } from '../db/repositories/booking.repository'
import type { MastersRepository } from '../db/repositories/masters.repository'
import type { AuditRepository } from '../db/repositories/audit.repository'

type Row = Record<string, unknown>

function harness(rows: Row[], exact: { vendor?: string | null; customer?: string | null; forwarder?: string | null } = {}) {
  const shipments = {
    legsWithUnlinkedRawParties: vi.fn(async () => rows),
    updateLeg: vi.fn(async () => undefined),
  }
  const bookings = { update: vi.fn(async () => undefined) }
  const masters = {
    vendorIdExact: vi.fn(async () => exact.vendor ?? null),
    customerIdExact: vi.fn(async () => exact.customer ?? null),
    forwarderIdExact: vi.fn(async () => exact.forwarder ?? null),
  }
  const audit = { write: vi.fn(async () => undefined) }
  const svc = new PartyRelinkService(
    shipments as unknown as ShipmentRepository,
    bookings as unknown as BookingRepository,
    masters as unknown as MastersRepository,
    audit as unknown as AuditRepository,
  )
  return { svc, shipments, bookings, masters, audit }
}

/**
 * The situation: `vendor_raw = "MACAU FUNG TAI LIMITED"`, a Mesh vendor of exactly that name, and a
 * NULL `bookings.vendor_id` — so the shipment page asked an operator to open the field and pick a
 * master spelled identically to the value already on screen. Nothing here decides anything; it fills
 * a foreign key whose answer the raw name already gives exactly.
 */
describe('PartyRelinkService — fill the FK a raw name already answers exactly', () => {
  it('links the booking vendor and audits it as a system lookup, leaving the raw value alone', async () => {
    const { svc, bookings, shipments, audit } = harness(
      [{ id: 'leg-1', bookingId: 'bk-1', vendorRaw: 'MACAU FUNG TAI LIMITED', bookingVendorId: null }],
      { vendor: 'vendor-9' },
    )
    const res = await svc.relinkAll()
    expect(res.linked.vendor).toBe(1)
    expect(bookings.update).toHaveBeenCalledWith('bk-1', { vendorId: 'vendor-9' })
    // The parsed value is evidence, not something to tidy — only the null FK moves.
    const legPatches = shipments.updateLeg.mock.calls as unknown as unknown[][]
    expect(legPatches.some((c) => 'vendorRaw' in ((c[1] ?? {}) as Row))).toBe(false)
    const row = (audit.write.mock.calls as unknown as unknown[][]).map((c) => c[0] as Row)[0]
    expect(row).toMatchObject({ field: 'vendorId', newValue: 'vendor-9', sourceType: 'system' })
    expect(String(row?.note)).toMatch(/exact raw name/i)
  })

  it('no exact master → nothing is linked, and the miss keeps its advice line', async () => {
    const { svc, bookings, audit } = harness(
      [{ id: 'leg-1', bookingId: 'bk-1', vendorRaw: 'LEADWAY EXPRESS', bookingVendorId: null }],
      { vendor: null },
    )
    const res = await svc.relinkAll()
    expect(res.linked.vendor).toBe(0)
    expect(bookings.update).not.toHaveBeenCalled()
    expect(audit.write).not.toHaveBeenCalled()
  })

  it('a leg naming both parties gets ONE booking patch, not two', async () => {
    const { svc, bookings } = harness(
      [
        {
          id: 'leg-1',
          bookingId: 'bk-1',
          vendorRaw: 'MACAU FUNG TAI LIMITED',
          customerRaw: 'WYSE LONDON LIMITED',
          bookingVendorId: null,
          bookingCustomerId: null,
        },
      ],
      { vendor: 'vendor-9', customer: 'cust-3' },
    )
    await svc.relinkAll()
    expect(bookings.update).toHaveBeenCalledTimes(1)
    expect(bookings.update).toHaveBeenCalledWith('bk-1', { vendorId: 'vendor-9', customerId: 'cust-3' })
  })

  it('an already-linked slot is left alone — the sweep never re-points a live FK', async () => {
    const { svc, bookings, masters } = harness(
      [{ id: 'leg-1', bookingId: 'bk-1', vendorRaw: 'MACAU FUNG TAI LIMITED', bookingVendorId: 'vendor-EXISTING' }],
      { vendor: 'vendor-9' },
    )
    await svc.relinkAll()
    expect(masters.vendorIdExact).not.toHaveBeenCalled()
    expect(bookings.update).not.toHaveBeenCalled()
  })

  it('the forwarder FK lives on the LEG, so it is patched there', async () => {
    const { svc, shipments, bookings } = harness(
      [{ id: 'leg-1', bookingId: 'bk-1', forwarderRaw: 'LOGIMARK', forwarderId: null }],
      { forwarder: 'fwd-4' },
    )
    const res = await svc.relinkAll()
    expect(res.linked.forwarder).toBe(1)
    expect(shipments.updateLeg).toHaveBeenCalledWith('leg-1', { forwarderId: 'fwd-4' })
    expect(bookings.update).not.toHaveBeenCalled()
  })
})
