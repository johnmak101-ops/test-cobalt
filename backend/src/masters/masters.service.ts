import { Inject, Injectable } from '@nestjs/common'
import * as schema from '@cobalt/contracts'
import { DRIZZLE, type DrizzleDB } from '../db/drizzle.provider'

@Injectable()
export class MastersService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  customers() {
    return this.db.select().from(schema.customers).orderBy(schema.customers.name)
  }
  vendors() {
    return this.db.select().from(schema.vendors).orderBy(schema.vendors.name)
  }
  forwarders() {
    return this.db.select().from(schema.forwarders).orderBy(schema.forwarders.name)
  }
  ports() {
    return this.db.select().from(schema.ports).orderBy(schema.ports.unlocode)
  }
  consignees() {
    return this.db.select().from(schema.consignees).orderBy(schema.consignees.name)
  }
}
