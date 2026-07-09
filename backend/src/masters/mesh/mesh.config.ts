export interface MeshConfig { baseUrl: string; tenantId: string; clientId: string; clientSecret: string; scope: string }

/** Build the Mesh config from env. The non-secret base URL defaults; everything else is required (the values
 *  live in Master_Data_API.md). Throws a clear error naming the first missing var so the sync fails fast. */
export function meshConfigFromEnv(env: NodeJS.ProcessEnv = process.env): MeshConfig {
  const req = (k: string): string => {
    const v = env[k]
    if (!v) throw new Error(`Mesh sync: ${k} is required (set it in .env from Master_Data_API.md)`)
    return v
  }
  return {
    baseUrl: (env.MESH_BASE_URL ?? 'https://operationapps.cobaltknitwear.com/cobaltmesh/api').replace(/\/+$/, ''),
    tenantId: req('MESH_TENANT_ID'),
    clientId: req('MESH_CLIENT_ID'),
    clientSecret: req('MESH_CLIENT_SECRET'),
    scope: req('MESH_SCOPE'),
  }
}
