import { Inject, Injectable } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import * as schema from '@cobalt/contracts'
import { DRIZZLE, type DrizzleDB } from '../drizzle.provider'

export interface EvidenceRow {
  id: string
  fields: Record<string, unknown> | null
  matchKeys: Record<string, unknown> | null
  emailType: string | null
  poNo: string | null
  mode: string | null
  receivedAt: Date | null
  conversationId: string | null
}

/** Read access to the evidence contract (parsed_record joined with its queue_message). */
@Injectable()
export class EvidenceRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  allWithMessage(): Promise<EvidenceRow[]> {
    return this.db
      .select({
        id: schema.parsedRecord.id,
        fields: schema.parsedRecord.fields,
        matchKeys: schema.parsedRecord.matchKeys,
        emailType: schema.parsedRecord.emailType,
        poNo: schema.parsedRecord.poNo,
        mode: schema.parsedRecord.mode,
        receivedAt: schema.queueMessage.receivedAt,
        conversationId: schema.queueMessage.conversationId,
      })
      .from(schema.parsedRecord)
      .innerJoin(schema.queueMessage, eq(schema.parsedRecord.messageId, schema.queueMessage.id))
  }
}
