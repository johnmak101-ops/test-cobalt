import { Injectable } from '@nestjs/common'
import { SettingsRepository } from '../db/repositories/settings.repository'

export const THRESHOLD_KEY = 'confidence_threshold'
export const DEFAULT_THRESHOLD = 85

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
}
