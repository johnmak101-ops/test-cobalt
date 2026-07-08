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
vi.mock('../components/settings/ResolutionRulesSettings', () => ({ ResolutionRulesSettings: () => <div>resolution-tab</div> }))
vi.mock('../components/settings/UsersSettings', () => ({ UsersSettings: () => <div>users</div> }))
vi.mock('../components/settings/VendorsSettings', () => ({ VendorsSettings: () => <div>vendors</div> }))
vi.mock('../components/settings/AlertRulesSettings', () => ({ AlertRulesSettings: () => <div>alerts</div> }))
vi.mock('../components/settings/AccessControlSettings', () => ({ AccessControlSettings: () => <div>access</div> }))

describe('SettingsPage nav (access-aware)', () => {
  it('an ADMIN sees access-granted config tabs (Alert Rules, Resolution) but not superadmin-only tabs', () => {
    mockUser.role = 'ADMIN'
    render(<MemoryRouter initialEntries={['/settings/resolution']}><SettingsPage /></MemoryRouter>)
    expect(screen.getByRole('link', { name: /resolution rules/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /alert rules/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^users$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /access control/i })).not.toBeInTheDocument()
  })
  it('a SUPERADMIN sees every tab, including Access Control', () => {
    mockUser.role = 'SUPERADMIN'
    render(<MemoryRouter initialEntries={['/settings']}><SettingsPage /></MemoryRouter>)
    expect(screen.getByRole('link', { name: /resolution rules/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /^users$/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /access control/i })).toBeInTheDocument()
  })
})
