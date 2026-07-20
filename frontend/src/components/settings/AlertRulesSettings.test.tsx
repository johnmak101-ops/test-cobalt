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
          description: 'Awaiting booking confirmation from forwarder',
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
          name: 'Draft B/L before cut-off',
          description: 'Cut-off tomorrow — confirm cargo delivery status',
          state: 'CONFIRMED',
          triggerType: 'days_before',
          triggerReference: 'cutoff',
          thresholdDays: 1,
          countryThresholds: null,
          severity: 'WARNING',
          enabled: true,
          locked: false,
        },
        {
          id: 'A3',
          name: 'Cut-off passed, no Draft B/L',
          description: 'Cut-off passed — cargo may have missed the vessel',
          state: 'CONFIRMED',
          triggerType: 'days_after',
          triggerReference: 'cutoff',
          thresholdDays: 0,
          countryThresholds: null,
          severity: 'CRITICAL',
          enabled: true,
          locked: false,
        },
        {
          id: 'A4',
          name: 'No Final B/L after Draft',
          description: 'Awaiting departure confirmation',
          state: 'AT_WAREHOUSE',
          triggerType: 'days_after',
          triggerReference: 'draft_bl',
          thresholdDays: 5,
          countryThresholds: null,
          severity: 'WARNING',
          enabled: true,
          locked: false,
        },
        {
          id: 'A5',
          name: 'No Telex after Final B/L',
          description: 'Awaiting telex release',
          state: 'SAILED',
          triggerType: 'days_after',
          triggerReference: 'final_bl',
          thresholdDays: 7,
          countryThresholds: null,
          severity: 'INFO',
          enabled: true,
          locked: false,
        },
        {
          id: 'A6',
          name: 'No delivery after ETA',
          description: 'Vessel should have arrived',
          state: 'RELEASED',
          triggerType: 'days_after',
          triggerReference: 'eta',
          thresholdDays: 3,
          countryThresholds: null,
          severity: 'INFO',
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
  it('renders A1–A6 and hides locked built-in A7', async () => {
    renderWithClient(<AlertRulesSettings />)
    expect(await screen.findByText('No SO after booking')).toBeInTheDocument()
    expect(screen.getByText('Draft B/L before cut-off')).toBeInTheDocument()
    expect(screen.getByText('Cut-off passed, no Draft B/L')).toBeInTheDocument()
    expect(screen.getByText('No Final B/L after Draft')).toBeInTheDocument()
    expect(screen.getByText('No Telex after Final B/L')).toBeInTheDocument()
    expect(screen.getByText('No delivery after ETA')).toBeInTheDocument()
    expect(screen.queryByText(/cargo-ready revision/i)).toBeNull()
  })

  it('shows country day grid only for A2 and A3', async () => {
    renderWithClient(<AlertRulesSettings />)
    await screen.findByText('No SO after booking')
    // A2 + A3 only
    expect(screen.getAllByText('Days by origin country')).toHaveLength(2)
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
          triggerReference: 'booking_request',
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
    expect(screen.queryByText(/^When:/)).toBeNull()
  })
})
