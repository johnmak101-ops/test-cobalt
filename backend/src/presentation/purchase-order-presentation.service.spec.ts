import { describe, it, expect } from 'vitest'
import { PurchaseOrderPresentationService } from './purchase-order-presentation.service'

const D = (s: string) => new Date(s)

const build = (over: Record<string, unknown> = {}) => {
  const bookingRepo = {
    listPos: async () => [
      {
        id: 'po1', poNumber: 'PO-1', customerId: 'c1', vendorId: 'v1', totalQuantity: 5000, quantityUnit: 'pieces',
        notes: null, createdAt: D('2026-02-01T00:00:00.000Z'), updatedAt: D('2026-02-01T00:00:00.000Z'),
        customerName: 'Cole Haan', customerCode: 'COLE', vendorName: 'Rose Knit', vendorCode: 'ROKNFT',
        shipmentCount: 1, shippedQuantity: 100, shippedUnit: 'cartons', status: 'OPEN',
      },
    ],
    shipmentSummariesByPo: async () => [
      {
        poId: 'po1', shipmentId: 's1', bookingNo: 'BK1', status: 'SAILED', legStatus: 'ACTIVE', reviewStatus: null,
        linkedQuantity: 100, containerNo: 'C1', hbl: 'H1', mbl: 'M1', scacCode: 'SCAC', vesselName: 'VESSEL',
        mode: 'SEA', polCode: 'CNYTN', podCode: 'GBFXT', polIata: null, podIata: null,
      },
    ],
    poDetail: async (id: string) => (id === 'po1' ? { po: { id: 'po1', poNumber: 'PO-1', createdAt: D('2026-02-01T00:00:00.000Z'), updatedAt: D('2026-02-01T00:00:00.000Z') }, links: [] } : null),
    ...over,
  }
  return new PurchaseOrderPresentationService(bookingRepo as any)
}

describe('PurchaseOrderPresentationService.purchaseOrders', () => {
  it('maps POs and attaches each linked shipment as a route-derived summary row', async () => {
    const { purchaseOrders } = await build().purchaseOrders()
    expect(purchaseOrders).toHaveLength(1)
    expect(purchaseOrders[0].poNumber).toBe('PO-1')
    // shipmentSummary is passed through the PO mapper as unknown[]; cast to read the derived row.
    const [summary] = purchaseOrders[0].shipmentSummary as Array<{ route: string; containerNo: string | null }>
    expect(summary.route).toBe('CNYTN→GBFXT')
    expect(summary.containerNo).toBe('C1')
  })
})

describe('PurchaseOrderPresentationService.purchaseOrder', () => {
  it('throws when the PO does not exist', async () => {
    await expect(build().purchaseOrder('nope')).rejects.toThrow()
  })
})
