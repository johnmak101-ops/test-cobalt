import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AlertRulesSettings } from './AlertRulesSettings'

vi.mock('../../lib/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({
      rules: [
        {
          id: 'A1',
          name: 'No Draft BOL received',
          description: 'Warning',
          state: null,
          triggerType: 'days_after',
          triggerReference: 'etd',
          thresholdDays: 1,
          countryThresholds: null,
          severity: 'WARNING',
          enabled: true,
          locked: false,
        },
        {
          id: 'A2',
          name: 'No Draft BOL received',
          description: 'Severe',
          state: null,
          triggerType: 'days_after',
          triggerReference: 'etd',
          thresholdDays: 2,
          countryThresholds: null,
          severity: 'CRITICAL',
          enabled: true,
          locked: false,
        },
        {
          id: 'A3',
          name: 'No Final BOL received',
          description: 'Warning',
          state: null,
          triggerType: 'days_after',
          triggerReference: 'etd',
          thresholdDays: 3,
          countryThresholds: null,
          severity: 'WARNING',
          enabled: true,
          locked: false,
        },
        {
          id: 'A4',
          name: 'No Final BOL received',
          description: 'Severe',
          state: null,
          triggerType: 'days_after',
          triggerReference: 'etd',
          thresholdDays: 7,
          countryThresholds: null,
          severity: 'CRITICAL',
          enabled: true,
          locked: false,
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

describe('AlertRulesSettings — 2 customer rules', () => {
  it('shows exactly two product cards: Draft BOL and Final BOL', async () => {
    renderWithClient(<AlertRulesSettings />)
    expect(await screen.findByText('No Draft BOL received')).toBeInTheDocument()
    expect(screen.getByText('No Final BOL received')).toBeInTheDocument()
    expect(screen.getAllByText(/Warning — days after ETD/i)).toHaveLength(2)
    expect(screen.getAllByText(/Severe — days after ETD/i)).toHaveLength(2)
    expect(screen.queryByText(/No SO after booking/i)).toBeNull()
    expect(screen.queryByText(/Telex/i)).toBeNull()
  })

  it('country of origin only China, Bangladesh, Cambodia (×2 cards)', async () => {
    renderWithClient(<AlertRulesSettings />)
    await screen.findByText('No Draft BOL received')
    expect(screen.getAllByText('China')).toHaveLength(2)
    expect(screen.getAllByText('Bangladesh')).toHaveLength(2)
    expect(screen.getAllByText('Cambodia')).toHaveLength(2)
    expect(screen.queryByText('Vietnam')).toBeNull()
    expect(screen.queryByText('India')).toBeNull()
  })

  it('+/− buttons raise warning and keep severe strictly after warning', async () => {
    const user = userEvent.setup()
    renderWithClient(<AlertRulesSettings />)
    await screen.findByText('No Draft BOL received')
    // Draft warning stepper is first "Increase days" among draft controls
    const increases = screen.getAllByRole('button', { name: /increase days/i })
    // First product: warn +, severe +  → indices 0,1 then country steppers...
    await user.click(increases[0]!) // warn 1 → 2; severe was 2 → bumps to 3
    // Values appear as textbox values
    const warnInput = screen.getByRole('textbox', {
      name: /No Draft BOL received warning days after ETD value/i,
    })
    const severeInput = screen.getByRole('textbox', {
      name: /No Draft BOL received severe days after ETD value/i,
    })
    expect(warnInput).toHaveValue('2')
    expect(severeInput).toHaveValue('3')
  })
})
