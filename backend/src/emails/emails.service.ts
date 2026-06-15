import { Injectable, Logger } from '@nestjs/common'
import { GraphService, type OriginalEmail } from './graph.service'
import { EmailRepository } from '../db/repositories/email.repository'

const MOCK_PREFIX = 'mock:'

/** One renderable attachment in the email window. */
export interface EmailAttachment {
  filename: string
  label: string | null
  kind: string | null
  mime: string | null
  sizeBytes: number
  /** text/csv/html content, inline */
  text?: string | null
  /** image / pdf bytes, base64 (capped) */
  base64?: string | null
  tooLarge?: boolean
}

@Injectable()
export class EmailsService {
  private readonly log = new Logger('EmailsService')
  constructor(
    private readonly graph: GraphService,
    private readonly emails: EmailRepository,
  ) {}

  /**
   * "View original": resolve a milestone's source-email pointer to the actual email.
   *  1. ingested in the shared queue schema (same-host) → return the real subject/sender/body
   *  2. `mock:<file>` not ingested → corpus pointer, no live copy (return the filename)
   *  3. live mailbox via Graph (production), else not configured
   * Never throws — any failure degrades to `available:false` so the UI always renders.
   */
  async getOriginal(messageId: string): Promise<OriginalEmail> {
    if (!messageId) return { available: false, source: 'unconfigured', messageId: '' }

    try {
      const m = await this.emails.findIngested(messageId)
      if (m) {
        return {
          available: true,
          source: 'corpus',
          messageId,
          sourceFile: m.sourceFile,
          subject: m.subject,
          from: m.sender,
          receivedDateTime: m.receivedAt ? m.receivedAt.toISOString() : null,
          bodyPreview: m.bodyText ? m.bodyText.slice(0, 6000) : null,
          bodyText: m.bodyText,
          bodyHtml: m.bodyHtml,
          hasAttachments: (m.attachmentCount ?? 0) > 0,
        }
      }
    } catch (err) {
      this.log.warn(`local email lookup unavailable: ${String(err).slice(0, 80)}`)
    }

    if (messageId.startsWith(MOCK_PREFIX)) {
      return { available: false, source: 'corpus', messageId, sourceFile: messageId.slice(MOCK_PREFIX.length) }
    }
    if (!this.graph.configured()) {
      return { available: false, source: 'unconfigured', messageId }
    }
    try {
      return await this.graph.fetchMessage(messageId)
    } catch (err) {
      this.log.warn(`view-original fetch failed for ${messageId}: ${String(err)}`)
      return { available: false, source: 'error', messageId }
    }
  }

  /**
   * Attachments for the email window, each with inline content from the normalized store
   * (images/PDF bytes as base64, docx/xlsx/text as text). Documents float to the top so the
   * meaningful files (B/L, invoice) sit above inline signature logos. Resilient: a queue that
   * isn't co-located (2-VM split) degrades to `available:false`.
   */
  async getAttachments(messageId: string): Promise<{ available: boolean; attachments: EmailAttachment[] }> {
    if (!messageId) return { available: false, attachments: [] }
    const MAX_INLINE = 5 * 1024 * 1024 // 5 MB/part base64 cap
    try {
      const rows = await this.emails.attachmentsFor(messageId)
      const attachments: EmailAttachment[] = rows.map((r) => {
        const a: EmailAttachment = {
          filename: r.filename,
          label: r.label,
          kind: r.kind ?? r.sourceKind,
          mime: r.mime ?? r.declaredMime ?? null,
          sizeBytes: r.sizeBytes,
        }
        if (r.imageBytes) {
          if (r.imageBytes.length <= MAX_INLINE) a.base64 = r.imageBytes.toString('base64')
          else a.tooLarge = true
        } else if (r.textContent) {
          a.text = r.textContent.slice(0, 200_000)
        }
        return a
      })
      // documents (pdf/text) first, then images largest→smallest (signature logos sink)
      const rank = (a: EmailAttachment) =>
        (a.mime?.includes('pdf') || a.text != null ? 100_000_000 : 0) + a.sizeBytes
      attachments.sort((x, y) => rank(y) - rank(x))
      return { available: attachments.length > 0, attachments }
    } catch (err) {
      this.log.warn(`attachments lookup unavailable: ${String(err).slice(0, 80)}`)
      return { available: false, attachments: [] }
    }
  }
}
