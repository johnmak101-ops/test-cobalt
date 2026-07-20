import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CandidateLegsPanel, candidateBizKeyTitle } from './CandidateLegsPanel'
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

describe('CandidateLegsPanel (#129 / Hybrid-C E4)', () => {
  it('primary title is business keys, not JOB; JOB is secondary', () => {
    render(
      <CandidateLegsPanel matchAmbiguity={amb} selectedId={null} onSelect={vi.fn()} />,
    )
    expect(screen.getByTestId('candidate-legs-panel')).toBeTruthy()
    expect(screen.getByTestId('shared-container-banner').textContent).toMatch(/拼櫃|CTR-SAME/)
    expect(screen.getByTestId('candidate-biz-key-hint').textContent).toMatch(/JOB# is internal/)
    // Primary titles
    const titles = screen.getAllByTestId('candidate-biz-title').map((el) => el.textContent)
    expect(titles.some((t) => t?.includes('SO1') || t?.includes('BK1'))).toBe(true)
    expect(titles.some((t) => t?.includes('SO2') || t?.includes('BK2'))).toBe(true)
    // JOB secondary (muted line), not primary title
    expect(screen.getByText(/JOB JOB-A/)).toBeTruthy()
    expect(screen.getByText(/JOB JOB-B/)).toBeTruthy()
    expect(titles.every((t) => !t?.startsWith('JOB-'))).toBe(true)
    expect(screen.queryByRole('button', { name: /Use selected leg/i })).toBeNull()
    expect(screen.queryByText(/matched:/i)).toBeNull()
  })

  it('candidateBizKeyTitle prefers SO then BK then HBL', () => {
    expect(
      candidateBizKeyTitle({
        shipmentId: 'x',
        jobNo: 'JOB-X',
        so_no: 'SO9',
        booking_no: 'BK9',
        hbl_awb_fcr_no: 'H9',
        matchedBy: 'strong_key',
      }),
    ).toMatch(/^SO SO9/)
  })

  it('formats ETD for humans (not raw ISO)', () => {
    render(
      <CandidateLegsPanel matchAmbiguity={amb} selectedId={null} onSelect={vi.fn()} />,
    )
    expect(screen.queryByText(/2026-07-10T00:00:00/)).toBeNull()
    expect(screen.getByText(/ETD 10 Jul 2026/i)).toBeTruthy()
  })

  it('calls onSelect when a radio is chosen (aria uses biz key)', () => {
    const onSelect = vi.fn()
    render(
      <CandidateLegsPanel matchAmbiguity={amb} selectedId={null} onSelect={onSelect} />,
    )
    fireEvent.click(screen.getByLabelText(/Select SO SO2/i))
    expect(onSelect).toHaveBeenCalledWith('id-b')
  })
})
