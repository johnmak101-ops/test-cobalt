import { Injectable } from '@nestjs/common'
import { CommitterService, type ReconGroup, type CommitResult } from '../reconcile/committer.service'
import { SettingsService } from '../settings/settings.service'
import type { CreateDecisionDto } from './dto'

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
  ) {}

  async ingest(dto: CreateDecisionDto): Promise<DecisionResult> {
    // 不需處理 (skip): a notification/invoice with no actionable shipment data — the agent gate emits `skip`
    // only when there is no PO, no strong id, AND no status field. It must NOT be committed as a shipment:
    // with an empty match-key the committer can never upsert, so it would mint a brand-new phantom JOB-XXXX
    // ACTIVE leg on EVERY ingest (surfacing in the tracker + burning a job number + duplicating on re-POST).
    // Acknowledge it without committing — the source email + parsed record are retained on the agent side.
    if (dto.disposition === 'skip') return { ...SKIP_RESULT, confidence: dto.confidence, reviewStatus: 'skip' }

    const threshold = await this.settings.confidenceThreshold()
    // The agent's deterministic review gate is AUTHORITATIVE: a gate-auto decision confirms, a gate-review
    // goes to a human — independent of the (now informational) confidence score. A shipment is legitimately
    // sparse early in its lifecycle (PO first, identity ids fill in later), so a completeness-based score must
    // NOT veto a decision the policy gate already cleared. Legacy callers that OMIT autoApply fall back to the
    // score-vs-threshold routing (unchanged).
    const reviewStatus: 'provisional' | 'confirmed' =
      dto.autoApply === undefined
        ? dto.confidence >= threshold ? 'confirmed' : 'provisional'
        : dto.autoApply ? 'confirmed' : 'provisional'

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
      entities: dto.entities ?? [],
      evidenceIds,
      confidence: dto.confidence,
      reviewStatus,
      reviewReasons: dto.reviewReasons ?? null,
    }

    const result = await this.committer.apply(group)
    return { ...result, confidence: dto.confidence, reviewStatus }
  }
}
