import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export const useThreshold = () =>
  useQuery({ queryKey: ['threshold'], queryFn: () => api.get<{ threshold: number }>('/settings/threshold') })

export const useSetThreshold = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (value: number) => api.put<{ threshold: number }>('/settings/threshold', { value }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['threshold'] }),
  })
}
