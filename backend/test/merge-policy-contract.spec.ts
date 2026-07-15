/**
 * Cross-repo contract for merge policy tables (FIELD_CLASS + DOC_RANK).
 * Fixture is a synced copy — source of truth is cobalt-queue src/critic/merge.ts;
 * update BOTH repos in one change. Editing a live table without regenerating the
 * fixture fails this test.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { DOC_RANK, FIELD_CLASS } from '../src/reconcile/merge'

const FIXTURE_PATH = join(__dirname, 'fixtures', 'merge-policy.fixture.json')

describe('merge-policy cross-repo contract', () => {
  it('live FIELD_CLASS and DOC_RANK deep-equal the committed fixture', () => {
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as {
      FIELD_CLASS: typeof FIELD_CLASS
      DOC_RANK: typeof DOC_RANK
    }
    expect(FIELD_CLASS).toEqual(fixture.FIELD_CLASS)
    expect(DOC_RANK).toEqual(fixture.DOC_RANK)
  })
})
