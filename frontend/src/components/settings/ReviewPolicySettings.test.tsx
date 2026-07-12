import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ReviewPolicySettings } from './ReviewPolicySettings'

// `data` must be a STABLE reference across renders — the component keys draft reset on data identity
// (real react-query memoizes data; a fresh object per call would thrash drafts every render).
vi.mock('../../hooks/use-review-policy', () => {
  const data = {
    triggers: [
      { id: 'conflict', label: "there's an unresolved conflict", enabled: true },
      { id: 'no_po', label: 'no PO is linked', enabled: false },
    ],
  }
  return {
    useReviewPolicy: () => ({ data, isLoading: false }),
    useSaveReviewPolicy: () => ({ mutate: vi.fn(), isPending: false }),
  }
})

let level: 'none' | 'view' | 'edit' = 'edit'
vi.mock('../../hooks/use-page-access', () => ({
  usePageAccess: () => ({ canEdit: () => level === 'edit', canView: () => level !== 'none', levelFor: () => level, loading: false }),
}))

describe('ReviewPolicySettings', () => {
  it('renders a checkbox per trigger reflecting its enabled state', () => {
    level = 'edit'
    render(<ReviewPolicySettings />)
    expect((screen.getByLabelText(/there's an unresolved conflict/) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText(/no PO is linked/) as HTMLInputElement).checked).toBe(false)
    expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument()
  })

  it('is read-only (checkboxes disabled, no Save) when the user lacks edit', () => {
    level = 'view'
    render(<ReviewPolicySettings />)
    expect((screen.getByLabelText(/there's an unresolved conflict/) as HTMLInputElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument()
    level = 'edit'
  })
})
