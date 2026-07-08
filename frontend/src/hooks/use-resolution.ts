import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type ResolutionFact } from '../lib/api'
import { apiErrorMessage } from './use-users'
import { toast } from '../components/ui/Toast'

export type { ResolutionFact }

const FACTS = ['resolution-facts'] as const
const PROPOSALS = ['resolution-proposals'] as const

export function useResolutionFacts() {
  return useQuery({ queryKey: FACTS, queryFn: () => api.getResolutionManage() })
}
export function useProposals() {
  return useQuery({ queryKey: PROPOSALS, queryFn: () => api.getProposals() })
}

/** A mutation that toasts on failure and invalidates the given query keys on success. */
function useInvalidatingMutation<V>(fn: (v: V) => Promise<unknown>, fail: string, keys: readonly (readonly string[])[]) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => keys.forEach((k) => qc.invalidateQueries({ queryKey: k })),
    onError: (e) => toast(apiErrorMessage(e, fail)),
  })
}

export function useCreateFact() {
  return useInvalidatingMutation((b: { kind: string; lhs: string; rhs?: string; reason?: string }) => api.createFact(b), 'Failed to create rule', [FACTS])
}
export function usePatchFact() {
  return useInvalidatingMutation(({ id, reason }: { id: string; reason?: string }) => api.patchFact(id, { reason }), 'Failed to update rule', [FACTS])
}
export function useDeactivateFact() {
  return useInvalidatingMutation((id: string) => api.deactivateFact(id), 'Failed to deactivate', [FACTS])
}
export function useReactivateFact() {
  return useInvalidatingMutation((id: string) => api.reactivateFact(id), 'Failed to reactivate', [FACTS])
}
export function useApproveProposal() {
  return useInvalidatingMutation((id: string) => api.approveProposal(id), 'Failed to approve', [FACTS, PROPOSALS])
}
export function useRejectProposal() {
  return useInvalidatingMutation((id: string) => api.rejectProposal(id), 'Failed to reject', [PROPOSALS])
}
