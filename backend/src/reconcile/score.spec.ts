import { describe, it, expect } from 'vitest'
import { scoreReconGroup } from './score'

const base = { conflicts: [] as string[], pos: ['PO-1'], fields: { so_no: 'SO-1', etd: '2026-02-10' }, matchKeys: { so_no: 'SO-1' } }

describe('scoreReconGroup — legacy reconcile review gate', () => {
  it('scores a clean, well-identified group at 100 (auto-confirm)', () => {
    expect(scoreReconGroup(base).confidence).toBe(100)
  })

  it('falls below the default threshold (85) on any unresolved conflict → provisional', () => {
    const { confidence, reasons } = scoreReconGroup({ ...base, conflicts: ['hbl: A vs B'] })
    expect(confidence).toBe(75)
    expect(confidence).toBeLessThan(85)
    expect(reasons.join()).toMatch(/conflict/)
  })

  it('caps the conflict penalty at -40 (never floors to 0 on conflicts alone)', () => {
    expect(scoreReconGroup({ ...base, conflicts: ['a', 'b', 'c', 'd', 'e'] }).confidence).toBe(60)
  })

  it('penalizes a PO-only match (no strong identity key)', () => {
    expect(scoreReconGroup({ ...base, matchKeys: { customer_po: 'PO-1' } }).confidence).toBe(70)
  })

  it('clamps to 0-100 for a sparse, key-less, PO-less group', () => {
    const { confidence } = scoreReconGroup({ conflicts: ['x', 'y'], pos: [], fields: {}, matchKeys: {} })
    expect(confidence).toBeGreaterThanOrEqual(0)
    expect(confidence).toBeLessThanOrEqual(100)
  })
})
