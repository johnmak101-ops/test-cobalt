import { describe, it, expect } from 'vitest'
import { EmailsService } from './emails.service'
import { mapGraphMessage, type GraphService } from './graph.service'
import type { EmailRepository } from '../db/repositories/email.repository'

const svc = (graph: Partial<GraphService>, email: Partial<EmailRepository> = { findIngested: async () => null }) =>
  new EmailsService(graph as GraphService, email as EmailRepository)

// attachmentsFor/attachmentById read the flat `ingest.email_attachment` mirror — one row per file,
// no `queue_normalized` fan-out. A loosely-typed fake keeps these tests decoupled from Drizzle's
// query-builder return types (attachmentById isn't `async` on the real repo).
type FakeAttachmentRow = {
  attachmentId: string
  filename: string
  sourceKind: string | null
  sizeBytes: number
  declaredMime: string | null
  rawBytes: Buffer | null
  graphAttachmentId: string | null
  messageGraphId: string
}
const attachmentRow = (over: Partial<FakeAttachmentRow> = {}): FakeAttachmentRow => ({
  attachmentId: 'att-1',
  filename: 'invoice.pdf',
  sourceKind: 'text_pdf',
  sizeBytes: 10,
  declaredMime: 'application/pdf',
  rawBytes: null,
  graphAttachmentId: 'graph-att-1',
  messageGraphId: 'graph-msg-1',
  ...over,
})
const attachmentsSvc = (email: {
  attachmentsFor?: (graphMessageId: string) => Promise<FakeAttachmentRow[]>
  attachmentById?: (attachmentId: string) => Promise<FakeAttachmentRow[]>
}) => new EmailsService({} as GraphService, email as unknown as EmailRepository)

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

  it('maps an html body into bodyHtml (bodyText stays null)', () => {
    const dto = mapGraphMessage('B', { body: { contentType: 'html', content: '<p>hi</p>' } })
    expect(dto.bodyHtml).toBe('<p>hi</p>')
    expect(dto.bodyText).toBeNull()
  })

  it('maps a text body into bodyText (bodyHtml stays null)', () => {
    const dto = mapGraphMessage('C', { body: { contentType: 'text', content: 'plain body' } })
    expect(dto.bodyText).toBe('plain body')
    expect(dto.bodyHtml).toBeNull()
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

  it('returns the actual email when it is ingested in the ingest mirror', async () => {
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

  it('re-fetches the full body from Graph when a Graph-sourced email has no local body (purged)', async () => {
    let fetchedId: string | null = null
    const r = await svc(
      {
        configured: () => true,
        fetchMessage: async (id) => {
          fetchedId = id
          return { available: true, source: 'graph', messageId: id, bodyHtml: '<p>the original</p>', bodyPreview: 'the original' }
        },
      },
      {
        findIngested: async () => ({
          id: 'msg-2',
          graphId: 'GRAPH-XYZ',
          subject: 'Booking',
          sender: 'a@b.com',
          receivedAt: new Date('2026-02-01T00:00:00Z'),
          bodyText: null,
          bodyHtml: null,
          sourceFile: null,
          attachmentCount: 0,
        }),
      },
    ).getOriginal('msg-key')
    expect(fetchedId).toBe('GRAPH-XYZ') // re-fetch keyed by the stored mailbox id, not the internal key
    expect(r).toMatchObject({ available: true, source: 'graph', subject: 'Booking', from: 'a@b.com' })
    expect(r.bodyHtml).toBe('<p>the original</p>')
  })

  it('flags bodyPurged when a Graph-sourced email lost its body and Graph is unavailable', async () => {
    const r = await svc(
      { configured: () => false },
      {
        findIngested: async () => ({
          id: 'msg-3',
          graphId: 'GID',
          subject: 'X',
          sender: 'a@b.com',
          receivedAt: null,
          bodyText: null,
          bodyHtml: null,
          sourceFile: null,
          attachmentCount: 2,
        }),
      },
    ).getOriginal('msg-key')
    expect(r).toMatchObject({ available: true, source: 'corpus', bodyPurged: true })
    expect(r.bodyText).toBeNull()
  })

  it('does NOT hit Graph for corpus mail (no graphId) with an empty body', async () => {
    const r = await svc(
      {
        configured: () => true,
        fetchMessage: async () => {
          throw new Error('should not be called for corpus mail')
        },
      },
      {
        findIngested: async () => ({
          id: 'msg-4',
          graphId: null,
          subject: 'C',
          sender: 'a@b.com',
          receivedAt: null,
          bodyText: null,
          bodyHtml: null,
          sourceFile: 'x.msg',
          attachmentCount: 0,
        }),
      },
    ).getOriginal('msg-key')
    expect(r).toMatchObject({ available: true, source: 'corpus', bodyPurged: false })
  })
})

describe('EmailsService.getAttachments', () => {
  it('serves base64 straight from rawBytes — one row per file, no per-part collapse', async () => {
    const bytes = Buffer.from('hello world')
    const r = await attachmentsSvc({
      attachmentsFor: async () => [attachmentRow({ rawBytes: bytes })],
    }).getAttachments('m1')
    expect(r.available).toBe(true)
    expect(r.attachments).toHaveLength(1)
    expect(r.attachments[0]).toMatchObject({
      filename: 'invoice.pdf',
      label: null,
      kind: 'text_pdf',
      mime: 'application/pdf',
      base64: bytes.toString('base64'),
    })
    expect(r.attachments[0].parsedOnly).toBeUndefined()
    expect(r.attachments[0].tooLarge).toBeUndefined()
  })

  it('flags parsedOnly for an office kind with no local rawBytes (fetch is a later task)', async () => {
    const r = await attachmentsSvc({
      attachmentsFor: async () => [
        attachmentRow({ filename: 'po.docx', sourceKind: 'docx', declaredMime: 'application/vnd.msword', rawBytes: null }),
      ],
    }).getAttachments('m1')
    expect(r.attachments[0]).toMatchObject({ kind: 'docx', parsedOnly: true })
    expect(r.attachments[0].base64).toBeUndefined()
  })

  it('leaves a non-office kind with no rawBytes as bare metadata (not parsedOnly)', async () => {
    const r = await attachmentsSvc({
      attachmentsFor: async () => [
        attachmentRow({ filename: 'logo.png', sourceKind: 'image', declaredMime: 'image/png', rawBytes: null }),
      ],
    }).getAttachments('m1')
    expect(r.attachments[0]).toMatchObject({ kind: 'image' })
    expect(r.attachments[0].base64).toBeUndefined()
    expect(r.attachments[0].parsedOnly).toBeUndefined()
  })

  it('flags tooLarge when rawBytes exceeds the inline cap', async () => {
    const big = Buffer.alloc(13 * 1024 * 1024)
    const r = await attachmentsSvc({ attachmentsFor: async () => [attachmentRow({ rawBytes: big })] }).getAttachments('m1')
    expect(r.attachments[0].tooLarge).toBe(true)
    expect(r.attachments[0].base64).toBeUndefined()
  })

  it('ranks documents (office/pdf) above images regardless of arrival order or size', async () => {
    const r = await attachmentsSvc({
      attachmentsFor: async () => [
        attachmentRow({
          attachmentId: 'a-img', filename: 'sig.png', sourceKind: 'image', declaredMime: 'image/png',
          sizeBytes: 999_999, rawBytes: Buffer.from('x'),
        }),
        attachmentRow({
          attachmentId: 'a-doc', filename: 'invoice.pdf', sourceKind: 'text_pdf', declaredMime: 'application/pdf',
          sizeBytes: 10, rawBytes: Buffer.from('y'),
        }),
      ],
    }).getAttachments('m1')
    expect(r.attachments.map((a) => a.filename)).toEqual(['invoice.pdf', 'sig.png'])
  })

  it('returns unavailable for an empty messageId without querying the repository', async () => {
    const r = await attachmentsSvc({
      attachmentsFor: async () => {
        throw new Error('should not be called')
      },
    }).getAttachments('')
    expect(r).toEqual({ available: false, attachments: [] })
  })

  it('degrades to unavailable (never throws) when the repository lookup fails', async () => {
    const r = await attachmentsSvc({
      attachmentsFor: async () => {
        throw new Error('db down')
      },
    }).getAttachments('m1')
    expect(r).toEqual({ available: false, attachments: [] })
  })
})

describe('EmailsService.getAttachmentOriginal', () => {
  it('returns the original bytes when rawBytes is present', async () => {
    const body = Buffer.from('the real docx')
    const r = await attachmentsSvc({
      attachmentById: async () => [attachmentRow({ filename: 'po.docx', declaredMime: 'application/msword', rawBytes: body })],
    }).getAttachmentOriginal('att-1')
    expect(r).toEqual({ filename: 'po.docx', mime: 'application/msword', body })
  })

  it('falls back to octet-stream when declaredMime is null', async () => {
    const body = Buffer.from('bytes')
    const r = await attachmentsSvc({
      attachmentById: async () => [attachmentRow({ declaredMime: null, rawBytes: body })],
    }).getAttachmentOriginal('att-1')
    expect(r?.mime).toBe('application/octet-stream')
  })

  it('returns null when there is no local rawBytes yet (pre-Graph-fallback)', async () => {
    const r = await attachmentsSvc({
      attachmentById: async () => [attachmentRow({ rawBytes: null })],
    }).getAttachmentOriginal('att-1')
    expect(r).toBeNull()
  })

  it('returns null when the attachment id is unknown', async () => {
    const r = await attachmentsSvc({ attachmentById: async () => [] }).getAttachmentOriginal('missing')
    expect(r).toBeNull()
  })

  it('returns null for an empty attachment id without querying the repository', async () => {
    const r = await attachmentsSvc({
      attachmentById: async () => {
        throw new Error('should not be called')
      },
    }).getAttachmentOriginal('')
    expect(r).toBeNull()
  })
})
