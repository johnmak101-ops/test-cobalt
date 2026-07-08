import { describe, it, expect, vi } from 'vitest'
import type { ReactElement } from 'react'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AccessControlSettings } from './AccessControlSettings'

vi.mock('../../lib/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({
      pages: [
        { id: 'alert_rules', label: 'Alert Rules', levels: { VIEWER: 'view', EDITOR: 'view', ADMIN: 'edit' } },
        { id: 'resolution_rules', label: 'Resolution Rules', levels: { VIEWER: 'none', EDITOR: 'none', ADMIN: 'edit' } },
      ],
    }),
    put: vi.fn().mockResolvedValue({ pages: [] }),
  },
}))

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

describe('AccessControlSettings', () => {
  it('renders a row per governed page with a level select per role', async () => {
    renderWithClient(<AccessControlSettings />)
    expect(await screen.findByText('Alert Rules')).toBeInTheDocument()
    expect(screen.getByText('Resolution Rules')).toBeInTheDocument()
    const coordinatorAlert = screen.getByLabelText('Alert Rules — Coordinator') as HTMLSelectElement
    expect(coordinatorAlert.value).toBe('view')
    const managerResolution = screen.getByLabelText('Resolution Rules — Manager') as HTMLSelectElement
    expect(managerResolution.value).toBe('none')
  })
})
