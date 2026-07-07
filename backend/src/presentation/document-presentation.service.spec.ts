import { describe, it, expect } from 'vitest'
import { DocumentPresentationService } from './document-presentation.service'

const build = (over: Record<string, unknown> = {}) => {
  const shipmentRepo = {
    documents: async () => [
      { id: 'd1', customerName: 'Cole Haan', emailType: 'PACKING_LIST', senderType: 'vendor', poNumbers: ['PO-1', 'PO-2'], qty: 100, qtyUnit: 'cartons', receivedAt: new Date('2026-02-10T00:00:00.000Z') },
    ],
    documentDetail: async (id: string) => (id === 'd1' ? { id: 'd1', customerName: 'Cole Haan', emailType: 'PACKING_LIST', senderType: 'vendor', poNumbers: ['PO-1'], qty: 100, qtyUnit: 'cartons', receivedAt: new Date('2026-02-10T00:00:00.000Z'), emailId: 'e1' } : null),
    kindOf: async (id: string) => (id === 'd1' ? 'DOCUMENT' : id === 's1' ? 'SHIPMENT' : null),
    dismissDocument: async () => undefined,
    linkDocument: async () => undefined,
    ...over,
  }
  return new DocumentPresentationService(shipmentRepo as any)
}

describe('DocumentPresentationService.documents', () => {
  it('lists unlinked documents with poCount derived from poNumbers', async () => {
    const { documents } = await build().documents()
    expect(documents).toHaveLength(1)
    expect(documents[0].poCount).toBe(2)
  })
})

describe('DocumentPresentationService.dismissDocument', () => {
  it('rejects dismissing a row that is not an unlinked document', async () => {
    await expect(build().dismissDocument('s1')).rejects.toThrow(/not an unlinked document/)
  })
  it('throws not-found for an unknown id', async () => {
    await expect(build().dismissDocument('nope')).rejects.toThrow()
  })
})
