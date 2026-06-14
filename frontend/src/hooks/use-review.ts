import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface ReviewItem {
  id: string
  bookingId: string
  jobNo: string | null
  legNo: number
  confidence: number | null
  reviewStatus: string
  reviewReasons: string[] | null
  mode: string | null
  state: string
  soNo: string | null
  bookingNo: string | null
  hblAwbFcrNo: string | null
  mbl: string | null
  containerNo: string | null
  consigneeName: string | null
  cargoReadyDate: string | null
  warehouseStartDate: string | null
  warehouseEndDate: string | null
  etd: string | null
  atd: string | null
  eta: string | null
  qty: number | null
  pos: string[]
}

export const useReviewQueue = () => useQuery({ queryKey: ['review'], queryFn: () => api.get<ReviewItem[]>('/review') })

export const useConfirmReview = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.post(`/review/${id}/confirm`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['review'] }),
  })
}

export const useCorrectReview = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, fields, reason }: { id: string; fields: Record<string, unknown>; reason?: string }) =>
      api.post(`/review/${id}/correct`, { fields, reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['review'] })
      qc.invalidateQueries({ queryKey: ['bookings'] })
    },
  })
}
