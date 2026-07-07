import { describe, it, expect } from 'vitest'
import { EmailPresentationService } from './email-presentation.service'

const build = (over: Record<string, unknown> = {}) => {
  const emailRepo = {
    listInbox: async () => [],
    attachmentsByMessageId: async () => [
      { attachmentId: 'a1', filename: 'invoice.pdf', declaredMime: 'application/octet-stream', sizeBytes: 100, createdAt: new Date('2026-02-10T00:00:00.000Z') },
      { attachmentId: 'a2', filename: 'photo.JPG', declaredMime: null, sizeBytes: 200, createdAt: new Date('2026-02-10T00:00:00.000Z') },
    ],
    emailBody: async () => null,
    thread: async () => [],
    unreadCount: async () => 7,
    markRead: async () => ({ ok: true }),
    ingestionStatus: async () => ({ count: 0, lastAt: null }),
    ingestState: async () => null,
    ...over,
  }
  return new EmailPresentationService(emailRepo as any)
}

describe('EmailPresentationService.emailAttachments', () => {
  it('infers real mime type from the filename extension when declared is octet-stream/null', async () => {
    const { attachments } = await build().emailAttachments('m1')
    expect(attachments[0].mimeType).toBe('application/pdf') // .pdf overrides octet-stream
    expect(attachments[1].mimeType).toBe('image/jpeg') // .JPG inferred (case-insensitive) from null
  })
})

describe('EmailPresentationService.emailsUnreadCount', () => {
  it('delegates the unread badge count', async () => {
    expect(await build().emailsUnreadCount()).toEqual({ unread: 7 })
  })
})

describe('EmailPresentationService.emailIntegrationTest', () => {
  it('reports that credentials live in the ingestion service (read-only governance)', () => {
    const r = build().emailIntegrationTest()
    expect(r.success).toBe(true)
    expect(r.message).toMatch(/ingestion service/i)
  })
})
