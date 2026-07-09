/** Mesh master rows mapped to the local upsert shape (active-only; see mesh.client mappers). */
export interface MeshCustomerRow { code: string; name: string }
export interface MeshVendorRow {
  code: string
  name: string
  type: 'factory' | 'agent'
  location: string | null
  contactEmail: string | null
  contactPhone: string | null
}
export interface MeshForwarderRow { code: string; name: string }

/** The masters the daily sync pulls. Implemented by MeshClient; faked in tests. */
export interface MeshMasterSource {
  customers(): Promise<MeshCustomerRow[]>
  vendors(): Promise<MeshVendorRow[]> // factories + gmtsuppliers combined
  forwarders(): Promise<MeshForwarderRow[]>
}
