import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ConflictRow } from './ConflictRow'
import type { CriticConflict } from '../../lib/critic-review'

const baseConflict: CriticConflict = {
  field: 'etd',
  label: 'ETD',
  rationale: 'Dates differ',
  candidates: [
    { value: '2026-07-01', source: 'system' },
    { value: '2026-07-05', source: 'agent' },
  ],
}

function renderRow(overrides: { critical?: boolean; conflict?: CriticConflict } = {}) {
  return render(
    <table>
      <tbody>
        <ConflictRow
          conflict={overrides.conflict ?? baseConflict}
          value="2026-07-05"
          onChange={vi.fn()}
          editing={false}
          critical={overrides.critical}
        />
      </tbody>
    </table>,
  )
}

describe('ConflictRow critical badge', () => {
  it('shows Critical badge when critical is true', () => {
    renderRow({ critical: true })
    expect(screen.getByTestId('conflict-critical-badge')).toHaveTextContent('Critical')
    expect(screen.getByText('ETD')).toBeInTheDocument()
  })

  it('hides Critical badge when critical is false or omitted', () => {
    renderRow({ critical: false })
    expect(screen.queryByTestId('conflict-critical-badge')).not.toBeInTheDocument()
  })
})
