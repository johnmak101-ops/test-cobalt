import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface Customer {
  id: string
  code: string
  name: string
  erpSyncedAt: string | null
}
export interface Vendor {
  id: string
  code: string | null
  name: string
  type: string
  location: string | null
  contactEmail: string | null
}
export interface Forwarder {
  id: string
  code: string | null
  name: string
}
export interface Port {
  id: string
  unlocode: string
  name: string
  country: string | null
  mode: string
}
export interface Consignee {
  id: string
  name: string
  address: string | null
  mapsToCustomerId: string | null
}

export type EditableKind = 'forwarders' | 'ports' | 'consignees'

const key = (k: string) => ['masters', k]

export const useCustomers = () => useQuery({ queryKey: key('customers'), queryFn: () => api.get<Customer[]>('/masters/customers') })
export const useVendors = () => useQuery({ queryKey: key('vendors'), queryFn: () => api.get<Vendor[]>('/masters/vendors') })
export const useForwarders = () => useQuery({ queryKey: key('forwarders'), queryFn: () => api.get<Forwarder[]>('/masters/forwarders') })
export const usePorts = () => useQuery({ queryKey: key('ports'), queryFn: () => api.get<Port[]>('/masters/ports') })
export const useConsignees = () => useQuery({ queryKey: key('consignees'), queryFn: () => api.get<Consignee[]>('/masters/consignees') })

export const useCreateMaster = (kind: EditableKind) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post(`/masters/${kind}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(kind) }),
  })
}

export const useUpdateMaster = (kind: EditableKind) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Record<string, unknown>) => api.patch(`/masters/${kind}/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(kind) }),
  })
}

// --- resolution facts (curated masters) + the curator loop ---
export interface MasterFact {
  id: string
  kind: string
  lhs: string
  rhs: string | null
  status: string
  source: string
  reason: string | null
  createdAt: string
}

export const useProposals = () => useQuery({ queryKey: key('proposals'), queryFn: () => api.get<MasterFact[]>('/masters/proposals') })
export const useResolution = () => useQuery({ queryKey: key('resolution'), queryFn: () => api.get<MasterFact[]>('/masters/resolution') })

export const useCurate = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post('/masters/curate', {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: key('proposals') }),
  })
}

export const useResolveProposal = (action: 'approve' | 'reject') => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.post(`/masters/proposals/${id}/${action}`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key('proposals') })
      qc.invalidateQueries({ queryKey: key('resolution') })
    },
  })
}
