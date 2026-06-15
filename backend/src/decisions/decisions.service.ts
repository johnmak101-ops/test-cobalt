import { Injectable } from '@nestjs/common'
import { CommitterService, type ReconGroup, type CommitResult } from '../reconcile/committer.service'
import { SettingsService } from '../settings/settings.service'
import type { CreateDecisionDto } from './dto'

export interface DecisionResult extends CommitResult {
  confidence: number
  reviewStatus: 'provisional' | 'confirmed'
}

/**
 * The HTTP seam: receive a scored decision from the Agent VM, route it by confidence
 * (commit-first), and hand it to the deterministic committer. The committer owns the safety
 * invariants (upsert by match-key, field-locks, audit); we only add the review gate.
 */
@Injectable()
export class DecisionsService {
  constructor(
    private readonly committer: CommitterService,
    private readonly settings: SettingsService,
  ) {}

  async ingest(dto: CreateDecisionDto): Promise<DecisionResult> {
    const threshold = await this.settings.confidenceThreshold()
    const reviewStatus: 'provisional' | 'confirmed' = dto.confidence >= threshold ? 'confirmed' : 'provisional'

    const events = (dto.events ?? []).map((e) => ({
      emailType: e.emailType,
      receivedAt: e.receivedAt,
      graphId: e.graphId ?? null,
    }))
    const evidenceIds = (dto.evidenceRefs ?? [])
      .map((r) => r.graphMessageId ?? r.graphId)
      .filter((x): x is string => !!x)

    const group: ReconGroup = {
      fields: dto.fields ?? {},
      pos: dto.pos ?? [],
      matchKeys: dto.matchKey ?? {},
      emailTypes: dto.emailTypes ?? [],
      events,
      mode: dto.mode ?? null,
      conversationId: dto.conversationId ?? null,
      conflicts: dto.conflicts ?? [],
      identifiers: dto.identifiers ?? [],
      evidenceIds,
      confidence: dto.confidence,
      reviewStatus,
    }

    const result = await this.committer.apply(group)
    return { ...result, confidence: dto.confidence, reviewStatus }
  }
}
