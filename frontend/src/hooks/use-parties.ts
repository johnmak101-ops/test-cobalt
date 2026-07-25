import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

/** One row of the Mesh customer/vendor mirror (GET /api/masters/customers | /masters/vendors). */
export interface PartyMaster {
  id: string
  code: string | null
  name: string
  nameCh?: string | null
  /** customers only */
  country?: string | null
  /** vendors only */
  type?: string | null
  location?: string | null
}

export type PartyKind = 'customer' | 'vendor' | 'forwarder'

const PATH: Record<PartyKind, string> = {
  customer: '/masters/customers',
  vendor: '/masters/vendors',
  forwarder: '/masters/forwarders',
}

/**
 * The Mesh party mirror behind the Customer/Vendor pickers.
 *
 * Unlike the ports master this one LAGS the ERP by ~2 months, which is exactly why
 * {@link PartyPicker} keeps a free-text fallback — a party that exists in real life but not yet in
 * the mirror must still be enterable. Cached like usePorts: ~850 customers / ~1.5k vendors is a lot
 * of rows, static within a session, and the picker mounts once per field.
 */
export function useParties(kind: PartyKind) {
  return useQuery<PartyMaster[]>({
    queryKey: ['masters', PATH[kind]],
    queryFn: () => api.get(PATH[kind]),
    staleTime: 60 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  })
}
