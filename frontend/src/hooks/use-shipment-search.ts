import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

/** Compact row from GET /api/shipments?q= (Review "Move PO" target search). */
export type ShipmentSearchHit = {
  id: string
  bookingNo: string | null
  soNumber: string | null
  customerName: string | null
  route: string | null
  status: string
  reviewStatus?: string | null
}

/**
 * Free-text shipment search for Review re-home flows.
 * Enabled only when `q` has at least 2 non-space characters (server still accepts shorter,
 * but short queries are noise). Keeps prior results visible while the next page loads.
 */
export function useShipmentSearch(q: string) {
  const trimmed = q.trim()
  return useQuery({
    queryKey: ['shipment-search', trimmed],
    queryFn: () =>
      api.get<{ shipments: ShipmentSearchHit[] }>(
        `/shipments?q=${encodeURIComponent(trimmed)}&limit=20`,
      ),
    enabled: trimmed.length >= 2,
    placeholderData: (prev) => prev,
  })
}
