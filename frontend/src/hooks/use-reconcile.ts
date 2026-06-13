import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export const useReconcile = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<{ evidence: number; groups: number }>('/reconcile/run', {}),
    onSuccess: () => qc.invalidateQueries(),
  })
}
