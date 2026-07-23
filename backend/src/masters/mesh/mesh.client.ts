import type { MeshConfig } from './mesh.config'
import type { MeshCustomerRow, MeshVendorRow, MeshForwarderRow, MeshMasterSource } from './mesh.types'

const str = (v: unknown): string | null => {
  const s = v == null ? '' : String(v).trim()
  return s === '' ? null : s
}

export function mapCustomer(raw: Record<string, unknown>): MeshCustomerRow | null {
  if (raw?.IsActive !== true) return null
  const code = str(raw.CustomerCode)
  if (!code) return null
  return {
    code,
    name: str(raw.FullNameEn) ?? str(raw.FullNameCh) ?? code,
    country: str(raw.CountryName),
    contactEmail: str(raw.Email),
    address: str(raw.Address),
    nameCh: str(raw.FullNameCh),
  }
}
export function mapVendor(raw: Record<string, unknown>, type: 'factory' | 'agent', codeKey: string): MeshVendorRow | null {
  if (raw?.IsActive !== true) return null
  const code = str(raw[codeKey])
  if (!code) return null
  return { code, name: str(raw.FullNameEn) ?? str(raw.FullNameCh) ?? code, type, location: str(raw.CountryName), contactEmail: str(raw.Email), contactPhone: str(raw.Phone), nameCh: str(raw.FullNameCh) }
}
export function mapForwarder(raw: Record<string, unknown>): MeshForwarderRow | null {
  if (raw?.Active !== true) return null
  const code = str(raw.ForwarderCode)
  if (!code) return null
  return { code, name: str(raw.ForwarderName) ?? code }
}

type FetchFn = typeof fetch

/** Read-only client for the Cobalt Mesh ShipTrack master-data API (OAuth2 client_credentials). */
export class MeshClient implements MeshMasterSource {
  private token: { value: string; exp: number } | null = null
  constructor(private readonly cfg: MeshConfig, private readonly fetchFn: FetchFn = fetch) {}

  private async accessToken(): Promise<string> {
    const now = Date.now()
    if (this.token && this.token.exp > now + 60_000) return this.token.value
    const url = `https://login.microsoftonline.com/${this.cfg.tenantId}/oauth2/v2.0/token`
    const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret, scope: this.cfg.scope })
    const r = await this.fetchFn(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body })
    if (!r.ok) throw new Error(`Mesh token request failed: ${r.status}`)
    const j = (await r.json()) as { access_token: string; expires_in?: number }
    this.token = { value: j.access_token, exp: now + (j.expires_in ?? 3600) * 1000 }
    return this.token.value
  }

  private async getArray(path: string): Promise<Record<string, unknown>[]> {
    const r = await this.fetchFn(`${this.cfg.baseUrl}${path}`, { headers: { authorization: `Bearer ${await this.accessToken()}`, accept: 'application/json' } })
    if (!r.ok) throw new Error(`Mesh GET ${path} failed: ${r.status}`)
    const data = await r.json()
    return Array.isArray(data) ? (data as Record<string, unknown>[]) : []
  }

  async customers(): Promise<MeshCustomerRow[]> {
    return (await this.getArray('/ShipTrack/customers')).map(mapCustomer).filter((x): x is MeshCustomerRow => x != null)
  }
  async vendors(): Promise<MeshVendorRow[]> {
    const [f, g] = await Promise.all([this.getArray('/ShipTrack/factories'), this.getArray('/ShipTrack/gmtsuppliers')])
    const mapped = [...f.map((r) => mapVendor(r, 'factory', 'FactoryCode')), ...g.map((r) => mapVendor(r, 'agent', 'GmtSuppCode'))].filter((x): x is MeshVendorRow => x != null)
    // A company can be BOTH a factory and a gmtsupplier (shared code). `vendors` is one row per code, so
    // dedupe: the factory (manufacturing entity) wins; a gmtsupplier only fills a code no factory has.
    const byCode = new Map<string, MeshVendorRow>()
    for (const row of mapped) {
      const k = row.code.toUpperCase()
      if (!byCode.has(k) || row.type === 'factory') byCode.set(k, row)
    }
    return [...byCode.values()]
  }
  async forwarders(): Promise<MeshForwarderRow[]> {
    return (await this.getArray('/ShipTrack/forwarders')).map(mapForwarder).filter((x): x is MeshForwarderRow => x != null)
  }
}
