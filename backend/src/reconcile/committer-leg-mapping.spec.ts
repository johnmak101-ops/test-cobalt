import { describe, it, expect } from 'vitest'
import { mapFieldsToLegColumns } from './committer-leg-mapping'

describe('mapFieldsToLegColumns — direct field→leg-column mapping (pure, no I/O)', () => {
  it('resolves scacCode from scac_code or the scac alias — the parser owns SCAC, no MBL-prefix guessing', () => {
    expect(mapFieldsToLegColumns({ scac_code: 'MAEU' }).scacCode).toBe('MAEU')
    expect(mapFieldsToLegColumns({ scac: 'MEDU' }).scacCode).toBe('MEDU') // alias
    expect(mapFieldsToLegColumns({ mbl: 'MEDUP5180997' }).scacCode).toBeNull() // MBL no longer guesses SCAC
    expect(mapFieldsToLegColumns({}).scacCode).toBeNull()
  })
  it('reads polRaw from poi, falling back to the pol alias (poi wins)', () => {
    expect(mapFieldsToLegColumns({ poi: 'CNPVG' }).polRaw).toBe('CNPVG')
    expect(mapFieldsToLegColumns({ pol: 'CNNGB' }).polRaw).toBe('CNNGB')
    expect(mapFieldsToLegColumns({ poi: 'CNPVG', pol: 'CNNGB' }).polRaw).toBe('CNPVG')
  })
  it('dedupes the comma-joined HTS and item-style lists (case-insensitive, order-preserving)', () => {
    expect(mapFieldsToLegColumns({ hts_code: '6109, 6109, 6110' }).htsCode).toBe('6109,6110')
    expect(mapFieldsToLegColumns({ item_style_no: 'A, a, B' }).itemStyleNo).toBe('A,B')
  })
  it('coerces dates and numbers, dropping unparseable values', () => {
    const cols = mapFieldsToLegColumns({ etd: '2026-02-10', qty: '286', gross_weight: 'abc', measurement: '20.54' })
    expect(cols.etd).toBeInstanceOf(Date)
    expect((cols.etd as Date).toISOString().slice(0, 10)).toBe('2026-02-10')
    expect(cols.qty).toBe(286)
    expect(cols.grossWeight).toBeNull() // 'abc' → null (never coerced to 0)
    expect(cols.measurement).toBe(20.54)
    expect(mapFieldsToLegColumns({ etd: 'not-a-date' }).etd).toBeNull()
  })
  it('trims strings and maps empties to null; passes qtyUnit through as-is', () => {
    expect(mapFieldsToLegColumns({ booking_no: '  BK-1  ' }).bookingNo).toBe('BK-1')
    expect(mapFieldsToLegColumns({ qty_unit: 'cartons' }).qtyUnit).toBe('cartons')
    const empty = mapFieldsToLegColumns({})
    expect(empty.bookingNo).toBeNull()
    expect(empty.qty).toBeNull()
    expect(empty.qtyUnit).toBeNull()
  })
  it('does NOT emit context-derived columns (mode/state/kind/ids/originCountry/matchKeys are the caller’s job)', () => {
    const cols = mapFieldsToLegColumns({ so_no: 'SO-1' })
    for (const k of ['mode', 'state', 'kind', 'forwarderId', 'polId', 'podId', 'originCountry', 'matchKeys']) {
      expect(cols).not.toHaveProperty(k)
    }
    expect(cols.soNo).toBe('SO-1') // …but the pure field columns ARE present
  })
  it('carries customer_code through as customerRaw — surfaced when customerId never resolves', () => {
    expect(mapFieldsToLegColumns({ customer_code: 'OTCX' }).customerRaw).toBe('OTCX')
    expect(mapFieldsToLegColumns({}).customerRaw).toBeNull()
  })
})
