import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AlertRulesSettings } from './AlertRulesSettings'
import { api } from '../../lib/api'

const rule = (over: Record<string, unknown> = {}) => ({
  id: 'A1',
  name: 'No Draft BOL received',
  description: 'Fires after ETD when Draft B/L is still missing',
  state: null,
  triggerType: 'days_after',
  triggerReference: 'etd',
  thresholdDays: 1,
  countryThresholds: null as Record<string, number> | null,
  severity: 'WARNING',
  enabled: true,
  locked: false,
  ...over,
})

// A2 (retired critical tier) and A7 (built-in) come back from the API locked — the UI must hide them.
const baseRules = [
  rule(),
  rule({
    id: 'A3',
    name: 'No Final BOL received',
    description: 'Fires after ETD when Final B/L is still missing',
    thresholdDays: 3,
  }),
  rule({ id: 'A2', severity: 'CRITICAL', enabled: false, locked: true }),
  rule({ id: 'A7', name: 'Requested cargo-ready revision not reflected', enabled: false, locked: true }),
]

vi.mock('../../lib/api', () => ({
  api: { get: vi.fn(), put: vi.fn(), post: vi.fn() },
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
  vi.mocked(api.get).mockResolvedValue({ rules: baseRules })
  vi.mocked(api.put).mockResolvedValue({ rules: baseRules, eval: null })
  vi.mocked(api.post).mockResolvedValue({ rules: baseRules, eval: null })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

describe('AlertRulesSettings — single-severity cards', () => {
  it('renders one card per non-locked rule and hides retired/locked rows', async () => {
    renderWithClient(<AlertRulesSettings />)
    expect(await screen.findByText('No Draft BOL received')).toBeInTheDocument()
    expect(screen.getByText('No Final BOL received')).toBeInTheDocument()
    expect(screen.queryByText('Requested cargo-ready revision not reflected')).toBeNull()
    // retired A2 shares A1's name — only ONE draft-BOL card may render
    expect(screen.getAllByText('No Draft BOL received')).toHaveLength(1)
    // no State field in the single-severity layout
    expect(screen.queryByText(/^state$/i)).toBeNull()
  })

  it('saves a trimmed payload with the chosen severity', async () => {
    const user = userEvent.setup()
    renderWithClient(<AlertRulesSettings />)
    await screen.findByText('No Draft BOL received')
    await user.selectOptions(screen.getByLabelText('No Draft BOL received severity'), 'CRITICAL')
    await user.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() => expect(api.put).toHaveBeenCalledOnce())
    const body = vi.mocked(api.put).mock.calls[0][1] as { rules: Array<Record<string, unknown>> }
    const a1 = body.rules.find((r) => r.id === 'A1')!
    expect(a1.severity).toBe('CRITICAL')
    expect(Object.keys(a1).sort()).toEqual(['countryThresholds', 'enabled', 'id', 'severity', 'thresholdDays'])
    // locked rows are never sent
    expect(body.rules.map((r) => r.id).sort()).toEqual(['A1', 'A3'])
  })

  it('sets a per-rule country override and sends it in days', async () => {
    const user = userEvent.setup()
    renderWithClient(<AlertRulesSettings />)
    await screen.findByText('No Final BOL received')
    const vn = screen.getByRole('group', { name: 'No Final BOL received — Vietnam days after ETD' })
    await user.click(within(vn).getByRole('button', { name: /increase days/i }))
    await user.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() => expect(api.put).toHaveBeenCalledOnce())
    const body = vi.mocked(api.put).mock.calls[0][1] as { rules: Array<Record<string, unknown>> }
    expect(body.rules.find((r) => r.id === 'A3')!.countryThresholds).toEqual({ VN: 1 })
    // the other rule keeps its own (empty) override map — overrides are per-rule
    expect(body.rules.find((r) => r.id === 'A1')!.countryThresholds).toBeNull()
  })

  it('Reset to defaults asks for confirmation then POSTs the reset endpoint', async () => {
    const user = userEvent.setup()
    renderWithClient(<AlertRulesSettings />)
    await screen.findByText('No Draft BOL received')
    await user.click(screen.getByRole('button', { name: /reset to defaults/i }))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/alert-rules/reset', {}))
  })

  it('does not reset when the confirm dialog is declined', async () => {
    vi.mocked(window.confirm).mockReturnValue(false)
    const user = userEvent.setup()
    renderWithClient(<AlertRulesSettings />)
    await screen.findByText('No Draft BOL received')
    await user.click(screen.getByRole('button', { name: /reset to defaults/i }))
    expect(api.post).not.toHaveBeenCalled()
  })
})
