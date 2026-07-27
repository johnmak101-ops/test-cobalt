import { describe, it, expect } from 'vitest'
import { diffCandidates, type CandidateFacts } from './candidate-diff'

/**
 * The five legs offered for A84B3B1A. SO, JOB and PO identical on all five; vessel and ETD identical
 * on four of five; only the HBL and container told them apart — and those sat mid-line, so choosing
 * meant diffing five near-identical blocks by eye.
 */
const FIVE: CandidateFacts[] = [
  { shipmentId: '1', so_no: 'S13784413', jobNo: 'JOB-2026-0005', hbl_awb_fcr_no: 'FCR001378583', vesselOrFlight: 'MAASTRICHT MAERSK', etd: '2026-07-28' },
  { shipmentId: '2', so_no: 'S13784413', jobNo: 'JOB-2026-0005', hbl_awb_fcr_no: 'FCR001378650', container_no: 'MRSU4743377', vesselOrFlight: 'MAASTRICHT MAERSK', etd: '2026-07-28' },
  { shipmentId: '3', so_no: 'S13784413', jobNo: 'JOB-2026-0005', hbl_awb_fcr_no: 'FCR001379050', container_no: 'TCNU5114660', vesselOrFlight: 'MARIBO MAERSK', etd: '2026-07-29' },
  { shipmentId: '4', so_no: 'S13784413', jobNo: 'JOB-2026-0005', hbl_awb_fcr_no: 'FCR001380008', vesselOrFlight: 'MAASTRICHT MAERSK', etd: '2026-07-28' },
  { shipmentId: '5', so_no: 'S13784413', jobNo: 'JOB-2026-0005', hbl_awb_fcr_no: 'FCR001378656', container_no: 'MRSU4743377', vesselOrFlight: 'MAASTRICHT MAERSK', etd: '2026-07-28' },
]

describe('diffCandidates', () => {
  it('hoists what all five share and keeps what tells them apart', () => {
    const d = diffCandidates(FIVE)
    expect(d.shared.map((f) => f.key)).toEqual(['so_no', 'jobNo'])
    expect(d.shared.find((f) => f.key === 'so_no')?.value).toBe('S13784413')
    const differing = d.differing.map((f) => f.key)
    expect(differing).toContain('hbl_awb_fcr_no')
    expect(differing).toContain('vesselOrFlight')
    expect(differing).toContain('etd')
    expect(differing).not.toContain('so_no')
  })

  /** Absence distinguishes: hoisting the container would claim it of the two legs that lack one. */
  it('a field present on only SOME candidates is differing, not shared', () => {
    expect(diffCandidates(FIVE).differing.map((f) => f.key)).toContain('container_no')
  })

  it('identifier fields no candidate carries are named, so the operator knows why', () => {
    const d = diffCandidates([
      { shipmentId: '1', so_no: 'FENLSO003044', jobNo: 'JOB-2026-0008', etd: '2026-08-04' },
      { shipmentId: '2', so_no: 'FENLSO003045', jobNo: 'JOB-2026-0011', etd: '2026-08-04' },
    ])
    expect(d.absentIdentifiers).toEqual(['HBL', 'BK', 'MBL', 'CTR'])
    // Same ETD on both → hoisted; the SO is what differs.
    expect(d.shared.map((f) => f.key)).toContain('etd')
    expect(d.differing.map((f) => f.key)).toContain('so_no')
  })

  it('case differences do not count as a difference', () => {
    const d = diffCandidates([
      { shipmentId: '1', vesselOrFlight: 'MARIBO MAERSK' },
      { shipmentId: '2', vesselOrFlight: 'Maribo Maersk' },
    ])
    expect(d.shared.map((f) => f.key)).toEqual(['vesselOrFlight'])
  })

  it('empty input is inert', () => {
    expect(diffCandidates([])).toEqual({ shared: [], differing: [], absentIdentifiers: [] })
  })
})
