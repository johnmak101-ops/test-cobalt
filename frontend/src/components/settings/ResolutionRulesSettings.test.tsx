import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ResolutionRulesSettings } from './ResolutionRulesSettings'

vi.mock('../../hooks/use-resolution', () => ({
  useResolutionFacts: () => ({
    data: [
      { id: 'r1', kind: 'customer_group', lhs: 'SEH', rhs: 'PRIMARK', status: 'approved', source: 'seed', reason: null, active: true, createdAt: '' },
      { id: 'r2', kind: 'vendor_alias', lhs: 'MACAU FUNG TAI', rhs: 'MACFUN', status: 'approved', source: 'ops', reason: null, active: false, createdAt: '' },
    ],
    isLoading: false, isError: false,
  }),
  useProposals: () => ({ data: [], isLoading: false }),
  useCreateFact: () => ({ mutate: vi.fn(), isPending: false }),
  usePatchFact: () => ({ mutate: vi.fn(), isPending: false }),
  useDeactivateFact: () => ({ mutate: vi.fn(), isPending: false }),
  useReactivateFact: () => ({ mutate: vi.fn(), isPending: false }),
  useApproveProposal: () => ({ mutate: vi.fn(), isPending: false }),
  useRejectProposal: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('../../hooks/use-page-access', () => ({
  usePageAccess: () => ({ canEdit: () => true, canView: () => true, levelFor: () => 'edit', loading: false }),
}))

describe('ResolutionRulesSettings', () => {
  it('lists facts and marks a deactivated one', () => {
    render(<ResolutionRulesSettings />)
    expect(screen.getByText('SEH')).toBeInTheDocument()
    expect(screen.getByText('MACAU FUNG TAI')).toBeInTheDocument()
    expect(screen.getByText(/inactive/i)).toBeInTheDocument()
  })
  it('badges retired alias kinds in the list (not offered in create, still visible as audit)', () => {
    render(<ResolutionRulesSettings />)
    expect(screen.getByText('vendor_alias')).toBeInTheDocument()
    expect(screen.getByText(/retired/i)).toBeInTheDocument()
  })
  it('shows an Add rule control', () => {
    render(<ResolutionRulesSettings />)
    expect(screen.getByRole('button', { name: /add rule/i })).toBeInTheDocument()
  })
})
