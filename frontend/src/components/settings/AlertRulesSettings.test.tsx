import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AlertRulesSettings } from './AlertRulesSettings'
import { api } from '../../lib/api'

const baseRules = [
  {
    id: 'A1',
    name: 'No Draft BOL received',
    description: 'Warning',
    state: null,
    triggerType: 'days_after',
    triggerReference: 'etd',
    thresholdDays: 1,
    countryThresholds: null as Record<string, number> | null,
    severity: 'WARNING',
    enabled: true,
    locked: false,
  },
  {
    id: 'A2',
    name: 'No Draft BOL received',
    description: 'Critical',
    state: null,
    triggerType: 'days_after',
    triggerReference: 'etd',
    thresholdDays: 2,
    countryThresholds: null as Record<string, number> | null,
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
    countryThresholds: null as Record<string, number> | null,
    severity: 'WARNING',
    enabled: true,
    locked: false,
  },
  {
    id: 'A4',
    name: 'No Final BOL received',
    description: 'Critical',
    state: null,
    triggerType: 'days_after',
    triggerReference: 'etd',
    thresholdDays: 7,
    countryThresholds: null as Record<string, number> | null,
    severity: 'CRITICAL',
    enabled: true,
    locked: false,
  },
]

vi.mock('../../lib/api', () => ({
  api: {
    get: vi.fn(),
    put: vi.fn(),
  },
}))

vi.mock('../../hooks/use-page-access', () => ({
  usePageAccess: () => ({ canEdit: () => true, canView: () => true }),
}))

vi.mock('../ui/Toast', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.get).mockResolvedValue({ rules: structuredClone(baseRules) })
  vi.mocked(api.put).mockResolvedValue({ rules: structuredClone(baseRules), eval: null })
})

describe('AlertRulesSettings — 2 customer rules', () => {
  it('shows two product cards with Warning + Critical (not Severe) day labels', async () => {
    renderWithClient(<AlertRulesSettings />)
    expect(await screen.findByText('No Draft BOL received')).toBeInTheDocument()
    expect(screen.getByText('No Final BOL received')).toBeInTheDocument()
    expect(screen.getAllByText(/Warning — days after ETD/i)).toHaveLength(2)
    expect(screen.getAllByText(/Critical — days after ETD/i)).toHaveLength(2)
    expect(screen.queryByText(/Severe — days after ETD/i)).toBeNull()
    expect(screen.queryByText(/No SO after booking/i)).toBeNull()
  })

  it('country of origin only China, Bangladesh, Cambodia (×2 cards)', async () => {
    renderWithClient(<AlertRulesSettings />)
    await screen.findByText('No Draft BOL received')
    expect(screen.getAllByText('China')).toHaveLength(2)
    expect(screen.getAllByText('Bangladesh')).toHaveLength(2)
    expect(screen.getAllByText('Cambodia')).toHaveLength(2)
    expect(screen.queryByText('Vietnam')).toBeNull()
  })
})

describe('AlertRulesSettings — each control takes effect', () => {
  it('warning + button raises days and keeps critical strictly after warning', async () => {
    const user = userEvent.setup()
    renderWithClient(<AlertRulesSettings />)
    await screen.findByText('No Draft BOL received')

    const warnInput = screen.getByRole('textbox', {
      name: /No Draft BOL received warning days after ETD value/i,
    })
    const criticalInput = screen.getByRole('textbox', {
      name: /No Draft BOL received critical days after ETD value/i,
    })
    expect(warnInput).toHaveValue('1')
    expect(criticalInput).toHaveValue('2')

    // First product warn stepper is the first "Increase days" for that card
    const draftCard = screen.getByText('No Draft BOL received').closest('.overflow-hidden') as HTMLElement
    const increases = within(draftCard).getAllByRole('button', { name: /increase days/i })
    await user.click(increases[0]!) // warn 1→2; critical was 2 → bumps to 3

    expect(warnInput).toHaveValue('2')
    expect(criticalInput).toHaveValue('3')
  })

  it('critical − button lowers days and pulls warning down when needed', async () => {
    const user = userEvent.setup()
    renderWithClient(<AlertRulesSettings />)
    await screen.findByText('No Draft BOL received')
    const draftCard = screen.getByText('No Draft BOL received').closest('.overflow-hidden') as HTMLElement
    const decreases = within(draftCard).getAllByRole('button', { name: /decrease days/i })
    // critical is second pair stepper (index 1)
    await user.click(decreases[1]!) // critical 2→1; warning was 1 → bumps to 0
    const warnInput = screen.getByRole('textbox', {
      name: /No Draft BOL received warning days after ETD value/i,
    })
    const criticalInput = screen.getByRole('textbox', {
      name: /No Draft BOL received critical days after ETD value/i,
    })
    expect(criticalInput).toHaveValue('1')
    expect(warnInput).toHaveValue('0')
  })

  it('typing into critical days input live-updates the value', async () => {
    const user = userEvent.setup()
    renderWithClient(<AlertRulesSettings />)
    await screen.findByText('No Draft BOL received')
    const criticalInput = screen.getByRole('textbox', {
      name: /No Draft BOL received critical days after ETD value/i,
    })
    await user.clear(criticalInput)
    await user.type(criticalInput, '5')
    expect(criticalInput).toHaveValue('5')
    // warning stays 1 (5 > 1)
    expect(
      screen.getByRole('textbox', {
        name: /No Draft BOL received warning days after ETD value/i,
      }),
    ).toHaveValue('1')
  })

  it('enable toggle flips both warn and critical rows and enables Save', async () => {
    const user = userEvent.setup()
    renderWithClient(<AlertRulesSettings />)
    await screen.findByText('No Draft BOL received')
    const toggle = screen.getByRole('button', { name: /Toggle No Draft BOL received enabled/i })
    await user.click(toggle)
    const save = screen.getByRole('button', { name: /Save changes/i })
    expect(save).not.toBeDisabled()
    await user.click(save)
    await waitFor(() => expect(api.put).toHaveBeenCalled())
    const body = vi.mocked(api.put).mock.calls[0]![1] as { rules: Array<{ id: string; enabled: boolean }> }
    const a1 = body.rules.find((r) => r.id === 'A1')
    const a2 = body.rules.find((r) => r.id === 'A2')
    expect(a1?.enabled).toBe(false)
    expect(a2?.enabled).toBe(false)
  })

  it('country China + sets absolute days on both A1 warn and A2 critical (+delta)', async () => {
    const user = userEvent.setup()
    renderWithClient(<AlertRulesSettings />)
    await screen.findByText('No Draft BOL received')
    const draftCard = screen.getByText('No Draft BOL received').closest('.overflow-hidden') as HTMLElement
    // Scope to Draft card — Final card also has a China stepper.
    const cnGroup = within(draftCard).getByRole('group', { name: /China days after ETD/i })
    await user.click(within(cnGroup).getByRole('button', { name: /increase days/i }))
    // Default → 1; UI should leave Default mode
    await waitFor(() => {
      expect(within(cnGroup).queryByText('Default')).toBeNull()
    })
    const save = screen.getByRole('button', { name: /Save changes/i })
    await user.click(save)
    await waitFor(() => expect(api.put).toHaveBeenCalled())
    const body = vi.mocked(api.put).mock.calls.at(-1)![1] as {
      rules: Array<{ id: string; countryThresholds: Record<string, number> | null }>
    }
    const a1 = body.rules.find((r) => r.id === 'A1')
    const a2 = body.rules.find((r) => r.id === 'A2')
    // Draft defaults 1/2 → delta 1; CN absolute warn day 1 → critical 2
    expect(a1?.countryThresholds?.CN).toBe(1)
    expect(a2?.countryThresholds?.CN).toBe(2)
  })

  it('Save payload pins A2/A4 severity to CRITICAL and A1/A3 to WARNING', async () => {
    const user = userEvent.setup()
    // Poison severities in GET to prove save re-pins
    vi.mocked(api.get).mockResolvedValue({
      rules: baseRules.map((r) =>
        r.id === 'A2' || r.id === 'A4' ? { ...r, severity: 'WARNING' } : { ...r },
      ),
    })
    renderWithClient(<AlertRulesSettings />)
    await screen.findByText('No Draft BOL received')
    const warnInput = screen.getByRole('textbox', {
      name: /No Draft BOL received warning days after ETD value/i,
    })
    await user.clear(warnInput)
    await user.type(warnInput, '2')
    await waitFor(() => expect(warnInput).toHaveValue('2'))
    await user.click(screen.getByRole('button', { name: /Save changes/i }))
    await waitFor(() => expect(api.put).toHaveBeenCalled())
    const body = vi.mocked(api.put).mock.calls.at(-1)![1] as {
      rules: Array<{ id: string; severity: string; thresholdDays: number }>
    }
    expect(body.rules.find((r) => r.id === 'A1')?.severity).toBe('WARNING')
    expect(body.rules.find((r) => r.id === 'A2')?.severity).toBe('CRITICAL')
    expect(body.rules.find((r) => r.id === 'A3')?.severity).toBe('WARNING')
    expect(body.rules.find((r) => r.id === 'A4')?.severity).toBe('CRITICAL')
    // Day change persisted (warn typed 2 → critical pair bumps to ≥3)
    expect(body.rules.find((r) => r.id === 'A1')?.thresholdDays).toBe(2)
    expect(body.rules.find((r) => r.id === 'A2')?.thresholdDays).toBeGreaterThanOrEqual(3)
  })

  it('Discard reverts day edits to server values', async () => {
    const user = userEvent.setup()
    renderWithClient(<AlertRulesSettings />)
    await screen.findByText('No Draft BOL received')
    const warnInput = screen.getByRole('textbox', {
      name: /No Draft BOL received warning days after ETD value/i,
    })
    const draftCard = screen.getByText('No Draft BOL received').closest('.overflow-hidden') as HTMLElement
    await user.click(within(draftCard).getAllByRole('button', { name: /increase days/i })[0]!)
    expect(warnInput).toHaveValue('2')
    await user.click(screen.getByRole('button', { name: /Discard/i }))
    expect(warnInput).toHaveValue('1')
  })

  it('Final BOL pair has independent defaults (3 / 7) and + works', async () => {
    const user = userEvent.setup()
    renderWithClient(<AlertRulesSettings />)
    await screen.findByText('No Final BOL received')
    const warnInput = screen.getByRole('textbox', {
      name: /No Final BOL received warning days after ETD value/i,
    })
    const criticalInput = screen.getByRole('textbox', {
      name: /No Final BOL received critical days after ETD value/i,
    })
    expect(warnInput).toHaveValue('3')
    expect(criticalInput).toHaveValue('7')
    const finalCard = screen.getByText('No Final BOL received').closest('.overflow-hidden') as HTMLElement
    await user.click(within(finalCard).getAllByRole('button', { name: /increase days/i })[0]!)
    expect(warnInput).toHaveValue('4')
    expect(criticalInput).toHaveValue('7') // still > 4
  })
})
