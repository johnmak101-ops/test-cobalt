import { Injectable } from '@nestjs/common'
import { SettingsRepository } from '../db/repositories/settings.repository'
import { REVIEW_TRIGGER_IDS, catalogView, type ReviewPolicy } from '../decisions/review-policy'

export const THRESHOLD_KEY = 'confidence_threshold'
export const DEFAULT_THRESHOLD = 85
export const REVIEW_POLICY_KEY = 'review_policy'

/** Tracking-side tunables. The confidence threshold is read here and applied to route decisions;
 *  the agent only sends raw scores, so changing the line never needs an agent redeploy. */
@Injectable()
export class SettingsService {
  constructor(private readonly repo: SettingsRepository) {}

  /** Confidence cutoff (0-100): a decision scoring >= this auto-confirms; below goes to review. */
  async confidenceThreshold(): Promise<number> {
    const v = await this.repo.get<number>(THRESHOLD_KEY)
    if (v == null) return DEFAULT_THRESHOLD // absent → default (NOT Number(null)===0, which would confirm everything)
    const n = typeof v === 'number' ? v : Number(v)
    return Number.isFinite(n) ? n : DEFAULT_THRESHOLD
  }

  setConfidenceThreshold(value: number, updatedBy: string | null = null) {
    return this.repo.set(THRESHOLD_KEY, value, updatedBy)
  }

  /** Enabled review-trigger ids (unknown ids dropped so a shrunk catalog can't break routing). */
  async reviewPolicy(): Promise<ReviewPolicy> {
    const v = await this.repo.get<{ enabled?: unknown }>(REVIEW_POLICY_KEY)
    const enabled = Array.isArray(v?.enabled)
      ? (v!.enabled as unknown[]).filter((id): id is string => typeof id === 'string' && REVIEW_TRIGGER_IDS.includes(id))
      : []
    return { enabled }
  }

  /** Catalog + enabled state for the Review Policy Settings panel. */
  async reviewPolicyView(): Promise<{ triggers: { id: string; label: string; enabled: boolean }[] }> {
    const { enabled } = await this.reviewPolicy()
    return { triggers: catalogView(enabled) }
  }

  /** Persist the enabled set (dedup + drop unknown ids). Returns the resulting view. */
  async setReviewPolicy(enabled: string[], updatedBy: string | null = null) {
    const clean = [...new Set(enabled)].filter((id) => REVIEW_TRIGGER_IDS.includes(id))
    await this.repo.set(REVIEW_POLICY_KEY, { enabled: clean }, updatedBy)
    return this.reviewPolicyView()
  }
}
