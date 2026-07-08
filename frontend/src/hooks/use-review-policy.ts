import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface ReviewTrigger {
  id: string
  label: string
  enabled: boolean
}

/** The review-trigger catalog + enabled state (GET /api/settings/review-policy). */
export function useReviewPolicy() {
  return useQuery<{ triggers: ReviewTrigger[] }>({
    queryKey: ['reviewPolicy'],
    queryFn: () => api.get('/settings/review-policy'),
  })
}

export function useSaveReviewPolicy() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (enabled: string[]) => api.put('/settings/review-policy', { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reviewPolicy'] }),
  })
}
