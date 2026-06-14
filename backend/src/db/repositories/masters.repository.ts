import { Inject, Injectable } from '@nestjs/common'
import { eq, ilike } from 'drizzle-orm'
import * as schema from '@cobalt/contracts'
import { DRIZZLE, type DrizzleDB } from '../drizzle.provider'

/** Data access for master data (read + tiered resolution). */
@Injectable()
export class MastersRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  listCustomers() {
    return this.db.select().from(schema.customers).orderBy(schema.customers.name)
  }
  listVendors() {
    return this.db.select().from(schema.vendors).orderBy(schema.vendors.name)
  }
  listForwarders() {
    return this.db.select().from(schema.forwarders).orderBy(schema.forwarders.name)
  }
  listPorts() {
    return this.db.select().from(schema.ports).orderBy(schema.ports.unlocode)
  }
  listConsignees() {
    return this.db.select().from(schema.consignees).orderBy(schema.consignees.name)
  }

  async customerIdByCode(code: string) {
    const [r] = await this.db.select().from(schema.customers).where(eq(schema.customers.code, code.toUpperCase()))
    return r?.id ?? null
  }
  async vendorIdByCode(code: string) {
    const [r] = await this.db.select().from(schema.vendors).where(eq(schema.vendors.code, code.toUpperCase()))
    return r?.id ?? null
  }
  async forwarderIdByName(name: string) {
    const [r] = await this.db.select().from(schema.forwarders).where(ilike(schema.forwarders.name, `%${name}%`))
    if (r) return r.id
    const [a] = await this.db.select().from(schema.forwarderAliases).where(ilike(schema.forwarderAliases.value, `%${name}%`))
    return a?.forwarderId ?? null
  }
  async portIdByCodeOrName(code: string) {
    const [byCode] = await this.db.select().from(schema.ports).where(eq(schema.ports.unlocode, code.toUpperCase()))
    if (byCode) return byCode.id
    const [byName] = await this.db.select().from(schema.ports).where(ilike(schema.ports.name, `%${code}%`))
    return byName?.id ?? null
  }
}
