import type { MeshCustomerRow, MeshMasterSource, MeshVendorRow } from './mesh.types'

export interface SyncSummary { type: 'customers' | 'vendors' | 'forwarders'; fetched: number; inserted: number; updated: number; error?: string }

/** The masters-write surface the sync needs. MastersRepository satisfies it structurally. */
export interface MastersSyncRepo {
  listCustomers(): Promise<{ id: string; code: string; name: string; country: string | null; contactEmail: string | null; address: string | null }[]>
  insertCustomers(rows: (MeshCustomerRow & { erpSyncedAt: Date })[]): Promise<void>
  updateCustomer(id: string, patch: { name?: string; country?: string | null; contactEmail?: string | null; address?: string | null; erpSyncedAt: Date }): Promise<void>
  listVendors(): Promise<{ id: string; code: string | null; name: string; type: string; location: string | null; contactEmail: string | null; contactPhone: string | null }[]>
  insertVendors(rows: (MeshVendorRow & { erpSyncedAt: Date })[]): Promise<void>
  updateVendor(id: string, patch: { name?: string; type?: 'factory' | 'agent'; location?: string | null; contactEmail?: string | null; contactPhone?: string | null; erpSyncedAt: Date }): Promise<void>
  listForwarders(): Promise<{ id: string; code: string | null; name: string }[]>
  insertForwarders(rows: { code: string; name: string }[]): Promise<void>
  updateForwarder(id: string, patch: { name: string }): Promise<unknown>
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))
const U = (s: string | null | undefined): string => String(s ?? '').toUpperCase()

/** Pull each master type from Mesh and reconcile into the local mirror: insert new, update changed, NEVER
 *  delete. Each type is isolated — one type's failure is recorded and never blocks the others. */
export class MastersSyncService {
  constructor(private readonly source: MeshMasterSource, private readonly repo: MastersSyncRepo, private readonly now: () => Date = () => new Date()) {}

  async sync(): Promise<SyncSummary[]> {
    return [await this.syncCustomers(), await this.syncVendors(), await this.syncForwarders()]
  }

  private async syncCustomers(): Promise<SyncSummary> {
    try {
      const fetched = await this.source.customers()
      const existing = new Map((await this.repo.listCustomers()).map((r) => [U(r.code), r]))
      const now = this.now()
      const toInsert: (MeshCustomerRow & { erpSyncedAt: Date })[] = []
      let updated = 0
      for (const raw of fetched) {
        // normalize enrichment to null so a source omitting a field diffs stably against DB NULLs
        const row = { ...raw, country: raw.country ?? null, contactEmail: raw.contactEmail ?? null, address: raw.address ?? null }
        const cur = existing.get(U(row.code))
        if (!cur) toInsert.push({ ...row, erpSyncedAt: now })
        else if (cur.name !== row.name || cur.country !== row.country || cur.contactEmail !== row.contactEmail || cur.address !== row.address) {
          await this.repo.updateCustomer(cur.id, { name: row.name, country: row.country, contactEmail: row.contactEmail, address: row.address, erpSyncedAt: now })
          updated++
        }
      }
      await this.repo.insertCustomers(toInsert)
      return { type: 'customers', fetched: fetched.length, inserted: toInsert.length, updated }
    } catch (e) { return { type: 'customers', fetched: 0, inserted: 0, updated: 0, error: msg(e) } }
  }

  private async syncVendors(): Promise<SyncSummary> {
    try {
      const fetched = await this.source.vendors()
      const existing = new Map((await this.repo.listVendors()).filter((r) => r.code).map((r) => [U(r.code), r]))
      const now = this.now()
      const toInsert: (MeshVendorRow & { erpSyncedAt: Date })[] = []
      let updated = 0
      for (const row of fetched) {
        const cur = existing.get(U(row.code))
        if (!cur) toInsert.push({ ...row, erpSyncedAt: now })
        else if (cur.name !== row.name || cur.type !== row.type || cur.location !== row.location || cur.contactEmail !== row.contactEmail || cur.contactPhone !== row.contactPhone) {
          await this.repo.updateVendor(cur.id, { name: row.name, type: row.type, location: row.location, contactEmail: row.contactEmail, contactPhone: row.contactPhone, erpSyncedAt: now })
          updated++
        }
      }
      await this.repo.insertVendors(toInsert)
      return { type: 'vendors', fetched: fetched.length, inserted: toInsert.length, updated }
    } catch (e) { return { type: 'vendors', fetched: 0, inserted: 0, updated: 0, error: msg(e) } }
  }

  private async syncForwarders(): Promise<SyncSummary> {
    try {
      const fetched = await this.source.forwarders()
      const existing = new Map((await this.repo.listForwarders()).filter((r) => r.code).map((r) => [U(r.code), r]))
      const toInsert: { code: string; name: string }[] = []
      let updated = 0
      for (const row of fetched) {
        const cur = existing.get(U(row.code))
        if (!cur) toInsert.push({ code: row.code, name: row.name })
        else if (cur.name !== row.name) { await this.repo.updateForwarder(cur.id, { name: row.name }); updated++ }
      }
      await this.repo.insertForwarders(toInsert)
      return { type: 'forwarders', fetched: fetched.length, inserted: toInsert.length, updated }
    } catch (e) { return { type: 'forwarders', fetched: 0, inserted: 0, updated: 0, error: msg(e) } }
  }
}
