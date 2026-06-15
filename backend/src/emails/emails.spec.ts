import { describe, it, expect } from 'vitest'
import { EmailsService } from './emails.service'
import { mapGraphMessage, type GraphService } from './graph.service'
import type { EmailRepository } from '../db/repositories/email.repository'

const svc = (graph: Partial<GraphService>, email: Partial<EmailRepository> = { findIngested: async () => null }) =>
  new EmailsService(graph as GraphService, email as EmailRepository)

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

  it('returns the actual email when it is ingested in the shared queue', async () => {
    const r = await svc(
      { configured: () => false },
      {
        findIngested: async () => ({
          id: 'msg-1',
          graphId: null,
          subject: 'SO# FEL-GZ-OSA-2842 booking',
          sender: 'elaine.fung@fairate.com',
          receivedAt: new Date('2026-01-22T16:46:00Z'),
          bodyText: 'Please find the booking…',
          bodyHtml: null,
          sourceFile: 'booking.msg',
          attachmentCount: 1,
        }),
      },
    ).getOriginal('mock:booking.msg')
    expect(r).toMatchObject({
      available: true,
      source: 'corpus',
      subject: 'SO# FEL-GZ-OSA-2842 booking',
      from: 'elaine.fung@fairate.com',
      hasAttachments: true,
    })
    expect(r.bodyPreview).toContain('Please find')
  })
})
