import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { VendorsSettings } from './SettingsPage'

// Vendors are a read-only Cobalt Mesh mirror; the only real backend route (and the only hook) is GET /vendors.
vi.mock('../hooks/use-vendors', () => ({
  useVendors: () => ({
    data: {
      vendors: [
        { id: 'v1', name: 'Shenzhen Textile Co', type: 'factory', location: 'Shenzhen', contactEmail: null, contactPhone: null, notes: null, createdAt: '', updatedAt: '' },
      ],
    },
    isLoading: false,
  }),
}))

describe('VendorsSettings — read-only (vendors are a Cobalt Mesh mirror)', () => {
  it('lists vendors but exposes NO write buttons (Add/CSV/Delete all hit routes that 404)', () => {
    render(<VendorsSettings />)
    expect(screen.getByText('Shenzhen Textile Co')).toBeInTheDocument()
    // read-only: no Add Vendor / CSV Import / per-row Delete buttons
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })
})
