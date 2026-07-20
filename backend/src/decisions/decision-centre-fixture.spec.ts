import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizeMasterName, type CriticReview } from './critic-review.types'

const fx = JSON.parse(
  readFileSync(join(__dirname, '../../test/fixtures/decision-centre-fixture.json'), 'utf8'),
)

describe('decision-centre cross-repo fixture (track side)', () => {
  it('parses the fixture criticReview slice into our type', () => {
    const cr = fx.criticReview as CriticReview
    expect(cr.wouldBeAuto).toBe(true)
    expect(cr.masterMisses).toEqual([
      { type: 'vendor', rawName: 'Dongguan Great Co', field: 'vendor_code' },
      { type: 'forwarder', rawName: 'Speedy Logistics', field: 'forwarder_name' },
    ])
  })
  it('normalizer contract matches queue', () => {
    expect(normalizeMasterName('  ACME   Ltd ')).toBe('acme ltd')
    expect(fx.normalizer).toBe('casefold+trim+collapse-ws')
  })
  it('desk classes include the gate lineIds', () => {
    expect(fx.deskClasses.decision).toContain('g-checksum')
    expect(fx.deskClasses.fyi).toContain('g-repaired')
  })
  it('ai_confidence_low reason text matches fixture', () => {
    expect(fx.aiConfidenceLowReason).toBe('AI confidence low — verify extraction')
  })
})
