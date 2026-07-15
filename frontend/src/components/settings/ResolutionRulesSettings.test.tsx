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
  useUnmatchedMasters: () => ({
    data: [{ field: 'pol', value: 'CHATTOGRAM', legsAffected: 2 }],
    isLoading: false,
    isError: false,
  }),
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
  it('shows human labels, not raw db kind/column names', () => {
    render(<ResolutionRulesSettings />)
    expect(screen.getByText('Customer group')).toBeInTheDocument()
    expect(screen.getByText('Vendor alias (retired)')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Type' })).toBeInTheDocument()
    // column headers: From / To — not lhs / rhs
    expect(screen.getByRole('columnheader', { name: 'From' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'To' })).toBeInTheDocument()
    expect(screen.queryByText('lhs')).not.toBeInTheDocument()
    expect(screen.queryByText('rhs')).not.toBeInTheDocument()
    expect(screen.queryByText('vendor_alias')).not.toBeInTheDocument()
    expect(screen.queryByText('customer_group')).not.toBeInTheDocument()
  })
  it('shows an Add rule control', () => {
    render(<ResolutionRulesSettings />)
    expect(screen.getByRole('button', { name: /add rule/i })).toBeInTheDocument()
  })

  it('opens a deactivate confirm modal instead of window.confirm', async () => {
    const { userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    render(<ResolutionRulesSettings />)
    await user.click(screen.getByRole('button', { name: /deactivate SEH/i }))
    expect(screen.getByRole('dialog', { name: /deactivate rule/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^deactivate$/i })).toBeInTheDocument()
  })

  it('opens an edit-reason modal instead of window.prompt', async () => {
    const { userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    render(<ResolutionRulesSettings />)
    await user.click(screen.getByRole('button', { name: /edit reason for SEH/i }))
    expect(screen.getByRole('dialog', { name: /edit reason/i })).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/optional note/i)).toBeInTheDocument()
  })
})
