import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { formatFieldWarn, fieldWarn } from './review-fields'

/**
 * The format gates exist twice — `coerceLegField` throws a 400, `formatFieldWarn` prevents the round
 * trip — and two copies of one rule drift. This reads the backend file and fails if either the
 * pattern or the WORDING moves, because the operator sees whichever fires and two phrasings of the
 * same rule is how they end up trusting neither.
 */
const backendSource = readFileSync(
  join(__dirname, '../../../backend/src/shipments/coerce-field.ts'),
  'utf8',
)

describe('format gates match the backend, character for character', () => {
  it('reads the backend gate file', () => {
    expect(backendSource).toContain('coerceLegField')
  })

  it.each([
    ['container pattern', String.raw`/^[A-Za-z]{4}\d{7}$/`],
    ['SCAC pattern', String.raw`/^[A-Za-z]{2,4}$/`],
    ['container message', 'Container No. must be 4 letters + 7 digits, e.g. MSBU7281200'],
    ['SCAC message', 'SCAC Code must be 2–4 letters (e.g. MAEU)'],
  ])('%s is identical on both sides', (_label, literal) => {
    expect(backendSource).toContain(literal)
  })

  it('HTS stays ungated on both sides — 6/8/10-digit and dotted forms are all real', () => {
    expect(backendSource).not.toMatch(/htsCode.*throw/s)
    expect(formatFieldWarn('htsCode', '6110.20.2020')).toBeNull()
  })
})

describe('formatFieldWarn', () => {
  it('rejects the shape the backend rejects', () => {
    expect(formatFieldWarn('containerNo', '123123123')).toMatch(/4 letters \+ 7 digits/)
    expect(formatFieldWarn('containerNo', 'MSBU728120')).not.toBeNull() // 6 digits
    expect(formatFieldWarn('scacCode', 'MAEUX')).toMatch(/2–4 letters/)
    expect(formatFieldWarn('scacCode', 'M4EU')).not.toBeNull() // digits are not letters
  })

  it('accepts what the backend accepts, including lower case and surrounding space', () => {
    expect(formatFieldWarn('containerNo', 'MSBU7281200')).toBeNull()
    expect(formatFieldWarn('containerNo', ' msbu7281200 ')).toBeNull()
    expect(formatFieldWarn('scacCode', 'MAEU')).toBeNull()
    expect(formatFieldWarn('scacCode', 'CO')).toBeNull()
  })

  it('an empty field is never an error — it clears the column', () => {
    expect(formatFieldWarn('containerNo', '')).toBeNull()
    expect(formatFieldWarn('containerNo', '   ')).toBeNull()
    expect(formatFieldWarn('containerNo', undefined)).toBeNull()
  })

  it('says nothing about a column that has no defined shape', () => {
    expect(formatFieldWarn('bookingNo', 'anything at all')).toBeNull()
    expect(formatFieldWarn('vesselName', '123')).toBeNull()
  })
})

describe('fieldWarn — the ONE question a form asks about a field', () => {
  it('covers the numeric gates', () => {
    expect(fieldWarn('qty', '0')).toMatch(/whole number greater than 0/)
    expect(fieldWarn('qty', '-1')).toMatch(/cannot be negative/)
  })

  it('covers the format gates the numeric-only check could never see', () => {
    // This is the regression: `containerNo` is type 'text', so a form asking only numericFieldWarn
    // (and only for type === 'number') had no way to reach this at all.
    expect(fieldWarn('containerNo', '123123123')).toMatch(/4 letters \+ 7 digits/)
    expect(fieldWarn('scacCode', '99')).toMatch(/2–4 letters/)
  })

  it('is quiet on a valid field', () => {
    expect(fieldWarn('qty', '286')).toBeNull()
    expect(fieldWarn('containerNo', 'MSBU7281200')).toBeNull()
  })
})
