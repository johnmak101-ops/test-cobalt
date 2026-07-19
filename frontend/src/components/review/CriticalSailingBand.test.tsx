import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CriticalSailingBand } from './CriticalSailingBand'

describe('CriticalSailingBand', () => {
  it('renders nothing when items empty', () => {
    const { container } = render(
      <CriticalSailingBand items={[]} editing={false} drafts={{}} onDraftChange={vi.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('lists missing and conflict rows', () => {
    render(
      <CriticalSailingBand
        items={[
          { kind: 'missing', column: 'cargoReadyDate', label: 'Cargo Ready Date' },
          {
            kind: 'conflict',
            column: 'etd',
            label: 'ETD',
            field: 'etd',
            summary: '2026-07-01 vs 2026-07-05',
          },
        ]}
        editing={false}
        drafts={{}}
        onDraftChange={vi.fn()}
      />,
    )
    expect(screen.getByTestId('critical-sailing')).toBeInTheDocument()
    expect(screen.getByText(/Cargo Ready Date/i)).toBeInTheDocument()
    expect(screen.getByText(/not set/i)).toBeInTheDocument()
    expect(screen.getByText(/2026-07-01 vs 2026-07-05/)).toBeInTheDocument()
    // Subtitle lists only open fields (not the full Booking/SO/CRD/ETD/ATD legend)
    expect(screen.getByText(/CRD · ETD/i)).toBeInTheDocument()
    expect(screen.queryByText(/Booking, SO, CRD, ETD, ATD/i)).not.toBeInTheDocument()
  })

  it('shows input for missing rows when editing', () => {
    render(
      <CriticalSailingBand
        items={[{ kind: 'missing', column: 'bookingNo', label: 'Booking No.' }]}
        editing
        drafts={{ bookingNo: '' }}
        onDraftChange={vi.fn()}
      />,
    )
    expect(screen.getByRole('textbox', { name: /booking no/i })).toBeInTheDocument()
  })

  it('does not show input for conflict rows (resolved in conflict table)', () => {
    render(
      <CriticalSailingBand
        items={[
          {
            kind: 'conflict',
            column: 'etd',
            label: 'ETD',
            field: 'etd',
            summary: 'a vs b',
          },
        ]}
        editing
        drafts={{}}
        onDraftChange={vi.fn()}
      />,
    )
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getByText(/resolve in field conflicts/i)).toBeInTheDocument()
  })
})
