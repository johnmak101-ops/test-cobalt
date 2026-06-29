import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface HistoryEntry {
  id: string
  shipmentId: string
  field: string
  oldValue: string | null
  newValue: string | null
  sourceType: 'email' | 'manual' | 'system'
  sourceId: string | null
  changedBy: string | null
  isDelay: boolean
  notes: string | null
  changedAt: string
}

interface HistoryResponse {
  history: HistoryEntry[]
}

export function useShipmentHistory(shipmentId: string) {
  return useQuery<HistoryResponse>({
    queryKey: ['shipment-history', shipmentId],
    queryFn: () => api.get(`/shipments/${shipmentId}/history`),
    enabled: !!shipmentId,
  })
}
