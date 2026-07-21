import { describe, it, expect } from 'vitest'
import {
  mapRecommendedToStatus,
  hasHardStopFlags,
  isHighBandAutoEligible,
  resolveBandRouting,
  HARD_STOP_RISK_CODES,
} from './band-routing'

describe('band-routing', () => {
  it('maps recommendedRouting to reviewStatus', () => {
    expect(mapRecommendedToStatus('auto')).toBe('confirmed')
    expect(mapRecommendedToStatus('review')).toBe('provisional')
    expect(mapRecommendedToStatus('skip')).toBe('skip')
  })

  it('detects hard-stop risk codes', () => {
    expect(hasHardStopFlags({
      confidence: { score: 90, band: 'high', label: 'High' },
      summary: '', observations: [], priorState: { headline: '', fields: [] },
      proposedChanges: [], riskFlags: [{ code: 'BACKEND_CONFLICT', severity: 'high', message: 'x' }],
      recommendedHumanAction: 'review', reasons: [],
    })).toBe(true)
    expect(hasHardStopFlags({
      confidence: { score: 90, band: 'high', label: 'High' },
      summary: '', observations: [], priorState: { headline: '', fields: [] },
      proposedChanges: [], riskFlags: [],
      recommendedHumanAction: 'approve_ok', reasons: [],
    })).toBe(false)
  })

  it('high + no hard-stop → confirmed; hard-stop overrides to provisional', () => {
    const clean = {
      confidence: { score: 90, band: 'high' as const, label: 'High' },
      summary: '', observations: [], priorState: { headline: '', fields: [] },
      proposedChanges: [], riskFlags: [] as { code: string; severity: 'low' | 'medium' | 'high'; message: string }[],
      recommendedHumanAction: 'approve_ok', reasons: [],
    }
    expect(resolveBandRouting({ recommendedRouting: 'auto', criticReview: clean })).toBe('confirmed')
    expect(resolveBandRouting({
      recommendedRouting: 'auto',
      criticReview: { ...clean, riskFlags: [{ code: 'PO_REASSIGN', severity: 'high', message: 'x' }] },
    })).toBe('provisional')
  })

  it('falls back to critic band when recommendedRouting omitted', () => {
    const high = {
      confidence: { score: 90, band: 'high' as const, label: 'High' },
      summary: '', observations: [], priorState: { headline: '', fields: [] },
      proposedChanges: [], riskFlags: [],
      recommendedHumanAction: 'approve_ok', reasons: [],
    }
    expect(resolveBandRouting({ criticReview: high })).toBe('confirmed')
    expect(resolveBandRouting({ criticReview: { ...high, confidence: { score: 40, band: 'low', label: 'Low' } } })).toBe('provisional')
  })

  it('null when no critic and no recommendedRouting', () => {
    expect(resolveBandRouting({})).toBe(null)
  })

  it('HARD_STOP_RISK_CODES matches queue HARD_STOP_CODES set', () => {
    for (const c of ['INTRA_EMAIL_MULTI_STRONG_ID', 'AMBIGUOUS_MATCH', 'BACKEND_CONFLICT', 'PO_REASSIGN', 'PORTAL_ECHO']) {
      expect(HARD_STOP_RISK_CODES.has(c)).toBe(true)
    }
  })

  it('isHighBandAutoEligible: high clean only', () => {
    const clean = {
      confidence: { score: 90, band: 'high' as const, label: 'High' },
      summary: '',
      observations: [],
      priorState: { headline: '', fields: [] },
      proposedChanges: [],
      riskFlags: [] as { code: string; severity: 'low' | 'medium' | 'high'; message: string }[],
      recommendedHumanAction: 'approve_ok' as const,
      reasons: [],
    }
    expect(isHighBandAutoEligible(clean)).toBe(true)
    expect(
      isHighBandAutoEligible({
        ...clean,
        riskFlags: [{ code: 'BACKEND_CONFLICT', severity: 'high', message: 'x' }],
      }),
    ).toBe(false)
    expect(
      isHighBandAutoEligible({
        ...clean,
        confidence: { score: 40, band: 'low', label: 'Low' },
      }),
    ).toBe(false)
  })
})
