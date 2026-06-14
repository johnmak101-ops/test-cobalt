// Human labels for the canonical field keys the Matcher emits in conflict notes (snake_case → UI).
const FIELD_LABELS: Record<string, string> = {
  so_no: 'SO #',
  booking_no: 'Booking #',
  hbl_awb_fcr_no: 'HBL / AWB',
  mbl: 'MBL',
  container_no: 'Container',
  customer_po: 'PO',
  customer_code: 'Customer',
  vendor_code: 'Vendor',
  forwarder_name: 'Forwarder',
  consignee_name: 'Consignee',
  consignee_address: 'Consignee address',
  pol: 'POL',
  pod: 'POD',
  mode: 'Mode',
  item_style_no: 'Style',
  qty: 'Qty',
  cargo_ready_date: 'Cargo ready',
  warehouse_start_date: 'Warehouse in',
  warehouse_end_date: 'Warehouse cut-off',
  etd: 'ETD',
  atd: 'ATD',
  eta: 'ETA',
  in_dc_date: 'In DC',
}

/**
 * Renders a Matcher conflict note ("so_no: kept 'A' (Booking Request) vs 'B' (Draft B/L)") with a
 * human field label instead of the raw snake_case key. Falls back to the raw string if it doesn't
 * match the expected shape.
 */
export function ConflictReason({ reason }: { reason: string }) {
  const m = reason.match(/^([a-z_]+):\s*(.*)$/)
  if (!m) return <>{reason}</>
  return (
    <>
      <strong className="font-semibold">{FIELD_LABELS[m[1]] ?? m[1]}</strong> — {m[2]}
    </>
  )
}
