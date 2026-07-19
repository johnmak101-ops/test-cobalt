import { describe, it, expect } from 'vitest'
import {
  CRITICAL_COLUMNS,
  criticalMissing,
  criticalConflicts,
  isCriticalColumn,
} from './review-critical'

describe('criticalMissing', () => {
  it('flags each empty critical field', () => {
    const items = criticalMissing({
      bookingNo: null,
      soNumber: '',
      crd: null,
      etd: '2026-07-20',
      actualDeparture: null,
    })
    const cols = items.filter((i) => i.kind === 'missing').map((i) => i.column)
    expect(cols).toEqual(expect.arrayContaining(['bookingNo', 'soNo', 'cargoReadyDate', 'atd']))
    expect(cols).not.toContain('etd')
  })

  it('treats whitespace as missing', () => {
    expect(criticalMissing({ bookingNo: '  ' }).some((i) => i.column === 'bookingNo')).toBe(true)
  })

  it('returns empty when all critical present', () => {
    expect(
      criticalMissing({
        bookingNo: 'BK1',
        soNumber: 'SO1',
        crd: '2026-07-01',
        etd: '2026-07-10',
        actualDeparture: '2026-07-11',
      }),
    ).toEqual([])
  })
})

describe('criticalConflicts', () => {
  it('maps etd and booking_no conflicts', () => {
    const items = criticalConflicts([
      {
        field: 'etd',
        label: 'ETD',
        candidates: [
          { value: '2026-07-01', source: 'System' },
          { value: '2026-07-05', source: 'SO' },
        ],
      },
      {
        field: 'qty',
        label: 'Qty',
        candidates: [
          { value: '1', source: 'System' },
          { value: '2', source: 'SO' },
        ],
      },
    ])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'conflict', column: 'etd' })
    expect(items[0].kind === 'conflict' && items[0].summary).toMatch(/2026-07-01|2026-07-05/)
  })

  it('accepts so_no alias', () => {
    const items = criticalConflicts([
      { field: 'so_no', candidates: [{ value: 'A', source: 'System' }, { value: 'B', source: 'SO' }] },
    ])
    expect(items[0]?.column).toBe('soNo')
  })

  it('accepts crd and actual_departure critic aliases', () => {
    const items = criticalConflicts([
      {
        field: 'crd',
        candidates: [
          { value: '2026-07-01', source: 'System' },
          { value: '2026-07-02', source: 'SO' },
        ],
      },
      {
        field: 'actual_departure',
        candidates: [
          { value: '2026-07-10', source: 'System' },
          { value: '2026-07-11', source: 'SO' },
        ],
      },
    ])
    expect(items.map((i) => i.column)).toEqual(['cargoReadyDate', 'atd'])
  })
})

describe('isCriticalColumn', () => {
  it('true only for the five', () => {
    for (const c of CRITICAL_COLUMNS) expect(isCriticalColumn(c)).toBe(true)
    expect(isCriticalColumn('qty')).toBe(false)
  })
})
