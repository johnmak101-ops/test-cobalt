import { Injectable, Logger } from '@nestjs/common'
import { GraphService, type OriginalEmail } from './graph.service'
import { EmailRepository } from '../db/repositories/email.repository'

const MOCK_PREFIX = 'mock:'

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
}
