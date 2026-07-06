import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { AppShell } from './AppShell'
import { useUIStore } from '../../store'

// The shell pulls in several react-query data hooks via Sidebar + TopBar.
// Mock them so we can render the shell in jsdom without a network/provider.
vi.mock('../../hooks/use-auth', () => ({
  useAuth: () => ({
    user: { name: 'Test User', role: 'SUPERADMIN', email: 't@e.com', avatarInitials: 'TU' },
    logout: vi.fn(),
  }),
}))
vi.mock('../../hooks/use-review-queue', () => ({
  useReviewQueue: () => ({ data: { shipments: [] } }),
  useReviewCounts: () => ({ data: { provisional: 0 } }),
}))
vi.mock('../../hooks/use-alerts', () => ({
  useAlerts: () => ({ data: { alerts: [] } }),
  useMarkAlertRead: () => ({ mutate: vi.fn() }),
}))
vi.mock('../../hooks/use-emails', () => ({
  useEmails: () => ({ data: { emails: [] } }),
  useUnreadCount: () => ({ data: { unread: 0 } }),
}))
vi.mock('../../hooks/use-documents', () => ({
  useDocumentCount: () => 0,
}))

function renderShell(initialPath = '/') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<div>Dashboard content</div>} />
          <Route path="/shipments" element={<div>Shipments content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

const hamburger = () => screen.getByRole('button', { name: /open navigation/i })
const backdrop = () => screen.queryByTestId('mobile-nav-backdrop')

beforeEach(() => {
  useUIStore.setState({ mobileNavOpen: false, sidebarCollapsed: false })
  document.body.style.overflow = ''
})

describe('AppShell — responsive mobile navigation drawer', () => {
  it('is closed on mount: no backdrop, sidebar translated off-canvas', () => {
    const { container } = renderShell()
    expect(useUIStore.getState().mobileNavOpen).toBe(false)
    expect(backdrop()).not.toBeInTheDocument()
    expect(container.querySelector('aside')?.className).toContain('-translate-x-full')
  })

  it('opens the drawer when the hamburger is clicked', async () => {
    const user = userEvent.setup()
    renderShell()
    await user.click(hamburger())
    expect(useUIStore.getState().mobileNavOpen).toBe(true)
    expect(backdrop()).toBeInTheDocument()
  })

  it('closes the drawer when the backdrop is clicked', async () => {
    const user = userEvent.setup()
    renderShell()
    await user.click(hamburger())
    await user.click(backdrop()!)
    expect(useUIStore.getState().mobileNavOpen).toBe(false)
    expect(backdrop()).not.toBeInTheDocument()
  })

  it('closes the drawer when Escape is pressed', async () => {
    const user = userEvent.setup()
    renderShell()
    await user.click(hamburger())
    await user.keyboard('{Escape}')
    expect(useUIStore.getState().mobileNavOpen).toBe(false)
  })

  it('closes the drawer after navigating via a drawer link', async () => {
    const user = userEvent.setup()
    renderShell()
    await user.click(hamburger())
    await user.click(screen.getByRole('link', { name: /shipments/i }))
    expect(useUIStore.getState().mobileNavOpen).toBe(false)
    expect(screen.getByText('Shipments content')).toBeInTheDocument()
  })

  it('hides the hamburger at desktop widths (lg:hidden)', () => {
    renderShell()
    expect(hamburger().className).toContain('lg:hidden')
  })
})

describe('AppShell — content margin is breakpoint-gated', () => {
  it('gates the expanded content margin behind lg (lg:ml-56), not an unconditional ml-56', () => {
    const { container } = renderShell()
    const html = container.innerHTML
    expect(html).toContain('lg:ml-56')
    // Must NOT push content by a fixed desktop margin on mobile.
    expect(html).not.toMatch(/class="[^"]*(?<!lg:)\bml-56\b/)
  })

  it('switches the gated margin to lg:ml-16 when the sidebar is collapsed', async () => {
    const user = userEvent.setup()
    const { container } = renderShell()
    await user.click(screen.getByRole('button', { name: /collapse sidebar/i }))
    expect(useUIStore.getState().sidebarCollapsed).toBe(true)
    expect(container.innerHTML).toContain('lg:ml-16')
  })
})
