import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import SettingsPage from './SettingsPage'

const mockUser = { role: 'ADMIN' }
vi.mock('../hooks/use-auth', () => ({ useAuth: () => ({ user: mockUser, loading: false }) }))
// Access-granted view for the governed config pages (what the backend returns for an ADMIN/superadmin).
vi.mock('../hooks/use-page-access', () => ({
  usePageAccess: () => ({ canView: () => true, canEdit: () => true, levelFor: () => 'edit', loading: false }),
}))
vi.mock('../components/settings/UsersSettings', () => ({ UsersSettings: () => <div>users</div> }))
vi.mock('../components/settings/AlertRulesSettings', () => ({ AlertRulesSettings: () => <div>alerts</div> }))
vi.mock('../components/settings/LifecycleSettings', () => ({ LifecycleSettings: () => <div>lifecycle</div> }))
vi.mock('../components/settings/AccessControlSettings', () => ({ AccessControlSettings: () => <div>access</div> }))

describe('SettingsPage nav (access-aware)', () => {
  it('an ADMIN sees access-granted config tabs (Alert Rules) but not superadmin-only or removed tabs', () => {
    mockUser.role = 'ADMIN'
    render(<MemoryRouter initialEntries={['/settings/alerts']}><SettingsPage /></MemoryRouter>)
    expect(screen.getByRole('link', { name: /alert rules/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /resolution rules/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /lifecycle/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^users$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /access control/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /mesh misses/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^vendors$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /review policy/i })).not.toBeInTheDocument()
  })
  it('Lifecycle is its own SUPERADMIN-only tab and renders alone on its route', () => {
    mockUser.role = 'SUPERADMIN'
    render(<MemoryRouter initialEntries={['/settings/lifecycle']}><SettingsPage /></MemoryRouter>)
    expect(screen.getByRole('link', { name: /lifecycle/i })).toBeInTheDocument()
    expect(screen.getByText('lifecycle')).toBeInTheDocument()
    expect(screen.queryByText('alerts')).not.toBeInTheDocument()
  })
  it('an ADMIN on the lifecycle route gets neither the tab nor the card', () => {
    mockUser.role = 'ADMIN'
    render(<MemoryRouter initialEntries={['/settings/lifecycle']}><SettingsPage /></MemoryRouter>)
    expect(screen.queryByRole('link', { name: /lifecycle/i })).not.toBeInTheDocument()
    expect(screen.queryByText('lifecycle')).not.toBeInTheDocument()
  })
  it('an EDITOR neither sees the Lifecycle tab nor its card on the alerts tab', () => {
    mockUser.role = 'EDITOR'
    render(<MemoryRouter initialEntries={['/settings/alerts']}><SettingsPage /></MemoryRouter>)
    expect(screen.queryByRole('link', { name: /lifecycle/i })).not.toBeInTheDocument()
    expect(screen.queryByText('lifecycle')).not.toBeInTheDocument()
    expect(screen.getByText('alerts')).toBeInTheDocument()
  })
  it('a SUPERADMIN sees Users, Access Control, Mesh misses but not Resolution, Vendors, or Review Policy', () => {
    mockUser.role = 'SUPERADMIN'
    render(<MemoryRouter initialEntries={['/settings/users']}><SettingsPage /></MemoryRouter>)
    expect(screen.queryByRole('link', { name: /^general$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /resolution rules/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /^users$/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /access control/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /mesh misses/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^vendors$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /review policy/i })).not.toBeInTheDocument()
  })
})
