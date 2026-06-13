import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { desc, eq } from 'drizzle-orm'
import * as schema from '@cobalt/contracts'
import { DRIZZLE, type DrizzleDB } from '../db/drizzle.provider'

@Injectable()
export class BookingsService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  /** List bookings with their leg count + active mode, newest first. */
  async list() {
    const rows = await this.db.select().from(schema.bookings).orderBy(desc(schema.bookings.createdAt))
    return Promise.all(
      rows.map(async (b) => {
        const legs = await this.db.select().from(schema.shipments).where(eq(schema.shipments.bookingId, b.id))
        const active = legs.find((l) => l.legStatus === 'ACTIVE') ?? legs[legs.length - 1]
        return { ...b, legCount: legs.length, activeMode: active?.mode ?? null, activeState: active?.state ?? null }
      }),
    )
  }

  /** A booking with its POs and all legs (superseded + active) under it. */
  async getOne(id: string) {
    const [booking] = await this.db.select().from(schema.bookings).where(eq(schema.bookings.id, id))
    if (!booking) throw new NotFoundException(`booking ${id} not found`)
    const legs = await this.db
      .select()
      .from(schema.shipments)
      .where(eq(schema.shipments.bookingId, id))
      .orderBy(schema.shipments.legNo)
    const poLinks = await this.db.select().from(schema.bookingPos).where(eq(schema.bookingPos.bookingId, id))
    const pos = (
      await Promise.all(
        poLinks.map(async (link) => {
          const [po] = await this.db.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, link.poId))
          return po
        }),
      )
    ).filter(Boolean)
    return { ...booking, pos, legs }
  }
}
