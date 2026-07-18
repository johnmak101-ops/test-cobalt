import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { AlertEvaluatorService } from './alert-evaluator.service'

/** Default cadence: every 15 minutes. Override with ALERT_EVAL_INTERVAL_MS (ms); 0/negative = off. */
const DEFAULT_INTERVAL_MS = 15 * 60 * 1000
/** First run shortly after boot so a restart does not wait a full interval. */
const BOOT_DELAY_MS = 15_000

/**
 * Periodically evaluates alert rules against active confirmed shipment legs.
 * Writes fired rows into `alerts` with `shipment_id` / `booking_id` (deduped per rule+leg).
 * Manual trigger remains: POST /api/alerts/evaluate.
 */
@Injectable()
export class AlertSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(AlertSchedulerService.name)
  private intervalHandle: ReturnType<typeof setInterval> | null = null
  private bootHandle: ReturnType<typeof setTimeout> | null = null
  private running = false

  constructor(
    private readonly evaluator: AlertEvaluatorService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const raw = this.config.get<string>('ALERT_EVAL_INTERVAL_MS')
    const intervalMs =
      raw === undefined || raw === ''
        ? DEFAULT_INTERVAL_MS
        : Number(raw)
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      this.log.log('alert evaluator schedule disabled (ALERT_EVAL_INTERVAL_MS <= 0)')
      return
    }
    this.log.log(`alert evaluator schedule every ${Math.round(intervalMs / 1000)}s (first run in ${BOOT_DELAY_MS / 1000}s)`)
    this.bootHandle = setTimeout(() => {
      void this.tick('boot')
    }, BOOT_DELAY_MS)
    this.intervalHandle = setInterval(() => {
      void this.tick('interval')
    }, intervalMs)
    // Don't keep the process alive solely for the timer in tests / short-lived scripts.
    this.bootHandle.unref?.()
    this.intervalHandle.unref?.()
  }

  onModuleDestroy(): void {
    if (this.bootHandle) clearTimeout(this.bootHandle)
    if (this.intervalHandle) clearInterval(this.intervalHandle)
    this.bootHandle = null
    this.intervalHandle = null
  }

  /** Exposed for unit tests — runs one evaluation pass with overlap protection. */
  async tick(reason: string = 'manual'): Promise<{ evaluated: number; fired: number } | null> {
    if (this.running) {
      this.log.warn(`alert eval skipped (still running; reason=${reason})`)
      return null
    }
    this.running = true
    try {
      const result = await this.evaluator.evaluate()
      this.log.log(
        `alert eval (${reason}): evaluated=${result.evaluated} fired=${result.fired}`,
      )
      return result
    } catch (err) {
      this.log.error(
        `alert eval failed (${reason}): ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      )
      return null
    } finally {
      this.running = false
    }
  }
}
