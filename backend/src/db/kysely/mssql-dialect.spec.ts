import { describe, it, expect } from 'vitest'
import { parseMssqlConnectionString } from './mssql-dialect'

const LOCAL =
  'Server=localhost,1433;Database=cobalt;User Id=sa;Password=YourStrong!Passw0rd;Encrypt=false;TrustServerCertificate=true'

const FABRIC =
  'Server=myfab.database.fabric.microsoft.com,1433;Database=ShipTrackDB-abc;' +
  'Authentication=Active Directory Service Principal;User Id=client-123;Password=secret-xyz;Tenant Id=tenant-789;Encrypt=true'

describe('parseMssqlConnectionString', () => {
  it('parses a local SQL Server string as default (username/password) auth', () => {
    const cfg = parseMssqlConnectionString(LOCAL)
    expect(cfg.server).toBe('localhost')
    expect(cfg.port).toBe(1433)
    expect(cfg.database).toBe('cobalt')
    expect(cfg.isEntra).toBe(false)
    expect(cfg.encrypt).toBe(false)
    expect(cfg.trustServerCertificate).toBe(true)
    expect(cfg.authentication).toEqual({
      type: 'default',
      options: { userName: 'sa', password: 'YourStrong!Passw0rd' },
    })
  })

  it('parses a Fabric Entra Service Principal string', () => {
    const cfg = parseMssqlConnectionString(FABRIC)
    expect(cfg.server).toBe('myfab.database.fabric.microsoft.com')
    expect(cfg.database).toBe('ShipTrackDB-abc')
    expect(cfg.isEntra).toBe(true)
    expect(cfg.encrypt).toBe(true)
    expect(cfg.authentication).toEqual({
      type: 'azure-active-directory-service-principal-secret',
      options: { clientId: 'client-123', clientSecret: 'secret-xyz', tenantId: 'tenant-789' },
    })
  })

  it('forces encryption on for Entra even when the string says Encrypt=false', () => {
    const cfg = parseMssqlConnectionString(FABRIC.replace('Encrypt=true', 'Encrypt=false'))
    expect(cfg.encrypt).toBe(true)
  })

  it('throws a clear error when Entra auth is missing a Tenant Id', () => {
    const noTenant = FABRIC.replace(';Tenant Id=tenant-789', '')
    expect(() => parseMssqlConnectionString(noTenant)).toThrow(/Tenant Id/i)
  })

  it('throws a clear error when Entra auth is missing the client id or secret', () => {
    const noClient = FABRIC.replace(';User Id=client-123', '')
    expect(() => parseMssqlConnectionString(noClient)).toThrow(/client id|User Id/i)
  })
})
