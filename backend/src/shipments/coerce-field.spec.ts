import { describe, it, expect } from 'vitest'
import { BadRequestException } from '@nestjs/common'
import { coerceLegField } from './coerce-field'

describe('coerceLegField — human-edit coercion + numeric sanity gate', () => {
  it('clears empty / null to null (field cleared, not gated)', () => {
    expect(coerceLegField('qty', '')).toBeNull()
    expect(coerceLegField('grossWeight', null)).toBeNull()
  })

  it('rejects a negative quantity with 400', () => {
    expect(() => coerceLegField('qty', '-10')).toThrow(BadRequestException)
  })

  it('rejects a zero quantity with 400 (a shipment of nothing)', () => {
    expect(() => coerceLegField('qty', '0')).toThrow(BadRequestException)
  })

  it('rejects a fractional quantity with 400 (a carton count is whole)', () => {
    expect(() => coerceLegField('qty', '1.5')).toThrow(BadRequestException)
  })

  it('accepts a positive whole quantity', () => {
    expect(coerceLegField('qty', '12')).toBe(12)
  })

  it('rejects negative gross weight and measurement with 400', () => {
    expect(() => coerceLegField('grossWeight', '-5')).toThrow(BadRequestException)
    expect(() => coerceLegField('measurement', '-0.1')).toThrow(BadRequestException)
  })

  it('accepts zero and fractional weight / measurement (only negatives are gated)', () => {
    expect(coerceLegField('grossWeight', '0')).toBe(0)
    expect(coerceLegField('measurement', '1.48')).toBe(1.48)
  })

  it('degrades non-numeric junk in a numeric field to null (unchanged — <input type=number> blocks it)', () => {
    expect(coerceLegField('qty', 'abc')).toBeNull()
  })

  it('coerces date columns to Date, and an unparseable date to null', () => {
    expect(coerceLegField('etd', '2026-07-12')).toBeInstanceOf(Date)
    expect(coerceLegField('etd', 'not-a-date')).toBeNull()
  })

  it('passes text columns through as string; HTS is warn-only (frontend), never backend-rejected', () => {
    expect(coerceLegField('soNo', 123)).toBe('123')
    expect(coerceLegField('htsCode', '6110test')).toBe('6110test')
    expect(coerceLegField('htsCode', '6110.20.2020')).toBe('6110.20.2020')
  })

  it('rejects a malformed SCAC (not 2-4 letters) with 400', () => {
    expect(() => coerceLegField('scacCode', 'MSC1')).toThrow(BadRequestException) // has a digit
    expect(() => coerceLegField('scacCode', 'TOOLONG')).toThrow(BadRequestException) // > 4
    expect(() => coerceLegField('scacCode', 'M')).toThrow(BadRequestException) // < 2
  })

  it('accepts a valid SCAC (2-4 letters, any case) and clears a blank one', () => {
    expect(coerceLegField('scacCode', 'MAEU')).toBe('MAEU')
    expect(coerceLegField('scacCode', 'msc')).toBe('msc')
    expect(coerceLegField('scacCode', '')).toBeNull()
  })

  it('rejects a malformed container (not ISO-6346 4 letters + 7 digits) with 400', () => {
    expect(() => coerceLegField('containerNo', 'MSBU728120')).toThrow(BadRequestException) // 6 digits
    expect(() => coerceLegField('containerNo', 'MS1U7281200')).toThrow(BadRequestException) // digit in prefix
    expect(() => coerceLegField('containerNo', 'garbage')).toThrow(BadRequestException)
  })

  it('accepts a valid container number and clears a blank one', () => {
    expect(coerceLegField('containerNo', 'MSBU7281200')).toBe('MSBU7281200')
    expect(coerceLegField('containerNo', '')).toBeNull()
  })

  it('rejects an out-of-enum UOM with 400', () => {
    expect(() => coerceLegField('qtyUnit', 'wqdqwd')).toThrow(BadRequestException)
    try {
      coerceLegField('qtyUnit', 'wqdqwd')
    } catch (e) {
      expect((e as BadRequestException).message).toMatch(/UOM must be one of/)
    }
  })

  it('accepts a valid UOM and clears blank', () => {
    expect(coerceLegField('qtyUnit', 'cartons')).toBe('cartons')
    expect(coerceLegField('qtyUnit', '')).toBeNull()
  })

  it('rejects case-mismatched UOM (DB CHECK is exact)', () => {
    expect(() => coerceLegField('qtyUnit', 'CARTONS')).toThrow(BadRequestException)
  })

  it('rejects an out-of-enum mode with 400', () => {
    expect(() => coerceLegField('mode', 'banana')).toThrow(BadRequestException)
    try {
      coerceLegField('mode', 'banana')
    } catch (e) {
      expect((e as BadRequestException).message).toMatch(/Mode must be one of/)
    }
  })

  it('accepts valid modes SEA / SEA_FCL / SEA_LCL / AIR', () => {
    for (const m of ['SEA', 'SEA_FCL', 'SEA_LCL', 'AIR']) {
      expect(coerceLegField('mode', m)).toBe(m)
    }
  })

  it('rejects case-mismatched mode (DB CHECK is exact)', () => {
    expect(() => coerceLegField('mode', 'sea')).toThrow(BadRequestException)
  })
})
