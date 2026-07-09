import { describe, it, expect } from 'vitest'
import { meshConfigFromEnv } from './mesh.config'

const base = { MESH_TENANT_ID: 't', MESH_CLIENT_ID: 'c', MESH_CLIENT_SECRET: 's', MESH_SCOPE: 'api://x/.default' }

describe('meshConfigFromEnv', () => {
  it('reads all vars and defaults the base URL', () => {
    const cfg = meshConfigFromEnv(base as NodeJS.ProcessEnv)
    expect(cfg).toEqual({ baseUrl: 'https://operationapps.cobaltknitwear.com/cobaltmesh/api', tenantId: 't', clientId: 'c', clientSecret: 's', scope: 'api://x/.default' })
  })
  it('trims a trailing slash off an overridden base URL', () => {
    expect(meshConfigFromEnv({ ...base, MESH_BASE_URL: 'https://h/api/' } as NodeJS.ProcessEnv).baseUrl).toBe('https://h/api')
  })
  it('throws a clear error when the secret is missing', () => {
    expect(() => meshConfigFromEnv({ ...base, MESH_CLIENT_SECRET: '' } as NodeJS.ProcessEnv)).toThrow(/MESH_CLIENT_SECRET/)
  })
})
