import { Injectable } from '@nestjs/common'
import { SettingsRepository } from '../db/repositories/settings.repository'
import { RoutingShadowRepository } from '../db/repositories/routing-shadow.repository'
import { CriticCalibrationRepository } from '../db/repositories/critic-calibration.repository'
import { aggregateRoutingShadow } from './routing-shadow-report'
import { aggregateCriticCalibration } from './critic-calibration-report'

export const THRESHOLD_KEY = 'confidence_threshold'
export const DEFAULT_THRESHOLD = 85

export type CriticRoutingMode = 'gate' | 'band'
export const ROUTING_MODE_KEY = 'critic_routing_mode'
export const DEFAULT_ROUTING_MODE: CriticRoutingMode = 'gate'

/** Tracking-side tunables. The confidence threshold is read here and applied to route decisions;
 *  the agent only sends raw scores, so changing the line never needs an agent redeploy. */
@Injectable()
export class SettingsService {
  constructor(
    private readonly repo: SettingsRepository,
    private readonly routingShadow: RoutingShadowRepository,
    private readonly criticCalibration: CriticCalibrationRepository,
  ) {}

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

  /** How critic review influences provisional vs confirmed: gate (score threshold) or band. */
  async criticRoutingMode(): Promise<CriticRoutingMode> {
    const v = await this.repo.get<string>(ROUTING_MODE_KEY)
    if (v === 'band' || v === 'gate') return v
    return DEFAULT_ROUTING_MODE
  }

  setCriticRoutingMode(value: CriticRoutingMode, updatedBy: string | null = null) {
    return this.repo.set(ROUTING_MODE_KEY, value, updatedBy)
  }

  /** Gate vs band shadow-diff summary for the last N days (clamped 1–90, default 30). */
  async routingShadowReport(daysRaw?: string) {
    const days = Math.min(90, Math.max(1, Number(daysRaw) || 30))
    const since = new Date(Date.now() - days * 86400000)
    const rows = await this.routingShadow.listSince(since, 2000)
    return aggregateRoutingShadow(rows, days)
  }

  /** Band vs human-outcome calibration for the Phase 2b flip decision (clamped 1–180, default 90). */
  async criticCalibrationReport(daysRaw?: string) {
    const days = Math.min(180, Math.max(1, Number(daysRaw) || 90))
    const since = new Date(Date.now() - days * 86400000)
    // Read the TRUE window count alongside the (capped) rows, so a busy window reports
    // `truncated: true` instead of silently understating the 2b gate's denominator.
    const [rows, windowTotal] = await Promise.all([
      this.criticCalibration.listSince(since, 5000),
      this.criticCalibration.countSince(since),
    ])
    return aggregateCriticCalibration(rows, days, windowTotal)
  }
}
