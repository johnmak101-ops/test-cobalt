/**
 * Master-data UI presentation (read-only search): vendors / forwarders / customers / consignees.
 * These mirror Cobalt Mesh reference data; this service only filters + shapes them for type-aheads
 * and the read-only Vendors settings list. No writes.
 */
import { Injectable } from '@nestjs/common'
import { MastersRepository } from '../db/repositories/masters.repository'
import { isoOrNull } from './adapters/derive'

type Ref = { id: string; code?: string | null; name: string }

@Injectable()
export class MasterDataPresentationService {
  constructor(private readonly mastersRepo: MastersRepository) {}

  private static search<T extends { name: string; code?: string | null }>(rows: T[], q?: string): T[] {
    if (!q) return rows
    const needle = q.toLowerCase()
    return rows.filter(
      (r) => r.name?.toLowerCase().includes(needle) || (r.code ?? '').toLowerCase().includes(needle),
    )
  }

  async vendors(q?: string, type?: string) {
    let rows = (await this.mastersRepo.listVendors()) as Array<
      Ref & {
        type?: string | null
        location?: string | null
        contactEmail?: string | null
        contactPhone?: string | null
        notes?: string | null
        createdAt?: Date | string | null
        updatedAt?: Date | string | null
      }
    >
    if (type) rows = rows.filter((r) => r.type === type)
    return {
      vendors: MasterDataPresentationService.search(rows, q).map((v) => ({
        id: v.id,
        name: v.name,
        code: v.code ?? null, // kept for the type-ahead consumer; the UI Vendor type ignores it
        type: v.type ?? 'factory',
        location: v.location ?? null,
        contactEmail: v.contactEmail ?? null,
        contactPhone: v.contactPhone ?? null,
        notes: v.notes ?? null,
        createdAt: isoOrNull(v.createdAt),
        updatedAt: isoOrNull(v.updatedAt),
      })),
    }
  }

  async forwarders(q?: string) {
    const rows = (await this.mastersRepo.listForwarders()) as Ref[]
    return { forwarders: MasterDataPresentationService.search(rows, q).map((f) => ({ id: f.id, name: f.name, code: f.code ?? null })) }
  }

  async customers(q?: string) {
    const rows = (await this.mastersRepo.listCustomers()) as Ref[]
    return { customers: MasterDataPresentationService.search(rows, q).map((c) => ({ id: c.id, name: c.name, code: c.code ?? null })) }
  }

  async consignees(q?: string) {
    const rows = (await this.mastersRepo.listConsignees()) as Array<{ id: string; name: string; address: string | null }>
    return { consignees: MasterDataPresentationService.search(rows, q).map((c) => ({ id: c.id, name: c.name, address: c.address ?? null })) }
  }
}
