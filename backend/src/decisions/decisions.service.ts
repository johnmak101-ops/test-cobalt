import { Injectable } from '@nestjs/common'
import { CommitterService, type ReconGroup, type CommitResult } from '../reconcile/committer.service'
import { SettingsService } from '../settings/settings.service'
import { IngestRepository } from '../db/repositories/ingest.repository'
import type { CreateDecisionDto } from './dto'
import { evaluate } from './review-policy'
import { resolveEmailDisposition } from './email-disposition'

export interface DecisionResult extends Omit<CommitResult, 'action'> {
  /** `skip` = the decision was 不需處理 and acknowledged WITHOUT committing a shipment (see ingest). */
  action: CommitResult['action'] | 'skip'
  confidence: number
  reviewStatus: 'provisional' | 'confirmed' | 'skip'
}

/** What ingest returns for a 不需處理 (skip) decision — acknowledged, nothing committed. */
const SKIP_RESULT = {
  action: 'skip' as const,
  jobNo: '',
  bookingId: '',
  shipmentId: '',
  state: '',
  conflicts: [] as string[],
  skippedLockedFields: [] as string[],
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
    private readonly ingestRepo: IngestRepository,
  ) {}

  async ingest(dto: CreateDecisionDto): Promise<DecisionResult> {
    // Email disposition (matcher gates review): derive / escalate from lookupContext + payload.
    // `skip` must NOT commit — empty match-key would mint phantom JOB-XXXX legs on every ingest.
    const disp = resolveEmailDisposition(dto)
    if (disp.disposition === 'skip') {
      return { ...SKIP_RESULT, confidence: dto.confidence, reviewStatus: 'skip' }
    }

    // RECEIVE side of the cross-service push (post DB-split): cobalt-queue sends the per-email parsed
    // records + metadata that used to live in the shared evidence/queue schemas alongside the decision.
    // Persist them into our own `ingest` mirror BEFORE committing, so allWithMessage()/forMessages()
    // (PO-enrichment, Change-History) see the rows the moment the shipment they back exists. Additive:
    // legacy callers omit `evidence[]` → no ingest write (unchanged behavior).
    if (dto.evidence?.length) await this.ingestRepo.upsertFromDecision(dto.evidence)

    const threshold = await this.settings.confidenceThreshold()
    // Disposition + agent autoApply: review disposition / false autoApply → provisional; auto → confirmed
    // when autoApply true or omitted with high confidence (legacy). Safe direction only from disposition.
    let reviewStatus: 'provisional' | 'confirmed' =
      disp.disposition === 'review' || dto.autoApply === false
        ? 'provisional'
        : dto.autoApply === true
          ? 'confirmed'
          : dto.autoApply === undefined
            ? dto.confidence >= threshold ? 'confirmed' : 'provisional'
            : 'provisional'
    let reviewReasons: string[] | null = [
      ...(dto.reviewReasons ?? []),
      ...(disp.disposition === 'review' ? disp.reasons : []),
    ]
    if (!reviewReasons.length) reviewReasons = null

    // Admin-configured review policy (Settings ▸ Review Policy): an enabled trigger that matches
    // downgrades an auto-confirm to human review — safe direction only, never the reverse. Applies to
    // live agent decisions too. Empty policy (the default) → no-op. v2 lookup triggers read lookupContext.
    if (reviewStatus === 'confirmed') {
      const fired = evaluate(await this.settings.reviewPolicy(), dto)
      if (fired.length) {
        reviewStatus = 'provisional'
        reviewReasons = [...(reviewReasons ?? []), ...fired]
      }
    }

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
      poQty: dto.poQty,
      matchKeys: dto.matchKey ?? {},
      emailTypes: dto.emailTypes ?? [],
      events,
      mode: dto.mode ?? null,
      conversationId: dto.conversationId ?? null,
      cancelled: dto.cancelled ?? false,
      fromPlatform: dto.fromPlatform, // undefined → committer resolves from source-email senders

      conflicts: dto.conflicts ?? [],
      identifiers: dto.identifiers ?? [],
      entities: dto.entities ?? [],
      evidenceIds,
      confidence: dto.confidence,
      reviewStatus,
      reviewReasons,
    }

    const result = await this.committer.apply(group)
    return { ...result, confidence: dto.confidence, reviewStatus }
  }
}
