import { describe, expect, it } from 'vitest'
import { MASTER_RESOLUTION_KIND } from '../db/enums'

describe('master_resolution kinds', () => {
  it("includes 'vendor_role' — the group-shipper hub fact cobalt-queue relatedVendors consumes", () => {
    // SOUOCE (SOUTH OCEAN KNITTERS) is the group's B/L shipper beside a factory vendor on the same
    // shipment; the queue treats vendor_role=group_shipper as a hub relation (no vendor_code conflict).
    expect(MASTER_RESOLUTION_KIND).toContain('vendor_role')
  })
})
