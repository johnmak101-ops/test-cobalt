import { Inject, Injectable } from '@nestjs/common'
import { eq, inArray } from 'drizzle-orm'
import * as schema from '../contracts'
import { DRIZZLE, type DrizzleDB } from '../drizzle.provider'

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

/** Read access to the ingest contract (ingest.parsed_record joined with its ingest.email_message). */
@Injectable()
export class EvidenceRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  /** Parsed records of specific emails (email_message ids) — the Change History's per-email replay source. */
  forMessages(messageIds: string[]): Promise<
    { messageId: string; subject: string | null; sender: string | null; receivedAt: Date | null; fields: Record<string, unknown> | null }[]
  > {
    if (!messageIds.length) return Promise.resolve([])
    return this.db
      .select({
        messageId: schema.ingestParsedRecord.messageId,
        subject: schema.ingestEmailMessage.subject,
        sender: schema.ingestEmailMessage.sender,
        receivedAt: schema.ingestEmailMessage.receivedAt,
        fields: schema.ingestParsedRecord.fields,
      })
      .from(schema.ingestParsedRecord)
      .innerJoin(schema.ingestEmailMessage, eq(schema.ingestParsedRecord.messageId, schema.ingestEmailMessage.id))
      .where(inArray(schema.ingestParsedRecord.messageId, messageIds))
      // unlike allWithMessage()/EvidenceRow, this method's messageId is never null: the innerJoin only
      // matches rows whose parsed_record.message_id equals a real email_message.id (ingest's column,
      // unlike evidence's, isn't declared NOT NULL — but the join makes null unreachable here regardless).
      .then((rows) => rows.map((r) => ({ ...r, messageId: r.messageId as string })))
  }

  allWithMessage(): Promise<EvidenceRow[]> {
    return this.db
      .select({
        id: schema.ingestParsedRecord.id,
        messageId: schema.ingestParsedRecord.messageId,
        fields: schema.ingestParsedRecord.fields,
        matchKeys: schema.ingestParsedRecord.matchKeys,
        emailType: schema.ingestParsedRecord.emailType,
        poNo: schema.ingestParsedRecord.poNo,
        mode: schema.ingestParsedRecord.mode,
        receivedAt: schema.ingestEmailMessage.receivedAt,
        conversationId: schema.ingestEmailMessage.conversationId,
        sender: schema.ingestEmailMessage.sender,
      })
      .from(schema.ingestParsedRecord)
      .innerJoin(schema.ingestEmailMessage, eq(schema.ingestParsedRecord.messageId, schema.ingestEmailMessage.id))
  }

  /** Senders of the given source emails, keyed by graph_message_id — used to detect a leg built entirely
   *  from the CVP notification platform (classifyKind rule (c)) on the agent/decisions path, where the DTO
   *  carries no sender. Best-effort: a 2-VM split where email_message isn't co-located returns fewer rows,
   *  which the caller treats as "not provably platform-only" (never a false demote). */
  sendersByGraphIds(graphMessageIds: string[]): Promise<{ graphMessageId: string | null; sender: string | null }[]> {
    if (!graphMessageIds.length) return Promise.resolve([])
    return this.db
      .select({ graphMessageId: schema.ingestEmailMessage.graphMessageId, sender: schema.ingestEmailMessage.sender })
      .from(schema.ingestEmailMessage)
      .where(inArray(schema.ingestEmailMessage.graphMessageId, graphMessageIds))
  }
}
