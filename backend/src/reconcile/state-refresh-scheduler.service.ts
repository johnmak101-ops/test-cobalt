import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { StateRefreshService } from './state-refresh.service'

/** Default cadence: hourly. Override with STATE_REFRESH_INTERVAL_MS (ms); 0/negative = off. */
const DEFAULT_INTERVAL_MS = 60 * 60 * 1000
/** First run shortly after boot so a restart does not wait a full interval. */
const BOOT_DELAY_MS = 30_000

/**
 * Drives StateRefreshService on a clock — the counterpart to AlertSchedulerService, and deliberately
 * the same shape so there is one pattern for "work that only the calendar can trigger".
 *
 * Slower than the alert evaluator (hourly vs 15 min) because the inputs are calendar DAYS: a leg
 * whose ETA passes at midnight is equally correct picked up at 00:05 or 00:55, and the pass touches
 * every live leg.
 */
@Injectable()
export class StateRefreshSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(StateRefreshSchedulerService.name)
  private intervalHandle: ReturnType<typeof setInterval> | null = null
  private bootHandle: ReturnType<typeof setTimeout> | null = null
  private running = false

  constructor(
    private readonly refresher: StateRefreshService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const raw = this.config.get<string>('STATE_REFRESH_INTERVAL_MS')
    const intervalMs = raw === undefined || raw === '' ? DEFAULT_INTERVAL_MS : Number(raw)
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      this.log.log('state refresh schedule disabled (STATE_REFRESH_INTERVAL_MS <= 0)')
      return
    }
    this.log.log(
      `state refresh schedule every ${Math.round(intervalMs / 1000)}s (first run in ${BOOT_DELAY_MS / 1000}s)`,
    )
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

  /** Exposed for unit tests — runs one refresh pass with overlap protection. */
  async tick(reason: string = 'manual'): Promise<{ scanned: number; applied: number } | null> {
    if (this.running) {
      this.log.warn(`state refresh skipped (still running; reason=${reason})`)
      return null
    }
    this.running = true
    try {
      const result = await this.refresher.refresh()
      this.log.log(`state refresh (${reason}): scanned=${result.scanned} promoted=${result.applied}`)
      return result
    } catch (err) {
      this.log.error(
        `state refresh failed (${reason}): ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      )
      return null
    } finally {
      this.running = false
    }
  }
}
