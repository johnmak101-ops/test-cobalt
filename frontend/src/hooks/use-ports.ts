import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

/** One row of the seeded UN/LOCODE ports master (GET /api/masters/ports). */
export interface PortMaster {
  unlocode: string
  name: string
  country?: string | null
  mode?: string | null
  iata?: string | null
}

/**
 * The seeded ports master — complete and NOT Mesh-lagged (unlike customers/vendors), so it backs the
 * POL/POD picker. Cached hard: the catalog is large and effectively static within a session, and the
 * picker mounts once per conflict row / edit form, so one fetch should serve them all.
 */
export function usePorts() {
  return useQuery<PortMaster[]>({
    queryKey: ['masters', 'ports'],
    queryFn: () => api.get('/masters/ports'),
    staleTime: 60 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  })
}
