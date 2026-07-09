import { type Kysely } from 'kysely'
import type { DB } from '../kysely/db.generated'

export interface EvidenceRow {
  id: string
  messageId: string | null
  fields: Record<string, unknown> | null
  matchKeys: Record<string, unknown> | null
  emailType: string | null
  poNo: string | null
  mode: string | null
  receivedAt: Date | null
  conversationId: string | null
  sender: string | null
}

/**
 * Kysely/SQL Server port of EvidenceRepository — read access to the ingest mirror
 * (parsed_record joined with email_message). JSON columns (fields/matchKeys) round-trip as objects
 * via ParseJSONResultsPlugin.
 */
export class KyselyEvidenceRepository {
  constructor(private readonly db: Kysely<DB>) {}

  /** Parsed records of specific emails (email_message ids) — the Change History's per-email replay source. */
  async forMessages(messageIds: string[]) {
    if (!messageIds.length) return [] as { messageId: string; subject: string | null; sender: string | null; receivedAt: Date | null; fields: Record<string, unknown> | null }[]
    return this.db.selectFrom('parsedRecord')
      .innerJoin('emailMessage', 'parsedRecord.messageId', 'emailMessage.id')
      .where('parsedRecord.messageId', 'in', messageIds)
      .select(['parsedRecord.messageId', 'emailMessage.subject', 'emailMessage.sender', 'emailMessage.receivedAt', 'parsedRecord.fields'])
      .execute() as Promise<{ messageId: string; subject: string | null; sender: string | null; receivedAt: Date | null; fields: Record<string, unknown> | null }[]>
  }

  allWithMessage(): Promise<EvidenceRow[]> {
    return this.db.selectFrom('parsedRecord')
      .innerJoin('emailMessage', 'parsedRecord.messageId', 'emailMessage.id')
      .select([
        'parsedRecord.id', 'parsedRecord.messageId', 'parsedRecord.fields', 'parsedRecord.matchKeys',
        'parsedRecord.emailType', 'parsedRecord.poNo', 'parsedRecord.mode',
        'emailMessage.receivedAt', 'emailMessage.conversationId', 'emailMessage.sender',
      ])
      .execute() as Promise<EvidenceRow[]>
  }

  /** Senders of the given source emails, keyed by graph_message_id. */
  async sendersByGraphIds(graphMessageIds: string[]): Promise<{ graphMessageId: string | null; sender: string | null }[]> {
    if (!graphMessageIds.length) return []
    return this.db.selectFrom('emailMessage')
      .where('graphMessageId', 'in', graphMessageIds)
      .select(['graphMessageId', 'sender'])
      .execute() as Promise<{ graphMessageId: string | null; sender: string | null }[]>
  }
}
