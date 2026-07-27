import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

/**
 * Real case, leg E553C0A2: four candidates, two of which had a spreadsheet HEADER as their only
 * identifier ("SO no.", "PORT OF LOADING"). Merging live cargo into one is irreversible and always
 * wrong, so they are not offered — but the reason is stated and one click brings them back.
 */
describe('candidates parsed out of a header row are not offered as merge targets', () => {
  const amb = {
    kind: 'multi_candidate' as const,
    emailKey: { so_no: 'FENLSO003062' },
    candidates: [
      { shipmentId: 'c1', jobNo: 'JOB-2026-0008', so_no: 'FENLSO003044' },
      { shipmentId: 'c2', jobNo: 'JOB-2026-0009', so_no: 'PORT OF LOADING' },
      { shipmentId: 'c3', jobNo: 'JOB-2026-0010', so_no: 'SO no.' },
      { shipmentId: 'c4', jobNo: 'JOB-2026-0011', so_no: 'FENLSO003045' },
    ],
  }

  function renderPanel() {
    return render(
      <CandidateLegsPanel
        matchAmbiguity={amb}
        currentShipmentId="self"
        selectedId={null}
        onSelect={vi.fn()}
      />,
    )
  }

  it('offers only the two real ones, and says why the others are missing', () => {
    renderPanel()
    expect(screen.getAllByRole('radio')).toHaveLength(2)
    const note = screen.getByTestId('candidate-unidentifiable-note')
    expect(note).toHaveTextContent(/2 more matched/i)
    expect(note).toHaveTextContent(/PORT OF LOADING/)
    expect(note).toHaveTextContent(/SO no\./)
    expect(note).toHaveTextContent(/table header/i)
  })

  it('Show anyway brings them back — nothing is hidden outright', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(screen.getByRole('button', { name: /show anyway/i }))
    expect(screen.getAllByRole('radio')).toHaveLength(4)
    expect(screen.queryByTestId('candidate-unidentifiable-note')).toBeNull()
  })

  it('an all-real candidate set is untouched', () => {
    render(
      <CandidateLegsPanel
        matchAmbiguity={{ ...amb, candidates: [amb.candidates[0]!, amb.candidates[3]!] }}
        currentShipmentId="self"
        selectedId={null}
        onSelect={vi.fn()}
      />,
    )
    expect(screen.getAllByRole('radio')).toHaveLength(2)
    expect(screen.queryByTestId('candidate-unidentifiable-note')).toBeNull()
  })
})
