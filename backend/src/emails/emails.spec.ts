import { describe, it, expect } from 'vitest'
import { EmailsService } from './emails.service'
import { mapGraphMessage, type GraphService } from './graph.service'

const svc = (graph: Partial<GraphService>) => new EmailsService(graph as GraphService)

describe('mapGraphMessage', () => {
  it('maps a Graph message resource to the DTO', () => {
    const dto = mapGraphMessage('AAA', {
      subject: 'Booking',
      from: { emailAddress: { address: 'fwd@gfs.com', name: 'GFS' } },
      receivedDateTime: '2026-02-10T00:00:00Z',
      bodyPreview: 'please find',
      webLink: 'https://outlook/x',
      hasAttachments: true,
    })
    expect(dto).toMatchObject({
      available: true,
      source: 'graph',
      messageId: 'AAA',
      subject: 'Booking',
      from: 'fwd@gfs.com',
      hasAttachments: true,
    })
  })
})

describe('EmailsService.getOriginal', () => {
  it('returns corpus for mock: ids without touching Graph', async () => {
    const r = await svc({
      configured: () => true,
      fetchMessage: async () => {
        throw new Error('should not be called for corpus ids')
      },
    }).getOriginal('mock:20260122 booking.msg')
    expect(r).toMatchObject({ available: false, source: 'corpus', sourceFile: '20260122 booking.msg' })
  })

  it('returns unconfigured when Graph creds are absent', async () => {
    const r = await svc({ configured: () => false }).getOriginal('REAL-ID')
    expect(r).toMatchObject({ available: false, source: 'unconfigured' })
  })

  it('fetches from Graph for a real id when configured', async () => {
    const r = await svc({
      configured: () => true,
      fetchMessage: async (id) => ({ available: true, source: 'graph', messageId: id, subject: 'S' }),
    }).getOriginal('REAL-ID')
    expect(r).toMatchObject({ available: true, source: 'graph', subject: 'S' })
  })

  it('degrades to error (never throws) when the Graph fetch fails', async () => {
    const r = await svc({
      configured: () => true,
      fetchMessage: async () => {
        throw new Error('graph 500')
      },
    }).getOriginal('REAL-ID')
    expect(r).toMatchObject({ available: false, source: 'error' })
  })

  it('treats an empty id as unconfigured', async () => {
    const r = await svc({ configured: () => true }).getOriginal('')
    expect(r.available).toBe(false)
  })
})
