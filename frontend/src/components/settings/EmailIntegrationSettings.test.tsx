import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EmailIntegrationSettings } from './EmailIntegrationSettings'

const idleMutation = () => ({
  mutate: vi.fn(),
  isPending: false,
  data: undefined,
  isError: false,
  error: null,
  isSuccess: false,
})

vi.mock('../../hooks/use-email-integrations', () => ({
  useEmailIntegration: () => ({ data: { config: null }, isLoading: false }),
  useSaveEmailIntegration: () => idleMutation(),
  useTestEmailConnection: () => idleMutation(),
  useSyncEmails: () => idleMutation(),
}))

describe('EmailIntegrationSettings', () => {
  it('renders the Microsoft 365 connection form (heading + Azure AD credentials)', () => {
    render(<EmailIntegrationSettings />)
    expect(screen.getByText('Microsoft 365 Email Connection')).toBeInTheDocument()
    expect(screen.getByText('Azure AD / Entra ID Credentials')).toBeInTheDocument()
  })
})
