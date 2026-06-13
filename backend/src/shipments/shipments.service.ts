import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import * as schema from '@cobalt/contracts'
import { DRIZZLE, type DrizzleDB } from '../db/drizzle.provider'

@Injectable()
export class ShipmentsService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  /** A single leg with its milestones + PO split. */
  async getOne(id: string) {
    const [ship] = await this.db.select().from(schema.shipments).where(eq(schema.shipments.id, id))
    if (!ship) throw new NotFoundException(`shipment ${id} not found`)
    const milestones = await this.db
      .select()
      .from(schema.shipmentMilestones)
      .where(eq(schema.shipmentMilestones.shipmentId, id))
      .orderBy(schema.shipmentMilestones.occurredAt)
    const pos = await this.db.select().from(schema.shipmentPos).where(eq(schema.shipmentPos.shipmentId, id))
    return { ...ship, milestones, pos }
  }
}
