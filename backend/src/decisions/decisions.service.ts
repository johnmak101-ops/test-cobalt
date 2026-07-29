import { Injectable, Logger } from '@nestjs/common'
import { CommitterService, type ReconGroup, type CommitResult } from '../reconcile/committer.service'
import { SettingsService } from '../settings/settings.service'
import { IngestRepository } from '../db/repositories/ingest.repository'
import { RoutingShadowRepository } from '../db/repositories/routing-shadow.repository'
import type { CreateDecisionDto } from './dto'
import { resolveEmailDisposition } from './email-disposition'
import { assembleIngestReviewReasons } from './review-reasons-assemble'
import { collectSourceEvents } from '../reconcile/source-events'
import { resolveBandRouting, isHighBandAutoEligible } from './band-routing'
import type { CriticReview } from './critic-review.types'

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
  supersededLockedFields: [] as string[],
}

/**
 * The HTTP seam: receive a scored decision from the Agent VM, route it by confidence
 * (commit-first), and hand it to the deterministic committer. The committer owns the safety
 * invariants (upsert by match-key, field-locks, audit); we only add the review gate.
 *
 * Phase 2a: dual-computes gate vs band routing and writes routing_shadow when criticReview
 * is present. Default critic_routing_mode=gate leaves reviewStatus unchanged.
 */
@Injectable()
export class DecisionsService {
  private readonly logger = new Logger(DecisionsService.name)

  constructor(
    private readonly committer: CommitterService,
    private readonly settings: SettingsService,
    private readonly ingestRepo: IngestRepository,
    private readonly routingShadow: RoutingShadowRepository,
  ) {}

  async ingest(dto: CreateDecisionDto): Promise<DecisionResult> {
    // Email disposition (matcher gates review): derive / escalate from lookupContext + payload.
    // `skip` must NOT commit — empty match-key would mint phantom JOB-XXXX legs on every ingest.
    const disp = resolveEmailDisposition(dto)
    // #129: merge top-level matchAmbiguity into criticReview for persistence / ReviewCard
    const baseCritic = (dto.criticReview ?? null) as CriticReview | null
    const critic: CriticReview | null = dto.matchAmbiguity
      ? ({
          ...(baseCritic ?? {
            confidence: { score: dto.confidence, band: 'low', label: 'low' },
            summary: '',
            observations: [],
            priorState: { headline: '', fields: [] },
            proposedChanges: [],
            riskFlags: [],
            recommendedHumanAction: 'review',
            reasons: [],
          }),
          matchAmbiguity: dto.matchAmbiguity as CriticReview['matchAmbiguity'],
        } as CriticReview)
      : baseCritic
        ? ({
            ...baseCritic,
            // Prefer nested matchAmbiguity already on criticReview from queue embed
            matchAmbiguity:
              baseCritic.matchAmbiguity ??
              (dto.matchAmbiguity as CriticReview['matchAmbiguity'] | undefined),
          } as CriticReview)
        : null

    if (disp.disposition === 'skip') {
      // Shadow even on skip when critic present (shipmentId null — nothing committed).
      // Shadow write must never fail ingest (advisory dual-route only).
      if (critic) {
        try {
          const mode = await this.settings.criticRoutingMode()
          // Band NEVER overrides a not-actionable (skip) decision — the design pins skip, so gate and
          // band always agree here. Deriving from the critic instead would log a phantom
          // skip→provisional "diff" for legacy payloads that carry criticReview but no
          // recommendedRouting (Phase-1-era), polluting the shadow report the flip decision rests on.
          const bandRouting = 'skip' as const
          const gateRouting = 'skip' as const
          await this.routingShadow.insert({
            shipmentId: null,
            gateRouting,
            bandRouting,
            band: critic.confidence?.band ?? null,
            differs: gateRouting !== bandRouting,
            reasons: [
              ...(dto.reviewReasons ?? []),
              `gate=${gateRouting}`,
              `band=${bandRouting}`,
              mode === 'band' ? 'mode=band' : 'mode=gate',
            ],
          })
        } catch (err) {
          this.logger.warn(
            `routing_shadow insert failed: ${err instanceof Error ? err.message : String(err)}`,
          )
        }
      }
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
    // #166: do not double-concat dto.reviewReasons with disp.reasons when disposition=review
    // (email-disposition returns the same array as reasons). Union + first-wins dedupe.
    let reviewReasons: string[] | null = assembleIngestReviewReasons(dto, disp)
    if (!reviewReasons.length) reviewReasons = null
    // Cancel flag: always force Awaiting Review with "Booking cancelled" as the TOP reason.
    // Cancelled payloads that already arrive provisional would otherwise set leg_status=CANCELLED
    // without a cancel review bullet.
    if (dto.cancelled === true) {
      reviewStatus = 'provisional'
      const cancelReason = 'Booking cancelled'
      const existing = (reviewReasons ?? []).filter((r) => !/cancel/i.test(r))
      // Prepend so cancel is always first in Awaiting Review (highest priority).
      reviewReasons = [cancelReason, ...existing]
    }

    // Review Policy settings feature removed (#124). Configurable checklist triggers no longer exist.
    // Review routing is: email disposition, cancel flag, confidence threshold, agent autoApply/reasons.

    // Dual-route (Phase 2a): gate is what we'd apply today; band is what critic/recommended would apply.
    const gateRouting = reviewStatus
    const bandRouting = resolveBandRouting({
      recommendedRouting: dto.recommendedRouting,
      criticReview: critic,
    })
    const mode = await this.settings.criticRoutingMode()

    // Mode select: band only when setting is band, critic present, and bandRouting is a commit-path status.
    // Default gate leaves reviewStatus as-is (zero behavior change).
    // Append audit-ish reason so leg history shows band took over (not gate alone);
    // skip band reason on cancel — cancel audit already owns the reasons list.
    if (mode === 'band' && critic && bandRouting && bandRouting !== 'skip') {
      reviewStatus = bandRouting === 'confirmed' ? 'confirmed' : 'provisional'
      if (dto.cancelled !== true) {
        const bandReason =
          reviewStatus === 'confirmed' ? 'band auto-confirmed' : 'band held for review'
        reviewReasons = [...(reviewReasons ?? []), bandReason]
      }
    }

    // Cancel remains authoritative over band mode — re-apply after mode select.
    if (dto.cancelled === true) {
      reviewStatus = 'provisional'
    }

    // Product: high-confidence (no hard-stop flags) never enters the human Review Queue —
    // auto-confirm even when critic_routing_mode=gate. Cancel still wins above.
    if (dto.cancelled !== true && isHighBandAutoEligible(critic)) {
      reviewStatus = 'confirmed'
      if (!(reviewReasons ?? []).some((r) => /high-band auto/i.test(r))) {
        reviewReasons = [...(reviewReasons ?? []), 'high-band auto-confirmed']
      }
    }

    // Related Emails: union every channel that may carry a graph message id. Relying on
    // dto.events alone dropped links when events lacked graphId but identifiers/evidence still
    // named the source mail (leg had history, UI showed no emails).
    const evidenceIds = (dto.evidenceRefs ?? [])
      .map((r) => r.graphMessageId ?? r.graphId)
      .filter((x): x is string => !!x)
    const events = collectSourceEvents({
      events: dto.events,
      evidenceRefs: dto.evidenceRefs,
      evidence: dto.evidence,
      identifiers: dto.identifiers,
      evidenceIds,
    })

    const group: ReconGroup = {
      fields: dto.fields ?? {},
      pos: dto.pos ?? [],
      posStated: dto.posStated ?? [],
      posInferred: dto.posInferred ?? [],
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
      // Prefer merged critic (includes matchAmbiguity) over raw dto
      criticReview: critic ?? dto.criticReview ?? null,
      dualAutoTarget: dto.dualAutoTarget ?? null,
    }

    const result = await this.committer.apply(group)

    // Shadow write after commit so shipmentId is available; only when critic present.
    // Shadow write must never fail ingest (advisory dual-route only).
    if (critic && bandRouting) {
      try {
        await this.routingShadow.insert({
          shipmentId: result.shipmentId || null,
          gateRouting,
          bandRouting,
          band: critic.confidence?.band ?? null,
          differs: gateRouting !== bandRouting,
          reasons: [
            ...(dto.reviewReasons ?? []),
            `gate=${gateRouting}`,
            `band=${bandRouting}`,
            mode === 'band' ? 'mode=band' : 'mode=gate',
          ],
        })
      } catch (err) {
        this.logger.warn(
          `routing_shadow insert failed: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }

    return { ...result, confidence: dto.confidence, reviewStatus }
  }
}
