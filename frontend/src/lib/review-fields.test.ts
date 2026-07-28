import { describe, it, expect } from 'vitest'
import {
  EDITABLE_FIELDS,
  REVIEW_GROUP_ORDER,
  buildCorrections,
  conflictColumns,
  fieldLabel,
  fieldUnit,
  groupConflictFields,
  reviewFieldLabel,
  mapCriticFieldToColumn,
  mapCriticFieldsToColumns,
  isPortColumn,
  partyPickerKind,
  isNumericColumn,
  isDateColumn,
  dateColumnHasTime,
  normalizeNumericInput,
  formatNumericDisplay,
  isWritableLegColumn,
  reviewGroupOf,
  toInputValue,
  parseStyleEntries,
  parseStyleTokens,
  serializeStyleTokens,
  serializeStyleEntries,
  numericFieldWarn,
  dateOrderWarn,
} from './review-fields'
import { MODE_OPTIONS, UOM_OPTIONS } from './enums'

describe('EDITABLE_FIELDS', () => {
  it('maps every UI key to a leg column with a type', () => {
    const qty = EDITABLE_FIELDS.find((f) => f.uiKey === 'quantityShipped')
    expect(qty).toMatchObject({ column: 'qty', type: 'number' })
    const hbl = EDITABLE_FIELDS.find((f) => f.uiKey === 'hblNumber')
    expect(hbl).toMatchObject({ column: 'hblAwbFcrNo', type: 'text' })
    const atd = EDITABLE_FIELDS.find((f) => f.uiKey === 'actualDeparture')
    expect(atd).toMatchObject({ column: 'atd', type: 'date' })
  })

  it('includes mode / POL / POD / forwarder free-text for detail edit (#183)', () => {
    expect(EDITABLE_FIELDS.find((f) => f.column === 'mode')).toMatchObject({
      section: 'Shipping',
      label: 'Mode',
      uiKey: 'mode',
    })
    expect(EDITABLE_FIELDS.find((f) => f.column === 'polRaw')?.label).toBe('POL')
    expect(EDITABLE_FIELDS.find((f) => f.column === 'podRaw')?.label).toBe('POD')
    expect(EDITABLE_FIELDS.find((f) => f.column === 'forwarderRaw')?.label).toBe('Forwarder')
    // still map critic snake_case via extras / writable set
    expect(mapCriticFieldToColumn('pol')).toBe('polRaw')
    expect(mapCriticFieldToColumn('mode')).toBe('mode')
  })

  it('offers only SEA / AIR in the Mode dropdown but keeps the full enum as known values', () => {
    const mode = EDITABLE_FIELDS.find((f) => f.column === 'mode')
    expect(mode?.options).toEqual(['SEA', 'AIR'])
    // SEA_FCL / SEA_LCL stay agent-writable and must not read as "unrecognized" in the edit select.
    expect(mode?.allValues).toEqual([...MODE_OPTIONS])
    expect(EDITABLE_FIELDS.find((f) => f.column === 'qtyUnit')?.options).toEqual([...UOM_OPTIONS])
  })

  it('exposes Warehouse SO as its own Order Info edit row, right after SO#', () => {
    expect(EDITABLE_FIELDS.find((f) => f.column === 'warehouseSo')).toMatchObject({
      section: 'Order Info',
      label: 'Warehouse SO',
      uiKey: 'warehouseSo',
      type: 'text',
    })
    expect(
      EDITABLE_FIELDS.filter((f) => f.section === 'Order Info').map((f) => f.column),
    ).toEqual(['bookingNo', 'soNo', 'warehouseSo'])
  })

  it('makes Customer / Vendor editable (Mesh-lag stand-in) under Shipping, labelled as codes', () => {
    expect(EDITABLE_FIELDS.find((f) => f.column === 'customerRaw')).toMatchObject({
      section: 'Shipping',
      label: 'Customer Code',
      uiKey: 'customerRaw',
      type: 'text',
    })
    expect(EDITABLE_FIELDS.find((f) => f.column === 'vendorRaw')).toMatchObject({
      section: 'Shipping',
      label: 'Vendor Code',
      uiKey: 'vendorRaw',
    })
    // parties route to Shipping via the column mapping (no dedicated regex that would swallow customer_po)
    expect(reviewGroupOf('customer')).toBe('Shipping')
    expect(reviewGroupOf('vendor_code')).toBe('Shipping')
  })

  it('marks POL / POD as a port picker (seeded ports master); other columns are not', () => {
    expect(EDITABLE_FIELDS.find((f) => f.column === 'polRaw')?.picker).toBe('port')
    expect(EDITABLE_FIELDS.find((f) => f.column === 'podRaw')?.picker).toBe('port')
    expect(isPortColumn('polRaw')).toBe(true)
    expect(isPortColumn('podRaw')).toBe(true)
    expect(isPortColumn('forwarderRaw')).toBe(false)
    expect(isPortColumn('customerRaw')).toBe(false)
    expect(isPortColumn(null)).toBe(false)
    // Customer/Vendor DO pick from the Mesh mirror (reversing the earlier "no list to pick from"
    // rule): the mirror holds ~850 customers / ~1.5k vendors, so the lag makes it INCOMPLETE, not
    // absent — and PartyPicker keeps the same free-text fallback PortPicker has, so a party the
    // mirror has not caught up with is still enterable. A pick stores the master CODE, the tier
    // exactPartyId resolves first and the value the read view shows as "Customer Code".
    expect(EDITABLE_FIELDS.find((f) => f.column === 'customerRaw')?.picker).toBe('customer')
    expect(EDITABLE_FIELDS.find((f) => f.column === 'vendorRaw')?.picker).toBe('vendor')
    expect(EDITABLE_FIELDS.find((f) => f.column === 'forwarderRaw')?.picker).toBe('forwarder')
  })

  it('partyPickerKind drives both the edit form and the review conflict row from one list', () => {
    expect(partyPickerKind('customerRaw')).toBe('customer')
    expect(partyPickerKind('vendorRaw')).toBe('vendor')
    expect(partyPickerKind('forwarderRaw')).toBe('forwarder')
    // Ports have their own picker; everything else is plain free text.
    expect(partyPickerKind('polRaw')).toBeNull()
    expect(partyPickerKind('vesselName')).toBeNull()
    expect(partyPickerKind(null)).toBeNull()
    expect(partyPickerKind(undefined)).toBeNull()
  })
})

describe('EDITABLE_FIELDS — intra-section order mirrors the Order Details READ view', () => {
  // The edit form is generated from this array; the read view is the page users read most, so its
  // order is the convention (same rule as labels/sections in the docstring above the array).
  const columnsIn = (section: string) =>
    EDITABLE_FIELDS.filter((f) => f.section === section).map((f) => f.column)

  it('Key Dates follow the read chronology (CRD → warehouse window → cut-off → voyage → DC)', () => {
    expect(columnsIn('Key Dates')).toEqual([
      'cargoReadyDate',
      'warehouseStartDate',
      'warehouseEndDate',
      'cfsCutoff',
      'etd',
      'atd',
      'eta',
      'ata',
      'inDcDate',
    ])
  })

  it('Shipping keeps the read order for shared fields (parties → consignee → vessel → ports)', () => {
    expect(columnsIn('Shipping')).toEqual([
      'mode',
      'customerRaw',
      'vendorRaw',
      'forwarderRaw',
      'consigneeName',
      'consigneeAddress',
      'vesselName',
      'voyageNo',
      'flightNo',
      'polRaw',
      'podRaw',
    ])
  })
})

describe('numericFieldWarn — mirrors backend coerceLegField numeric rules', () => {
  it('qty: negative → error', () => {
    expect(numericFieldWarn('qty', '-20')).toBe('Total Quantity cannot be negative')
  })
  it('qty: zero / fractional → error', () => {
    expect(numericFieldWarn('qty', '0')).toMatch(/whole number greater than 0/)
    expect(numericFieldWarn('qty', '1.5')).toMatch(/whole number greater than 0/)
  })
  it('qty: valid whole number → null', () => {
    expect(numericFieldWarn('qty', '12')).toBeNull()
  })
  it('empty / non-numeric → null', () => {
    expect(numericFieldWarn('qty', '')).toBeNull()
    expect(numericFieldWarn('qty', undefined)).toBeNull()
    expect(numericFieldWarn('qty', 'abc')).toBeNull()
  })
  it('grossWeight / measurement: negative only', () => {
    expect(numericFieldWarn('grossWeight', '-1')).toBe('Gross Weight cannot be negative')
    expect(numericFieldWarn('measurement', '-0.1')).toBe('Measurement cannot be negative')
    expect(numericFieldWarn('grossWeight', '0')).toBeNull()
    expect(numericFieldWarn('measurement', '1.48')).toBeNull()
  })
  it('unknown columns → null', () => {
    expect(numericFieldWarn('bookingNo', '-1')).toBeNull()
  })
})

describe('dateOrderWarn — departure must be before arrival (est/actual float freely)', () => {
  it('flags an arrival earlier than a departure (ATA before ETD)', () => {
    expect(dateOrderWarn({ etd: '2026-08-05', ata: '2026-07-01' })).toMatch(/ATA is before ETD/)
  })
  it('flags ETD after ETA (estimated depart after estimated arrive)', () => {
    expect(dateOrderWarn({ etd: '2026-08-05', eta: '2026-07-01' })).toMatch(/ETA is before ETD/)
  })
  it('does NOT compare estimate vs actual of the same event', () => {
    expect(dateOrderWarn({ atd: '2026-07-01', etd: '2026-08-05' })).toBeNull() // ETD later than ATD is allowed
    expect(dateOrderWarn({ ata: '2026-07-01', eta: '2026-08-05' })).toBeNull() // ETA later than ATA is allowed
  })
  it('passes a normal timeline and ignores missing / blank dates', () => {
    expect(
      dateOrderWarn({ etd: '2026-07-01', eta: '2026-08-05', atd: '2026-07-02', ata: '2026-08-06' }),
    ).toBeNull()
    expect(dateOrderWarn({ etd: '2026-08-05' })).toBeNull() // no arrival to compare
    expect(dateOrderWarn({})).toBeNull()
  })
})

describe('buildCorrections — dirty-diff keyed by leg column', () => {
  // constructed in LOCAL time on purpose — datetime-local inputs are local wall-clock
  const original = {
    bookingNo: 'BX123',
    quantityShipped: 5,
    grossWeight: 7,
    etd: new Date(2026, 6, 10, 0, 0),
    consigneeName: null,
  }

  it('returns only changed fields, keyed by column name', () => {
    const edited = { bookingNo: 'BX123', quantityShipped: '8', grossWeight: '7', etd: '2026-07-10T00:00', consigneeName: '' }
    expect(buildCorrections(original, edited)).toEqual({ qty: '8' })
  })

  it('treats clearing a value as a change to empty (backend coerces to null)', () => {
    const edited = { bookingNo: '', quantityShipped: '5', grossWeight: '7', etd: '2026-07-10T00:00', consigneeName: '' }
    expect(buildCorrections(original, edited)).toEqual({ bookingNo: '' })
  })

  it('a date change is detected, and a TIME-only change counts too (cut-off times matter)', () => {
    const edited = { bookingNo: 'BX123', quantityShipped: '5', grossWeight: '7', etd: '2026-07-12T00:00', consigneeName: '' }
    expect(buildCorrections(original, edited)).toEqual({ etd: '2026-07-12T00:00' })
    const timeOnly = { bookingNo: 'BX123', quantityShipped: '5', grossWeight: '7', etd: '2026-07-10T15:00', consigneeName: '' }
    expect(buildCorrections(original, timeOnly)).toEqual({ etd: '2026-07-10T15:00' })
  })

  it('returns {} when nothing changed', () => {
    const edited = { bookingNo: 'BX123', quantityShipped: '5', grossWeight: '7', etd: '2026-07-10T00:00', consigneeName: '' }
    expect(buildCorrections(original, edited)).toEqual({})
  })
})

describe('parseStyleTokens — per-PO style lists (NO PO/STYLE pair splitting)', () => {
  it('keeps a slash inside a token intact — within one PO a slash is part of the style', () => {
    expect(parseStyleTokens('C193/FERN JUMPER')).toEqual(['C193/FERN JUMPER'])
  })
  it('splits on commas / Excel separators like the pair parser', () => {
    expect(parseStyleTokens('56571/SS26SW022, 56572/SS26SW023')).toEqual([
      '56571/SS26SW022',
      '56572/SS26SW023',
    ])
    expect(parseStyleTokens('A\tB\nC')).toEqual(['A', 'B', 'C'])
  })
  it('round-trips through serializeStyleTokens unchanged', () => {
    const v = '56571/SS26SW022, 56572/SS26SW023'
    expect(serializeStyleTokens(parseStyleTokens(v))).toBe(v)
    expect(parseStyleTokens(null)).toEqual([])
    expect(serializeStyleTokens([' ', ''])).toBe('')
  })
})

describe('conflictColumns — parse "why review?" reasons into column names', () => {
  it('extracts snake_case field tokens and maps to leg columns', () => {
    const cols = conflictColumns(['backend conflict on qty, gross_weight, measurement'])
    expect(cols).toContain('qty')
    // grossWeight / measurement no longer on the Order Details form (COLUMN_SET) — not highlighted there
    expect(cols).not.toContain('grossWeight')
    expect(cols).not.toContain('measurement')
  })

  it('ignores reasons that name no known fields', () => {
    expect(conflictColumns(['matched multiple backend legs (ambiguous)'])).toEqual([])
    expect(conflictColumns(['5 unresolved field conflict(s)'])).toEqual([])
  })
})

describe('mapCriticFieldToColumn / mapCriticFieldsToColumns', () => {
  it('maps critic snake_case parser fields to camelCase leg columns', () => {
    expect(mapCriticFieldToColumn('eta')).toBe('eta')
    expect(mapCriticFieldToColumn('etd')).toBe('etd')
    expect(mapCriticFieldToColumn('so_no')).toBe('soNo')
    expect(mapCriticFieldToColumn('booking_no')).toBe('bookingNo')
    expect(mapCriticFieldToColumn('hbl_awb_fcr_no')).toBe('hblAwbFcrNo')
    expect(mapCriticFieldToColumn('mbl')).toBe('mbl')
    expect(mapCriticFieldToColumn('container_no')).toBe('containerNo')
    expect(mapCriticFieldToColumn('vessel_name')).toBe('vesselName')
  })

  it('accepts already-camelCase columns and drops unknowns', () => {
    expect(mapCriticFieldToColumn('hblAwbFcrNo')).toBe('hblAwbFcrNo')
    expect(mapCriticFieldToColumn('not_a_real_field')).toBeNull()
    expect(mapCriticFieldToColumn('')).toBeNull()
  })

  it('maps critic port/party/mode fields so Review Queue can resolve those conflicts', () => {
    expect(mapCriticFieldToColumn('pol')).toBe('polRaw')
    expect(mapCriticFieldToColumn('pod')).toBe('podRaw')
    expect(mapCriticFieldToColumn('forwarder_name')).toBe('forwarderRaw')
    expect(mapCriticFieldToColumn('mode')).toBe('mode')
    expect(mapCriticFieldToColumn('flight_no')).toBe('flightNo')
    expect(mapCriticFieldToColumn('mawb')).toBe('mawb')
    expect(
      mapCriticFieldsToColumns({ pol: 'CNSHK', forwarder_name: 'SEH', eta: '2026-08-01' }),
    ).toEqual({ polRaw: 'CNSHK', forwarderRaw: 'SEH', eta: '2026-08-01' })
  })

  it('maps a customer/vendor conflict to the free-text raw column (Mesh-lag stand-in, no ERP write)', () => {
    // Masters are the read-only Mesh mirror (synced ~every 2 months); when none resolves, the reviewer
    // records the correct party in the raw column. The critic may name it a few ways — accept all.
    expect(mapCriticFieldToColumn('customer')).toBe('customerRaw')
    expect(mapCriticFieldToColumn('customer_code')).toBe('customerRaw')
    expect(mapCriticFieldToColumn('customer_name')).toBe('customerRaw')
    expect(mapCriticFieldToColumn('vendor')).toBe('vendorRaw')
    expect(mapCriticFieldToColumn('vendor_code')).toBe('vendorRaw')
    expect(mapCriticFieldToColumn('vendor_name')).toBe('vendorRaw')
    // and both raw columns are genuinely writable by /correct
    expect(isWritableLegColumn('customerRaw')).toBe(true)
    expect(isWritableLegColumn('vendorRaw')).toBe(true)
    // but a customer PO NUMBER is not a party — it must stay unmapped, not become customerRaw
    expect(mapCriticFieldToColumn('customer_po')).toBeNull()
  })

  it('rewrites a fields bag for CorrectDto (idempotent on camelCase)', () => {
    expect(
      mapCriticFieldsToColumns({
        eta: '2026-07-23',
        hbl_awb_fcr_no: 'HBL1',
        so_no: 'SO9',
        vessel_name: 'MSC LORETO',
        bookingNo: 'BK1',
        garbage: 'x',
      }),
    ).toEqual({
      eta: '2026-07-23',
      hblAwbFcrNo: 'HBL1',
      soNo: 'SO9',
      vesselName: 'MSC LORETO',
      bookingNo: 'BK1',
    })
  })
})

describe('toInputValue — shipment value → input value', () => {
  it('renders dates as LOCAL datetime-local so a stated cut-off time survives editing', () => {
    expect(toInputValue(new Date(2026, 5, 29, 15, 0), 'date')).toBe('2026-06-29T15:00')
    expect(toInputValue(new Date(2026, 6, 10, 0, 0), 'date')).toBe('2026-07-10T00:00')
  })
  it('renders null as empty string', () => {
    expect(toInputValue(null, 'text')).toBe('')
    expect(toInputValue(null, 'number')).toBe('')
  })
  it('stringifies numbers', () => {
    expect(toInputValue(7.5, 'number')).toBe('7.5')
  })
})

describe('style entries table — parse/serialize round trip', () => {
  it('splits PO/style pairs and bare styles into rows', () => {
    expect(parseStyleEntries('4483262/LKN18360L15, LKN1794, 655000/564399')).toEqual([
      { po: '4483262', style: 'LKN18360L15' },
      { po: '', style: 'LKN1794' },
      { po: '655000', style: '564399' },
    ])
  })

  it('serializes rows back, dropping empties', () => {
    expect(
      serializeStyleEntries([
        { po: '4483262', style: 'LKN18360L15' },
        { po: '', style: 'LKN1794' },
        { po: '', style: '' },
        { po: '655025', style: '' },
      ]),
    ).toBe('4483262/LKN18360L15, LKN1794, 655025')
  })

  it('round-trips a real list unchanged', () => {
    const s = '56571/SS26SW022, 56572/SS26SW023'
    expect(serializeStyleEntries(parseStyleEntries(s))).toBe(s)
  })

  it('handles null/empty', () => {
    expect(parseStyleEntries(null)).toEqual([])
    expect(serializeStyleEntries([])).toBe('')
  })

  it('accepts Excel paste (newlines / tabs) as separate styles', () => {
    expect(parseStyleEntries('26-A\n26-B\n26-C')).toEqual([
      { po: '', style: '26-A' },
      { po: '', style: '26-B' },
      { po: '', style: '26-C' },
    ])
    expect(parseStyleEntries('26-A\t26-B')).toEqual([
      { po: '', style: '26-A' },
      { po: '', style: '26-B' },
    ])
  })
})

describe('reviewGroupOf — demo field grouping', () => {
  it('maps a critic snake_case field to its demo group', () => {
    expect(reviewGroupOf('qty')).toBe('Cargo & Logistics')
    expect(reviewGroupOf('booking_no')).toBe('Order Info')
    expect(reviewGroupOf('etd')).toBe('Key Dates')
  })

  it('files fields exactly where the Order Details page already files them', () => {
    // Shipping = the parties/means. Not the demo's "Shipping Parties" — this app already says Shipping.
    expect(reviewGroupOf('consignee_name')).toBe('Shipping')
    expect(reviewGroupOf('vessel_name')).toBe('Shipping')
    expect(reviewGroupOf('voyage_no')).toBe('Shipping')
    // The strong identifiers live under Cargo & Logistics on the detail page — match it, do not
    // invent a "Shipping IDs" group that exists nowhere else in the product.
    expect(reviewGroupOf('hbl_awb_fcr_no')).toBe('Cargo & Logistics')
    expect(reviewGroupOf('mbl')).toBe('Cargo & Logistics')
    expect(reviewGroupOf('container_no')).toBe('Cargo & Logistics')
  })

  it('falls back to Other for an unmapped field rather than dropping it', () => {
    // the allowlist trap: mapCriticFieldsToColumns DROPS unknown keys. Grouping must not —
    // a conflict we cannot place must still be visible, or the count lies about the rows.
    expect(mapCriticFieldToColumn('customer_po')).toBeNull()
    expect(reviewGroupOf('customer_po')).toBe('Other')
    expect(reviewGroupOf('totally_unknown_field')).toBe('Other')
  })
})

describe('groupConflictFields — only conflict rows, grouped, empty groups omitted', () => {
  const conflict = (field: string, label: string) => ({
    field,
    label,
    candidates: [{ value: 'a', source: 'system' }],
    rationale: '',
  })

  it('groups conflicts in REVIEW_GROUP_ORDER and omits groups with no conflicts', () => {
    const groups = groupConflictFields([conflict('qty', 'Qty'), conflict('container_no', 'Container No.')])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.group).toBe('Cargo & Logistics')
    expect(groups[0]!.conflicts.map((c) => c.field)).toEqual(['qty', 'container_no'])
  })

  it('orders groups by REVIEW_GROUP_ORDER regardless of conflict order', () => {
    const groups = groupConflictFields([conflict('etd', 'ETD'), conflict('booking_no', 'Booking No.')])
    expect(groups.map((g) => g.group)).toEqual(['Order Info', 'Key Dates'])
    expect(REVIEW_GROUP_ORDER.indexOf('Order Info')).toBeLessThan(REVIEW_GROUP_ORDER.indexOf('Key Dates'))
  })

  it('keeps an unmapped conflict visible in Other, last', () => {
    const groups = groupConflictFields([conflict('customer_po', 'Customer PO'), conflict('qty', 'Qty')])
    expect(groups.map((g) => g.group)).toEqual(['Cargo & Logistics', 'Other'])
    expect(groups.at(-1)!.conflicts[0]!.field).toBe('customer_po')
  })

  it('returns no groups for an empty conflict set (zero-conflict card)', () => {
    expect(groupConflictFields([])).toEqual([])
  })
})

describe('reviewFieldLabel — OUR vocabulary wins over the queue payload', () => {
  it('uses the EDITABLE_FIELDS label, not the label the critic shipped', () => {
    // the queue sends label:'Qty' / 'Gross weight'; ShipTrack owns its own copy.
    expect(reviewFieldLabel('qty', 'Qty')).toBe('Total Quantity')
    // Bare label + unit in the VALUE ("1046.64 KGS") is the Order Details convention — follow it.
    expect(reviewFieldLabel('gross_weight', 'Gross weight')).toBe('Gross Weight')
    expect(reviewFieldLabel('measurement', 'Measurement')).toBe('Measurement')
  })

  it('falls back to the payload label for a field we do not own', () => {
    expect(reviewFieldLabel('customer_po', 'Customer PO')).toBe('Customer PO')
    expect(reviewFieldLabel('totally_unknown', 'Whatever')).toBe('Whatever')
  })
})

describe('fieldLabel — the one vocabulary, used by every surface that names a field', () => {
  it('resolves each column the Order Details read view renders', () => {
    // Pins the read view to EDITABLE_FIELDS: rename a label there and this stays green, but a
    // renamed/removed COLUMN fails here instead of silently rendering the raw column name.
    const rendered = [
      'bookingNo', 'soNo',
      'qty', 'qtyUnit', 'containerNo', 'hblAwbFcrNo', 'mbl', 'mawb', 'scacCode',
      'mode', 'polRaw', 'podRaw', 'forwarderRaw',
      'consigneeName', 'consigneeAddress', 'vesselName', 'voyageNo', 'flightNo',
      'cargoReadyDate', 'warehouseStartDate', 'warehouseEndDate', 'cfsCutoff',
      'etd', 'atd', 'eta', 'ata', 'inDcDate',
    ]
    for (const c of rendered) {
      expect(EDITABLE_FIELDS.some((f) => f.column === c), `no EDITABLE_FIELDS entry for '${c}'`).toBe(true)
      expect(fieldLabel(c)).not.toBe(c)
    }
    expect(fieldLabel('qty')).toBe('Total Quantity')
    // Gross weight / Measurement / HTS / bag Item·Style removed from Order Details form.
    // Warehouse SO returned 2026-07-24 as its own Order Info edit row (read stays combined "A · B").
    expect(EDITABLE_FIELDS.some((f) => f.column === 'grossWeight')).toBe(false)
    expect(EDITABLE_FIELDS.some((f) => f.column === 'measurement')).toBe(false)
    expect(EDITABLE_FIELDS.some((f) => f.column === 'htsCode')).toBe(false)
    expect(EDITABLE_FIELDS.some((f) => f.column === 'warehouseSo')).toBe(true)
    expect(EDITABLE_FIELDS.some((f) => f.column === 'itemStyleNo')).toBe(false)
    expect(fieldLabel('warehouseSo')).toBe('Warehouse SO')
    expect(fieldLabel('itemStyleNo')).toBe('Item / Style No.')
    expect(fieldLabel('measurement')).toBe('Measurement')
  })

  it('falls back to the column name rather than rendering a blank label', () => {
    expect(fieldLabel('notAColumn')).toBe('notAColumn')
  })
})

describe('fieldUnit — the Order Details convention: unit lives in the VALUE', () => {
  it('gives NO unit for measurement — removed from Order Details (CBM no longer shown)', () => {
    expect(fieldUnit('measurement')).toBeNull()
  })

  it('gives NO unit for qty — it is the leg UOM, not a constant', () => {
    // qty is cartons OR pieces depending on the shipment; a constant here would invent a fact.
    expect(fieldUnit('qty')).toBeNull()
    expect(fieldUnit('bookingNo')).toBeNull()
    expect(fieldUnit('notAColumn')).toBeNull()
  })
})

describe('numeric columns — restrict on entry, group on display', () => {
  it('knows which leg columns are numeric, including ones the form omits', () => {
    expect(isNumericColumn('qty')).toBe(true)
    // Not on the Order Details form, but a critic conflict can still carry them.
    expect(isNumericColumn('grossWeight')).toBe(true)
    expect(isNumericColumn('measurement')).toBe(true)
    expect(isNumericColumn('bookingNo')).toBe(false)
    expect(isNumericColumn('etd')).toBe(false)
    expect(isNumericColumn(null)).toBe(false)
  })

  it('strips thousands separators so a grouped agent value can seed a number input', () => {
    // A packing list writes 1,240 — a number <input> renders that as BLANK, losing the proposal.
    expect(normalizeNumericInput('1,240')).toBe('1240')
    expect(normalizeNumericInput('13,516')).toBe('13516')
    expect(normalizeNumericInput('1240')).toBe('1240')
    expect(normalizeNumericInput('12.5')).toBe('12.5')
    expect(normalizeNumericInput('')).toBe('')
    expect(normalizeNumericInput(null)).toBe('')
    // Junk is left visible rather than silently mangled into something plausible.
    expect(normalizeNumericInput('abc')).toBe('abc')
    expect(normalizeNumericInput('1,2a4')).toBe('1,2a4')
  })

  it('groups for display and round-trips with normalize', () => {
    expect(formatNumericDisplay('13516')).toBe('13,516')
    expect(formatNumericDisplay('1240')).toBe('1,240')
    expect(formatNumericDisplay('999')).toBe('999')
    expect(formatNumericDisplay('')).toBe('')
    // Already grouped input is not double-grouped.
    expect(formatNumericDisplay('1,240')).toBe('1,240')
    // Non-numeric passes through untouched — a bad value must stay visible, not become "NaN".
    expect(formatNumericDisplay('abc')).toBe('abc')
    expect(normalizeNumericInput(formatNumericDisplay('13516'))).toBe('13516')
  })
})

describe('isDateColumn — dates get the shared calendar control', () => {
  it('covers every Key Dates column', () => {
    for (const c of ['cargoReadyDate', 'warehouseStartDate', 'warehouseEndDate', 'cfsCutoff',
                     'etd', 'atd', 'eta', 'ata', 'inDcDate']) {
      expect(isDateColumn(c)).toBe(true)
    }
  })

  it('excludes non-dates', () => {
    expect(isDateColumn('qty')).toBe(false)
    expect(isDateColumn('bookingNo')).toBe(false)
    expect(isDateColumn('polRaw')).toBe(false)
    expect(isDateColumn(null)).toBe(false)
    expect(isDateColumn(undefined)).toBe(false)
  })

  it('is disjoint from the numeric and party sets — one control per column', () => {
    const dates = ['etd', 'eta', 'atd', 'ata', 'cargoReadyDate', 'cfsCutoff']
    for (const c of dates) {
      expect(isNumericColumn(c)).toBe(false)
      expect(partyPickerKind(c)).toBeNull()
      expect(isPortColumn(c)).toBe(false)
    }
  })
})

describe('dateColumnHasTime — only the cut-off family states a clock time', () => {
  it('flags the warehouse window and CFS cut-off', () => {
    expect(dateColumnHasTime('warehouseStartDate')).toBe(true)
    expect(dateColumnHasTime('warehouseEndDate')).toBe(true)
    expect(dateColumnHasTime('cfsCutoff')).toBe(true)
  })

  it('leaves the day-level dates alone', () => {
    // Zero stored rows carry a time on any of these; a time box would be noise.
    for (const c of ['etd', 'atd', 'eta', 'ata', 'cargoReadyDate', 'inDcDate']) {
      expect(isDateColumn(c)).toBe(true)
      expect(dateColumnHasTime(c)).toBe(false)
    }
  })

  it('is false for non-dates', () => {
    expect(dateColumnHasTime('qty')).toBe(false)
    expect(dateColumnHasTime(null)).toBe(false)
  })
})

/**
 * Tripwire for a cross-package invariant: every column this form renders an input for must also be in
 * the backend's CORRECTABLE_COLUMNS (backend/src/review/review.service.ts), or the operator types into
 * a box whose save 400s with "field not correctable: <col>".
 *
 * That is not hypothetical. `warehouseSo` was split into its own row here (2026-07-24) without the
 * allowlist being widened, and the failure was invisible for months because the queue page reported
 * the 400 through the success toast — a green tick over a save that never landed.
 *
 * Nothing can import across packages, so this pins the set from THIS side and review.service.spec.ts
 * pins it from the other. Adding a field fails here; removing one from the allowlist fails there.
 * When this fails because you added a field: add the same column to CORRECTABLE_COLUMNS, then update
 * both lists.
 */
describe('EDITABLE_FIELDS columns are mirrored in the backend allowlist', () => {
  const BACKEND_CORRECTABLE = [
    'bookingNo', 'soNo', 'warehouseSo',
    'qty', 'qtyUnit', 'containerNo', 'hblAwbFcrNo', 'mbl', 'mawb', 'scacCode',
    'mode', 'customerRaw', 'vendorRaw', 'forwarderRaw', 'consigneeName', 'consigneeAddress',
    'vesselName', 'voyageNo', 'flightNo', 'polRaw', 'podRaw',
    'cargoReadyDate', 'warehouseStartDate', 'warehouseEndDate', 'cfsCutoff',
    'etd', 'atd', 'eta', 'ata', 'inDcDate',
  ]

  it('renders no input the API would reject', () => {
    const unsavable = EDITABLE_FIELDS.map((f) => f.column).filter(
      (c) => !BACKEND_CORRECTABLE.includes(c),
    )
    expect(unsavable).toEqual([])
  })

  it('the warehouse SO keeps its own editable row (it used to share the SO# row)', () => {
    const wh = EDITABLE_FIELDS.find((f) => f.column === 'warehouseSo')
    expect(wh).toBeDefined()
    expect(wh?.label).toBe('Warehouse SO')
  })
})
