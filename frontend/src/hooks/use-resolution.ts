import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type ResolutionFact } from '../lib/api'
import { apiErrorMessage } from './use-users'
import { toast } from '../components/ui/Toast'

export type { ResolutionFact }

const FACTS = ['resolution-facts'] as const
const PROPOSALS = ['resolution-proposals'] as const
const UNMATCHED = ['masters-unmatched'] as const

export function useResolutionFacts() {
  return useQuery({ queryKey: FACTS, queryFn: () => api.getResolutionManage() })
}
export function useProposals() {
  return useQuery({ queryKey: PROPOSALS, queryFn: () => api.getProposals() })
}
/** Live legs with unresolved forwarder/port raw values (#145). */
export function useUnmatchedMasters() {
  return useQuery({ queryKey: UNMATCHED, queryFn: () => api.getUnmatchedMasters() })
}

/** A mutation that toasts success/failure and invalidates the given query keys on success. */
function useInvalidatingMutation<V>(
  fn: (v: V) => Promise<unknown>,
  messages: { ok: string; fail: string },
  keys: readonly (readonly string[])[],
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      toast(messages.ok)
      keys.forEach((k) => qc.invalidateQueries({ queryKey: k }))
    },
    onError: (e) => toast.error(apiErrorMessage(e, messages.fail)),
  })
}

export function useCreateFact() {
  return useInvalidatingMutation(
    (b: { kind: string; lhs: string; rhs?: string; reason?: string }) => api.createFact(b),
    { ok: 'Rule added', fail: 'Failed to create rule' },
    [FACTS],
  )
}
export function usePatchFact() {
  return useInvalidatingMutation(
    ({ id, reason }: { id: string; reason?: string }) => api.patchFact(id, { reason }),
    { ok: 'Reason updated', fail: 'Failed to update rule' },
    [FACTS],
  )
}
export function useDeactivateFact() {
  return useInvalidatingMutation(
    (id: string) => api.deactivateFact(id),
    { ok: 'Rule deactivated', fail: 'Failed to deactivate' },
    [FACTS],
  )
}
export function useReactivateFact() {
  return useInvalidatingMutation(
    (id: string) => api.reactivateFact(id),
    { ok: 'Rule reactivated', fail: 'Failed to reactivate' },
    [FACTS],
  )
}
export function useApproveProposal() {
  return useInvalidatingMutation(
    (id: string) => api.approveProposal(id),
    { ok: 'Proposal approved', fail: 'Failed to approve' },
    [FACTS, PROPOSALS],
  )
}
export function useRejectProposal() {
  return useInvalidatingMutation(
    (id: string) => api.rejectProposal(id),
    { ok: 'Proposal rejected', fail: 'Failed to reject' },
    [PROPOSALS],
  )
}
