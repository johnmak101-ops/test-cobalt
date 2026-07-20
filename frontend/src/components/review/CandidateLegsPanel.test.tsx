import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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
  it('renders both jobs and 拼櫃 banner', () => {
    render(<CandidateLegsPanel matchAmbiguity={amb} />)
    expect(screen.getByTestId('candidate-legs-panel')).toBeTruthy()
    expect(screen.getByTestId('shared-container-banner').textContent).toMatch(/拼櫃|CTR-SAME/)
    expect(screen.getByText('JOB-A')).toBeTruthy()
    expect(screen.getByText('JOB-B')).toBeTruthy()
    expect(screen.getByText(/BK BK1/)).toBeTruthy()
    expect(screen.getByText(/BK BK2/)).toBeTruthy()
  })

  it('calls onLink only after selection', async () => {
    const onLink = vi.fn().mockResolvedValue(undefined)
    render(<CandidateLegsPanel matchAmbiguity={amb} onLink={onLink} />)
    const useBtn = screen.getByRole('button', { name: /Use selected leg/i })
    expect(useBtn).toBeDisabled()
    fireEvent.click(screen.getByLabelText(/Select JOB-B/i))
    expect(useBtn).not.toBeDisabled()
    fireEvent.click(useBtn)
    await waitFor(() => expect(onLink).toHaveBeenCalledWith('id-b'))
  })
})
