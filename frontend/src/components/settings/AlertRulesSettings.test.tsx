import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AlertRulesSettings } from './AlertRulesSettings'

vi.mock('../../lib/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({
      rules: [
        {
          id: 'IN_TRANSIT_LATE',
          name: 'In-transit running late',
          description: 'Vessel behind schedule',
          state: 'IN_TRANSIT',
          triggerType: 'days_after',
          triggerReference: 'etd',
          thresholdDays: 3,
          countryThresholds: null,
          severity: 'WARNING',
          enabled: true,
          locked: false,
        },
      ],
    }),
    put: vi.fn(),
  },
}))

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

describe('AlertRulesSettings', () => {
  it('renders each configured alert rule fetched from /alert-rules', async () => {
    renderWithClient(<AlertRulesSettings />)
    expect(await screen.findByText('In-transit running late')).toBeInTheDocument()
    // The per-country warning-days editor is part of this section's behavior.
    expect(await screen.findByText('Country warning days')).toBeInTheDocument()
  })

  it('does not crash when a rule has null state (API allows null staircase mapping)', async () => {
    const { api } = await import('../../lib/api')
    vi.mocked(api.get).mockResolvedValueOnce({
      rules: [
        {
          id: 'NULL_STATE',
          name: 'Rule with no state',
          description: null,
          state: null,
          triggerType: 'days_after',
          triggerReference: 'etd',
          thresholdDays: 1,
          countryThresholds: null,
          severity: 'INFO',
          enabled: true,
          locked: false,
        },
      ],
    })
    renderWithClient(<AlertRulesSettings />)
    expect(await screen.findByText('Rule with no state')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
  })
})
