import { Injectable, NotFoundException } from '@nestjs/common'
import { BookingRepository } from '../db/repositories/booking.repository'
import { ShipmentRepository } from '../db/repositories/shipment.repository'

@Injectable()
export class BookingsService {
  constructor(
    private readonly bookings: BookingRepository,
    private readonly shipments: ShipmentRepository,
  ) {}

  /** List bookings with their leg count + active mode/state, newest first. */
  async list() {
    const rows = await this.bookings.listOrdered()
    return Promise.all(
      rows.map(async (b) => {
        const legs = await this.shipments.legsForBooking(b.id)
        const active = legs.find((l) => l.legStatus === 'ACTIVE') ?? legs[legs.length - 1]
        return { ...b, legCount: legs.length, activeMode: active?.mode ?? null, activeState: active?.state ?? null }
      }),
    )
  }

  /** A booking with its POs and all legs under it. */
  async getOne(id: string) {
    const booking = await this.bookings.findById(id)
    if (!booking) throw new NotFoundException(`booking ${id} not found`)
    const legs = await this.shipments.legsForBooking(id)
    const pos = await this.bookings.posFor(id)
    return { ...booking, pos, legs }
  }
}
