import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface Vendor {
  id: string
  name: string
  type: 'factory' | 'subcontractor' | 'agent'
  location: string | null
  contactEmail: string | null
  contactPhone: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
}

interface VendorsResponse {
  vendors: Vendor[]
}

/**
 * Vendors are a READ-ONLY mirror of the Cobalt Mesh API — only `GET /vendors` is served by the backend.
 * There are intentionally no create/update/delete/import hooks: those routes do not exist (a delete/create
 * from here would 404). Vendors are maintained in Cobalt Mesh; this app only resolves them / flags unknowns.
 */
export function useVendors(type?: string) {
  const params = new URLSearchParams()
  if (type) params.set('type', type)
  const query = params.toString()

  return useQuery<VendorsResponse>({
    queryKey: ['vendors', type],
    queryFn: () => api.get(`/vendors${query ? `?${query}` : ''}`),
  })
}
