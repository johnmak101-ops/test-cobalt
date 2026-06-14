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

  // --- writes (Ops-maintained masters: forwarders / ports / consignees) ---
  async createForwarder(v: { code: string | null; name: string }) {
    const [r] = await this.db.insert(schema.forwarders).values(v).returning()
    return r
  }
  async updateForwarder(id: string, patch: Record<string, unknown>) {
    const [r] = await this.db
      .update(schema.forwarders)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(schema.forwarders.id, id))
      .returning()
    return r ?? null
  }

  async createPort(v: { unlocode: string; name: string; country: string | null; mode: string }) {
    const [r] = await this.db
      .insert(schema.ports)
      .values({ unlocode: v.unlocode, name: v.name, country: v.country, mode: v.mode as 'sea' | 'air' })
      .returning()
    return r
  }
  async updatePort(id: string, patch: Record<string, unknown>) {
    // ports has no updatedAt column
    const [r] = await this.db.update(schema.ports).set(patch).where(eq(schema.ports.id, id)).returning()
    return r ?? null
  }

  async createConsignee(v: { name: string; address: string | null; mapsToCustomerId: string | null }) {
    const [r] = await this.db.insert(schema.consignees).values(v).returning()
    return r
  }
  async updateConsignee(id: string, patch: Record<string, unknown>) {
    const [r] = await this.db
      .update(schema.consignees)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(schema.consignees.id, id))
      .returning()
    return r ?? null
  }
}
