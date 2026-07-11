import { Inject, Injectable } from '@nestjs/common'
import { type Kysely } from 'kysely'
import type { DB } from '../kysely/db'
import { KYSELY } from '../kysely.provider'
import { keysOverlap, strongKeys } from '../../reconcile/match-keys'

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

const EVIDENCE_SELECT = [
  'parsedRecord.id', 'parsedRecord.messageId', 'parsedRecord.fields', 'parsedRecord.matchKeys',
  'parsedRecord.emailType', 'parsedRecord.poNo', 'parsedRecord.mode',
  'emailMessage.receivedAt', 'emailMessage.conversationId', 'emailMessage.sender',
] as const

/**
 * Kysely/SQL Server port of EvidenceRepository — read access to the ingest mirror
 * (parsed_record joined with email_message). JSON columns (fields/matchKeys) round-trip as objects
 * via ParseJSONResultsPlugin.
 */
@Injectable()
export class EvidenceRepository {
  constructor(@Inject(KYSELY) private readonly db: Kysely<DB>) {}

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
      .select([...EVIDENCE_SELECT])
      .execute() as Promise<EvidenceRow[]>
  }

  /**
   * SUPERSET of evidence needed for one committer.apply PO-enrichment pass — replaces
   * `allWithMessage()` on the hot path without changing resolvePoEnrichment / unattributedBrandStyle semantics.
   *
   *   (A) Message-complete: every record on any email that mentions a target PO (`po_no_norm` ∈ posNorm).
   *       Covers cross-thread PO enrich + broadcast siblings (same email, other POs).
   *   (B) No-PO residual: rows with empty `po_no_norm` whose strongKeys(matchKeys) overlap the group —
   *       covers SO-level brand/style unattributed flags on emails that never named a PO.
   *
   * `reconcile.run` still uses `allWithMessage()` (full rebuild must see every row).
   */
  async forCommitEnrichment(
    posNorm: string[],
    strongPairs: { type: string; value: string }[],
  ): Promise<EvidenceRow[]> {
    if (!posNorm.length && !strongPairs.length) return []

    const byId = new Map<string, EvidenceRow>()

    if (posNorm.length) {
      const msgRows = await this.db
        .selectFrom('parsedRecord')
        .select('messageId')
        .where('poNoNorm', 'in', posNorm)
        .execute()
      const messageIds = [...new Set(msgRows.map((r) => r.messageId))]
      if (messageIds.length) {
        const rows = await this.db
          .selectFrom('parsedRecord')
          .innerJoin('emailMessage', 'parsedRecord.messageId', 'emailMessage.id')
          .where('parsedRecord.messageId', 'in', messageIds)
          .select([...EVIDENCE_SELECT])
          .execute() as EvidenceRow[]
        for (const r of rows) byId.set(r.id, r)
      }
    }

    if (strongPairs.length) {
      const gk = new Set(strongPairs.map((p) => `${p.type}:${p.value}`))
      // Residual scan of no-PO-key rows only (much smaller than full corpus when most records have a PO).
      const noPo = await this.db
        .selectFrom('parsedRecord')
        .innerJoin('emailMessage', 'parsedRecord.messageId', 'emailMessage.id')
        .where((eb) => eb.or([eb('parsedRecord.poNoNorm', 'is', null), eb('parsedRecord.poNoNorm', '=', '')]))
        .select([...EVIDENCE_SELECT])
        .execute() as EvidenceRow[]
      for (const r of noPo) {
        if (keysOverlap(strongKeys(r.matchKeys), gk)) byId.set(r.id, r)
      }
    }

    return [...byId.values()]
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
