import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { Alert } from '../lib/types'

export const useAlerts = (status?: string) =>
  useQuery({ queryKey: ['alerts', status], queryFn: () => api.get<Alert[]>(`/alerts${status ? `?status=${status}` : ''}`) })

export const useEvaluateAlerts = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post('/alerts/evaluate', {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts'] }),
  })
}

export const useDismissAlert = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.post(`/alerts/${id}/dismiss`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts'] }),
  })
}
