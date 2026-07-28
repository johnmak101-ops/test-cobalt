import { describe, it, expect } from 'vitest'
import { isAirMode, isSeaMode, isOffModeField, offModeFieldsOn } from './mode-fields'

describe('mode-fields — which transport fields belong to which mode', () => {
  it('classifies the two modes by prefix, so SEA_LCL and AIR_EXPRESS still count', () => {
    expect(isSeaMode('SEA')).toBe(true)
    expect(isSeaMode('SEA_LCL')).toBe(true)
    expect(isAirMode('AIR')).toBe(true)
    expect(isAirMode('AIR_EXPRESS')).toBe(true)
    expect(isAirMode('SEA')).toBe(false)
    expect(isSeaMode('AIR')).toBe(false)
  })

  it('sea-only fields are off-mode on air, and vice versa', () => {
    for (const c of ['vesselName', 'voyageNo', 'mbl']) {
      expect(isOffModeField(c, 'AIR')).toBe(true)
      expect(isOffModeField(c, 'SEA')).toBe(false)
    }
    for (const c of ['flightNo', 'mawb']) {
      expect(isOffModeField(c, 'SEA')).toBe(true)
      expect(isOffModeField(c, 'AIR')).toBe(false)
    }
  })

  it('a column belonging to neither mode is never off-mode', () => {
    expect(isOffModeField('containerNo', 'AIR')).toBe(false)
    expect(isOffModeField('polRaw', 'SEA')).toBe(false)
  })

  /** A leg nobody has classified cannot contradict a classification — the safe direction. */
  it('an unknown or empty mode claims neither set, so nothing is off-mode', () => {
    expect(isOffModeField('flightNo', null)).toBe(false)
    expect(isOffModeField('vesselName', '')).toBe(false)
    expect(offModeFieldsOn({ mode: null, flightNo: 'CX252', vesselName: 'EVER GLORY' })).toEqual([])
  })

  it('reports the air fields a sea leg is carrying, with labels and values', () => {
    expect(
      offModeFieldsOn({
        mode: 'SEA',
        vesselName: 'EVER GLORY',
        voyageNumber: '2418W',
        flightNo: 'CX252',
        mawb: '160-88112233',
      }),
    ).toEqual([
      { column: 'flightNo', label: 'Flight No.', value: 'CX252' },
      { column: 'mawb', label: 'MAWB', value: '160-88112233' },
    ])
  })

  it('and the sea fields an air leg is carrying', () => {
    expect(offModeFieldsOn({ mode: 'AIR', vesselName: 'EVER GLORY', mblNumber: 'MEDUXD220145' })).toEqual([
      { column: 'vesselName', label: 'Vessel', value: 'EVER GLORY' },
      { column: 'mbl', label: 'MBL', value: 'MEDUXD220145' },
    ])
  })

  it('an empty or whitespace value is not a contradiction', () => {
    expect(offModeFieldsOn({ mode: 'SEA', flightNo: '', mawb: '   ' })).toEqual([])
  })

  it('a leg that agrees with itself reports nothing', () => {
    expect(offModeFieldsOn({ mode: 'SEA', vesselName: 'EVER GLORY', voyageNumber: '2418W' })).toEqual([])
  })
})
