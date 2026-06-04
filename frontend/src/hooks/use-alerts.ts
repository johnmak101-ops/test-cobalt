import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface Alert {
  id: string
  shipmentId: string
  ruleId: string
  severity: string
  message: string
  status: string
  triggeredAt: string
  dismissedAt: string | null
  snoozedUntil: string | null
  shipment?: {
    id: string
    poNumbers: string
    route: string | null
    customer?: { name: string } | null
  }
}

interface AlertsResponse {
  alerts: Alert[]
}

export function useAlerts() {
  return useQuery<AlertsResponse>({
    queryKey: ['alerts'],
    queryFn: () => api.get('/alerts'),
    refetchInterval: 60000,
  })
}

export function useDismissAlert() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.patch(`/alerts/${id}/dismiss`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alerts'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

export function useSnoozeAlert() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, hours }: { id: string; hours: number }) =>
      api.patch(`/alerts/${id}/snooze`, { hours }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alerts'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}
