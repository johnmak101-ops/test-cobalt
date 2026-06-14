import { Injectable, Logger } from '@nestjs/common'
import { GraphService, type OriginalEmail } from './graph.service'

const MOCK_PREFIX = 'mock:'

@Injectable()
export class EmailsService {
  private readonly log = new Logger('EmailsService')
  constructor(private readonly graph: GraphService) {}

  /**
   * "View original": resolve a milestone's source-email pointer.
   *  - `mock:<file>`  → corpus/demo email, no live mailbox copy (return the filename)
   *  - Graph not configured → say so (no creds in this environment)
   *  - otherwise → fetch headers + preview from Graph
   * Never throws — a failure degrades to `available:false` so the UI always renders.
   */
  async getOriginal(messageId: string): Promise<OriginalEmail> {
    if (!messageId) return { available: false, source: 'unconfigured', messageId: '' }

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
