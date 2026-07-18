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

  it('passes text columns through as string (HTS format is NOT gated in this scope)', () => {
    expect(coerceLegField('soNo', 123)).toBe('123')
    expect(coerceLegField('htsCode', '6110test')).toBe('6110test')
  })
})
