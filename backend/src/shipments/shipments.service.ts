import { Injectable, NotFoundException } from '@nestjs/common'
import { ShipmentRepository } from '../db/repositories/shipment.repository'

@Injectable()
export class ShipmentsService {
  constructor(private readonly shipments: ShipmentRepository) {}

  /** A single leg with its milestones + PO split. */
  async getOne(id: string) {
    const ship = await this.shipments.findById(id)
    if (!ship) throw new NotFoundException(`shipment ${id} not found`)
    const milestones = await this.shipments.milestonesFor(id)
    const pos = await this.shipments.posFor(id)
    return { ...ship, milestones, pos }
  }
}
