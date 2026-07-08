import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { PageAccessRoute } from './PageAccessRoute'

let level: 'none' | 'view' | 'edit' = 'view'
vi.mock('../hooks/use-page-access', () => ({
  usePageAccess: () => ({ levelFor: () => level, canEdit: () => level === 'edit', canView: () => level !== 'none', loading: false }),
}))

function renderAt(page: string) {
  return render(
    <MemoryRouter initialEntries={['/settings/x']}>
      <Routes>
        <Route path="/" element={<div>HOME</div>} />
        <Route path="/settings/x" element={<PageAccessRoute page={page}>PANEL</PageAccessRoute>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('PageAccessRoute', () => {
  it('renders the page when level is view or edit', () => {
    level = 'view'
    renderAt('alert_rules')
    expect(screen.getByText('PANEL')).toBeInTheDocument()
  })

  it('redirects home when level is none', () => {
    level = 'none'
    renderAt('alert_rules')
    expect(screen.getByText('HOME')).toBeInTheDocument()
    expect(screen.queryByText('PANEL')).not.toBeInTheDocument()
  })
})
