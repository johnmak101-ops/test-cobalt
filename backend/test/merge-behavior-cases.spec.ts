/**
 * Behavioral fixture pack for mergeShipment — shared with cobalt-queue (Part C).
 * Maps cases into ShipTrack CriticEmail shape; honors skipTrack / skipReason for
 * known divergences (case 7: known-code-beats-unknown).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { mergeShipment, type CriticEmail } from '../src/reconcile/merge'

interface CaseEmail {
  receivedAt: string
  emailType: string
  fields: Record<string, unknown>
  pos?: string[]
}

interface CaseExpect {
  fields?: Record<string, unknown>
  conflictsContain?: string[]
  notConflicts?: boolean
  posContain?: string[]
}

interface BehaviorCase {
  name: string
  skipTrack?: boolean
  skipReason?: string
  emails: CaseEmail[]
  expect: CaseExpect
}

const CASES_PATH = join(__dirname, 'fixtures', 'merge-behavior.cases.json')
const cases = JSON.parse(readFileSync(CASES_PATH, 'utf8')) as BehaviorCase[]

describe('merge-behavior cases (Part C)', () => {
  it('fixture has the expected 8 cases', () => {
    expect(cases.map((c) => c.name)).toEqual([
      'sequence-token-drop',
      'lifecycle-supersede-not-conflict',
      'equal-rank-entity-code-clash-conflict',
      'schedule-latest-wins',
      'list-union-item-style',
      'locode-tie-break-pod',
      'known-code-beats-unknown',
      'po-union',
    ])
  })

  for (const c of cases) {
    const run = c.skipTrack ? it.skip : it
    run(c.skipTrack ? `${c.name} (skipped: ${c.skipReason ?? 'skipTrack'})` : c.name, () => {
      const emails: CriticEmail[] = c.emails.map((e) => ({
        receivedAt: e.receivedAt,
        emailType: e.emailType,
        fields: e.fields,
        pos: e.pos,
      }))
      const r = mergeShipment(emails)

      if (c.expect.fields) {
        for (const [k, v] of Object.entries(c.expect.fields)) {
          expect(r.fields[k], `${c.name} fields.${k}`).toEqual(v)
        }
      }
      if (c.expect.notConflicts) {
        expect(r.conflicts, `${c.name} notConflicts`).toEqual([])
      }
      if (c.expect.conflictsContain) {
        for (const needle of c.expect.conflictsContain) {
          expect(
            r.conflicts.some((line) => line.includes(needle)),
            `${c.name} conflictsContain ${needle}; got ${JSON.stringify(r.conflicts)}`,
          ).toBe(true)
        }
      }
      if (c.expect.posContain) {
        for (const p of c.expect.posContain) {
          expect(r.pos, `${c.name} posContain ${p}`).toContain(p)
        }
      }
    })
  }
})
