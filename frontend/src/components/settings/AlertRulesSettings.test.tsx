import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AlertRulesSettings } from './AlertRulesSettings'

vi.mock('../../lib/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({
      rules: [
        {
          id: 'A1',
          name: 'No SO after booking',
          description: 'SO not received in time',
          state: 'BOOKED',
          triggerType: 'days_after',
          triggerReference: 'booking_request',
          thresholdDays: 2,
          countryThresholds: null,
          severity: 'WARNING',
          enabled: true,
          locked: false,
        },
        {
          id: 'A2',
          name: 'Draft B/L before cutoff',
          description: 'Draft B/L window',
          state: 'CONFIRMED',
          triggerType: 'days_before',
          triggerReference: 'cutoff',
          thresholdDays: 3,
          countryThresholds: null,
          severity: 'WARNING',
          enabled: true,
          locked: false,
        },
        {
          id: 'A7',
          name: 'Requested cargo-ready revision not reflected',
          description: 'Built-in CRD check',
          state: null,
          triggerType: 'days_after',
          triggerReference: 'booking_request',
          thresholdDays: 0,
          countryThresholds: null,
          severity: 'WARNING',
          enabled: true,
          locked: true,
        },
      ],
    }),
    put: vi.fn(),
  },
}))

vi.mock('../../hooks/use-page-access', () => ({
  usePageAccess: () => ({ canEdit: () => true, canView: () => true }),
}))

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

describe('AlertRulesSettings', () => {
  it('renders only A1 and A2 — hides locked built-ins (A7)', async () => {
    renderWithClient(<AlertRulesSettings />)
    expect(await screen.findByText('No SO after booking')).toBeInTheDocument()
    expect(screen.getByText('Draft B/L before cutoff')).toBeInTheDocument()
    expect(screen.queryByText(/cargo-ready revision/i)).toBeNull()
    expect(screen.queryByText('LOCKED')).toBeNull()
    // Absolute per-country days (overwrite default)
    expect(screen.getAllByText('Days by origin country').length).toBe(2)
  })

  it('does not crash when a configurable rule has null state', async () => {
    const { api } = await import('../../lib/api')
    vi.mocked(api.get).mockResolvedValueOnce({
      rules: [
        {
          id: 'A1',
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
    // null state is omitted from header (no "When: —" chip)
    expect(screen.queryByText(/^When:/)).toBeNull()
  })
})

