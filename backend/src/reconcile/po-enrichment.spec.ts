import { describe, it, expect } from 'vitest'
import { normKey } from './match-keys'
import { resolvePoEnrichment, type PoEvidenceInput } from './po-enrichment'

/** Build a parsed_record-shaped evidence row. */
const row = (over: Partial<PoEvidenceInput> & { id: string }): PoEvidenceInput => ({
  poNo: null,
  matchKeys: null,
  fields: null,
  receivedAt: null,
  ...over,
})

const at = (iso: string) => new Date(iso)

describe('resolvePoEnrichment', () => {
  it('resolves brand/style/qty/unit for a PO from its matching record, keyed by normalized po_no', () => {
    const map = resolvePoEnrichment([
      row({ id: 'a', poNo: 'FEN_RE_W_190526', receivedAt: at('2026-06-30T05:00:00Z'), fields: { brand: 'FENIX', item_style_no: '43079', qty: '24', qty_unit: 'cartons' } }),
    ])
    expect(map.get(normKey('FEN_RE_W_190526'))).toEqual({
      brand: 'FENIX',
      itemStyleNo: '43079',
      totalQuantity: 24,
      quantityUnit: 'cartons',
    })
  })

  it('latest-received email wins when the SAME PO carries two brand labels (parser brand-leak)', () => {
    // Barbour arrives earlier, FENIX later — FENIX (latest) must win, deterministically.
    const map = resolvePoEnrichment([
      row({ id: 'old', poNo: 'PO-1', receivedAt: at('2026-06-01T00:00:00Z'), fields: { brand: 'Barbour' } }),
      row({ id: 'new', poNo: 'PO-1', receivedAt: at('2026-06-02T00:00:00Z'), fields: { brand: 'FENIX' } }),
    ])
    expect(map.get(normKey('PO-1'))?.brand).toBe('FENIX')
  })

  it('coalesces per field: takes each field from the latest record that has a non-null value', () => {
    // latest record lacks qty; the fuller style is on an older record — brand+style come latest, qty falls back.
    const map = resolvePoEnrichment([
      row({ id: 'older', poNo: 'PO-2', receivedAt: at('2026-06-01T00:00:00Z'), fields: { brand: 'FENIX', item_style_no: '33058,43078', qty: '24', qty_unit: 'cartons' } }),
      row({ id: 'latest', poNo: 'PO-2', receivedAt: at('2026-06-02T00:00:00Z'), fields: { brand: 'FENIX', item_style_no: '33058', qty: null, qty_unit: null } }),
    ])
    const enr = map.get(normKey('PO-2'))
    expect(enr?.itemStyleNo).toBe('33058') // latest wins
    expect(enr?.totalQuantity).toBe(24) // fell back to the older record that has a qty
    expect(enr?.quantityUnit).toBe('cartons') // unit comes from the SAME record as the qty
  })

  it('coerces a formatted qty string and drops a qty_unit outside the QTY_UNIT enum', () => {
    const map = resolvePoEnrichment([
      row({ id: 'a', poNo: 'PO-3', receivedAt: at('2026-06-01T00:00:00Z'), fields: { qty: '1,200 CTNS', qty_unit: 'boxes' } }),
    ])
    expect(map.get(normKey('PO-3'))).toEqual({ brand: null, itemStyleNo: null, totalQuantity: 1200, quantityUnit: null })
  })

  it('leaves quantityUnit null when there is no qty', () => {
    const map = resolvePoEnrichment([
      row({ id: 'a', poNo: 'PO-4', receivedAt: at('2026-06-01T00:00:00Z'), fields: { brand: 'ACME', qty_unit: 'cartons' } }),
    ])
    expect(map.get(normKey('PO-4'))).toEqual({ brand: 'ACME', itemStyleNo: null, totalQuantity: null, quantityUnit: null })
  })

  it('falls back to match_keys.customer_po when po_no is null', () => {
    const map = resolvePoEnrichment([
      row({ id: 'a', poNo: null, matchKeys: { customer_po: 'PO-5' }, receivedAt: at('2026-06-01T00:00:00Z'), fields: { brand: 'ACME' } }),
    ])
    expect(map.get(normKey('PO-5'))?.brand).toBe('ACME')
  })

  it('excludes a record with a brand but NO po_no and NO customer_po (the SO-level Barbour leak)', () => {
    // This is exactly the leak: a brand stated at the shipment level with no PO of its own must attach to NO PO.
    const map = resolvePoEnrichment([
      row({ id: 'so-level', poNo: null, matchKeys: { so_no: '26SZ10066152' }, receivedAt: at('2026-06-01T00:00:00Z'), fields: { brand: 'Barbour' } }),
      row({ id: 'po-4483233', poNo: '4483233', matchKeys: { customer_po: '4483233', so_no: '26SZ10066152' }, receivedAt: at('2026-06-01T00:00:00Z'), fields: { brand: null } }),
    ])
    expect(map.size).toBe(1)
    expect(map.get(normKey('4483233'))?.brand).toBeNull() // NOT 'Barbour'
    expect([...map.values()].some((e) => e.brand === 'Barbour')).toBe(false)
  })

  it('sorts null receivedAt last and breaks ties deterministically by id', () => {
    const map = resolvePoEnrichment([
      row({ id: 'zzz', poNo: 'PO-6', receivedAt: null, fields: { brand: 'NO_DATE' } }),
      row({ id: 'aaa', poNo: 'PO-6', receivedAt: at('2026-06-01T00:00:00Z'), fields: { brand: 'DATED' } }),
    ])
    expect(map.get(normKey('PO-6'))?.brand).toBe('DATED') // dated record beats the null-date one
  })

  it('returns an empty map for no rows', () => {
    expect(resolvePoEnrichment([]).size).toBe(0)
  })
})

describe('resolvePoEnrichment — shipment-total broadcast guard (the 168×20 bug)', () => {
  const bcast = (id: string, po: string, qty: string, msg = 'msg-1') =>
    row({ id, poNo: po, messageId: msg, receivedAt: at('2026-06-30T05:00:00Z'), fields: { qty, qty_unit: 'cartons', brand: 'Barbour' } })

  it('one identical qty on ≥3 POs within ONE email is the SHIPMENT total — no PO gets it', () => {
    const map = resolvePoEnrichment([bcast('a', 'PO-A', '168'), bcast('b', 'PO-B', '168'), bcast('c', 'PO-C', '168')])
    for (const po of ['PO-A', 'PO-B', 'PO-C']) {
      expect(map.get(normKey(po))?.totalQuantity).toBeNull()
      expect(map.get(normKey(po))?.quantityUnit).toBeNull()
      expect(map.get(normKey(po))?.brand).toBe('Barbour') // brand/style enrichment unaffected
    }
  })

  it('distinct per-PO quantities in one email are REAL and kept (the 进仓单 column case)', () => {
    const map = resolvePoEnrichment([bcast('a', 'PO-A', '2'), bcast('b', 'PO-B', '18'), bcast('c', 'PO-C', '1')])
    expect(map.get(normKey('PO-A'))?.totalQuantity).toBe(2)
    expect(map.get(normKey('PO-B'))?.totalQuantity).toBe(18)
    expect(map.get(normKey('PO-C'))?.totalQuantity).toBe(1)
  })

  it('two POs sharing a qty stays below the broadcast threshold', () => {
    const map = resolvePoEnrichment([bcast('a', 'PO-A', '24'), bcast('b', 'PO-B', '24')])
    expect(map.get(normKey('PO-A'))?.totalQuantity).toBe(24)
    expect(map.get(normKey('PO-B'))?.totalQuantity).toBe(24)
  })

  it('a MIXED-value email keeps a qty even when it repeats on ≥3 POs (the 64833 进仓单 false positive)', () => {
    // 30-PO warehouse table: many POs at 2 cartons, some at 18, one at 1 — repetition of "2" is real.
    const map = resolvePoEnrichment([
      bcast('a', 'PO-A', '2'),
      bcast('b', 'PO-B', '2'),
      bcast('c', 'PO-C', '2'),
      bcast('d', 'PO-D', '18'),
      bcast('e', 'PO-E', '1'),
    ])
    expect(map.get(normKey('PO-A'))?.totalQuantity).toBe(2)
    expect(map.get(normKey('PO-B'))?.totalQuantity).toBe(2)
    expect(map.get(normKey('PO-C'))?.totalQuantity).toBe(2)
    expect(map.get(normKey('PO-D'))?.totalQuantity).toBe(18)
    expect(map.get(normKey('PO-E'))?.totalQuantity).toBe(1)
  })

  it('a broadcast in one email never blocks a REAL qty from another email for the same PO', () => {
    const map = resolvePoEnrichment([
      bcast('a', 'PO-A', '168'),
      bcast('b', 'PO-B', '168'),
      bcast('c', 'PO-C', '168'),
      row({ id: 'real', poNo: 'PO-A', messageId: 'msg-2', receivedAt: at('2026-06-29T00:00:00Z'), fields: { qty: '24', qty_unit: 'cartons' } }),
    ])
    expect(map.get(normKey('PO-A'))?.totalQuantity).toBe(24) // falls through to the per-PO statement
    expect(map.get(normKey('PO-B'))?.totalQuantity).toBeNull()
  })

  const bkRow = (id: string, po: string, qty: string, booking: string) =>
    row({ id, poNo: po, messageId: 'msg-1', receivedAt: at('2026-07-02T05:00:00Z'), fields: { qty, qty_unit: 'cartons', booking_no: booking } })

  it('a MULTI-booking email stamping each booking subtotal per PO is a broadcast per booking (the 123229 59×10 bug)', () => {
    // booking 123229: ten POs all "59" (its subtotal); booking 123088: two POs all "17".
    // Per-email uniformity sees two values (= "mixed") — the per-booking check must catch the 59s.
    const rows = [
      ...['PO-1', 'PO-2', 'PO-3', 'PO-4', 'PO-5', 'PO-6', 'PO-7', 'PO-8', 'PO-9', 'PO-10'].map((po, i) =>
        bkRow(`a${i}`, po, '59', '123229')),
      bkRow('b1', 'PO-11', '17', '123088'),
      bkRow('b2', 'PO-12', '17', '123088'),
    ]
    const map = resolvePoEnrichment(rows)
    for (let i = 1; i <= 10; i++) expect(map.get(normKey(`PO-${i}`))?.totalQuantity).toBeNull()
    // the two-PO booking stays below the ≥3 threshold — conservative, kept
    expect(map.get(normKey('PO-11'))?.totalQuantity).toBe(17)
  })

  it('a mixed-value table within ONE booking keeps its repeated quantities (per-booking 进仓单 regression)', () => {
    const map = resolvePoEnrichment([
      bkRow('a', 'PO-A', '2', 'BK-1'),
      bkRow('b', 'PO-B', '2', 'BK-1'),
      bkRow('c', 'PO-C', '2', 'BK-1'),
      bkRow('d', 'PO-D', '18', 'BK-1'),
    ])
    expect(map.get(normKey('PO-A'))?.totalQuantity).toBe(2) // 2 < 18: repeated but NOT the max → real
    expect(map.get(normKey('PO-D'))?.totalQuantity).toBe(18)
  })

  it('a stray smaller record from another order does NOT rescue a grand-total broadcast (the 76×12+17 invoice)', () => {
    // twelve POs all stamped with the email GRAND total 76; one unrelated FENIX record at 17.
    // 76 repeats on ≥3 POs AND is the scope maximum → broadcast; the stray 17 stays real.
    const rows = [
      ...Array.from({ length: 12 }, (_, i) => bcast(`g${i}`, `GPO-${i}`, '76')),
      bcast('stray', 'FNX-SS26-S0044-01', '17'),
    ]
    const map = resolvePoEnrichment(rows)
    for (let i = 0; i < 12; i++) expect(map.get(normKey(`GPO-${i}`))?.totalQuantity).toBeNull()
    expect(map.get(normKey('FNX-SS26-S0044-01'))?.totalQuantity).toBe(17)
  })
})
