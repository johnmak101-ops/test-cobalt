import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
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

interface CsvImportResponse {
  imported: number
  errors: number
  details: {
    imported: Array<{ id: string; name: string; type: string }>
    errors: Array<{ line: number; error: string }>
  }
}

export function useVendors(type?: string) {
  const params = new URLSearchParams()
  if (type) params.set('type', type)
  const query = params.toString()

  return useQuery<VendorsResponse>({
    queryKey: ['vendors', type],
    queryFn: () => api.get(`/vendors${query ? `?${query}` : ''}`),
  })
}

export function useVendor(id: string) {
  return useQuery<Vendor>({
    queryKey: ['vendor', id],
    queryFn: () => api.get(`/vendors/${id}`),
    enabled: !!id,
  })
}

export function useCreateVendor() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: {
      name: string
      type?: string
      location?: string
      contactEmail?: string
      contactPhone?: string
      notes?: string
    }) => api.post('/vendors', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendors'] })
    },
  })
}

export function useUpdateVendor() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & Record<string, unknown>) =>
      api.patch(`/vendors/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendors'] })
      queryClient.invalidateQueries({ queryKey: ['vendor'] })
    },
  })
}

export function useDeleteVendor() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => api.delete(`/vendors/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendors'] })
    },
  })
}

export function useImportVendorsCsv() {
  const queryClient = useQueryClient()

  return useMutation<CsvImportResponse, Error, string>({
    mutationFn: (csv: string) => api.post('/vendors/import-csv', { csv }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendors'] })
    },
  })
}
