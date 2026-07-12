import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ShipmentHistoryTimeline } from './ShipmentHistoryTimeline'
import type { HistoryEntry } from '../../hooks/use-shipment-history'

const entry = (over: Partial<HistoryEntry>): HistoryEntry => ({
  id: Math.random().toString(36).slice(2),
  shipmentId: 's1',
  field: 'bookingNo',
  oldValue: null,
  newValue: 'X',
  sourceType: 'email',
  sourceId: null,
  changedBy: null,
  isDelay: false,
  notes: null,
  changedAt: '2026-07-02T03:27:00Z',
  ...over,
})

describe('ShipmentHistoryTimeline — field titles render as human labels, not code casing', () => {
  const history: HistoryEntry[] = [
    entry({ field: 'state', newValue: 'BOOKED', sourceType: 'system', changedAt: '2026-07-03T06:35:00Z' }),
    entry({ field: 'bookingNo', newValue: 'BX831261' }),
    entry({ field: 'cargoReadyDate', newValue: '2026-07-06' }),
    entry({ field: 'grossWeight', newValue: '214.238' }),
    entry({ field: 'consigneeName', newValue: 'ALO LLC' }),
    entry({ field: 'forwarder', newValue: 'EXPEDITORS' }),
    entry({ field: 'pol', newValue: 'KHPNH' }),
    entry({ field: 'pod', newValue: 'GBBHX' }),
  ]

  it('shows the humanized labels', () => {
    render(<ShipmentHistoryTimeline history={history} />)
    for (const label of ['Status', 'Booking No.', 'Cargo Ready Date', 'Gross Weight', 'Consignee Name', 'Forwarder', 'POL', 'POD']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  it('never leaks the raw code-cased field key as a title', () => {
    render(<ShipmentHistoryTimeline history={history} />)
    for (const raw of ['bookingNo', 'cargoReadyDate', 'grossWeight', 'consigneeName', 'pol', 'pod']) {
      expect(screen.queryByText(raw)).not.toBeInTheDocument()
    }
  })

  it('renders multi-PO enrichment flags as a bullet list, not one paragraph', () => {
    const notes =
      'PO 2605358: total_quantity 692 looks like a broadcast total (same value across ≥3 POs) — verify; ' +
      'PO 2605359: total_quantity 692 looks like a broadcast total (same value across ≥3 POs) — verify; ' +
      'PO 298924: total_quantity 692 looks like a broadcast total (same value across ≥3 POs) — verify'
    render(
      <ShipmentHistoryTimeline
        history={[
          entry({
            field: 'po_enrichment_flag',
            oldValue: null,
            newValue: null,
            sourceType: 'system',
            notes,
          }),
        ]}
      />,
    )
    expect(screen.getByText('PO Enrichment Flag')).toBeInTheDocument()
    const items = screen.getAllByRole('listitem')
    expect(items.length).toBe(3)
    expect(items[0]!.textContent).toMatch(/PO 2605358: order total 692 looks like a shared shipment total/)
    expect(items[1]!.textContent).toMatch(/PO 2605359/)
    // not one long paragraph with "; "
    expect(screen.queryByText(/2605358:.*2605359:/)).not.toBeInTheDocument()
  })
})
