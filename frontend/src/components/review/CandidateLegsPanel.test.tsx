import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CandidateLegsPanel } from './CandidateLegsPanel'
import type { MatchAmbiguity } from '../../lib/critic-review'

const amb: MatchAmbiguity = {
  kind: 'multi_candidate',
  emailKey: { so_no: 'SO1', container_no: 'CTR-SAME' },
  candidateCount: 2,
  sharedContainer: 'CTR-SAME',
  candidates: [
    {
      shipmentId: 'id-a',
      jobNo: 'JOB-A',
      booking_no: 'BK1',
      so_no: 'SO1',
      hbl_awb_fcr_no: 'H1',
      container_no: 'CTR-SAME',
      matchedBy: 'strong_key',
      etd: '2026-07-10T00:00:00.000Z',
    },
    {
      shipmentId: 'id-b',
      jobNo: 'JOB-B',
      booking_no: 'BK2',
      so_no: 'SO2',
      hbl_awb_fcr_no: 'H2',
      container_no: 'CTR-SAME',
      matchedBy: 'strong_key',
    },
  ],
}

describe('CandidateLegsPanel (#129)', () => {
  it('renders both jobs and 拼櫃 banner; no Use selected leg button', () => {
    const onSelect = vi.fn()
    render(
      <CandidateLegsPanel matchAmbiguity={amb} selectedId={null} onSelect={onSelect} />,
    )
    expect(screen.getByTestId('candidate-legs-panel')).toBeTruthy()
    expect(screen.getByTestId('shared-container-banner').textContent).toMatch(/拼櫃|CTR-SAME/)
    expect(screen.getByText('JOB-A')).toBeTruthy()
    expect(screen.getByText('JOB-B')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Use selected leg/i })).toBeNull()
    expect(screen.queryByText(/matched:/i)).toBeNull()
  })

  it('formats ETD for humans (not raw ISO)', () => {
    render(
      <CandidateLegsPanel matchAmbiguity={amb} selectedId={null} onSelect={vi.fn()} />,
    )
    expect(screen.queryByText(/2026-07-10T00:00:00/)).toBeNull()
    expect(screen.getByText(/ETD 10 Jul 2026/i)).toBeTruthy()
  })

  it('calls onSelect when a radio is chosen', () => {
    const onSelect = vi.fn()
    render(
      <CandidateLegsPanel matchAmbiguity={amb} selectedId={null} onSelect={onSelect} />,
    )
    fireEvent.click(screen.getByLabelText(/Select JOB-B/i))
    expect(onSelect).toHaveBeenCalledWith('id-b')
  })
})
