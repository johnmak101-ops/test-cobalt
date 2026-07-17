/**
 * #159 — Nest monthly ports master sync (UN/LOCODE + OurAirports).
 * Pattern mirrors MastersSyncSchedulerService (Mesh daily).
 */
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { SettingsRepository } from '../db/repositories/settings.repository'
import { PortsSyncService, type PortsSyncSummary } from './ports-sync.service'

/** Default ~30 days. PORTS_SYNC_INTERVAL_MS=0 disables Nest schedule (CLI still works). */
const DEFAULT_INTERVAL_MS = 2_592_000_000
const BOOT_DELAY_MS = 45_000
/** Skip boot pull when last success newer than ~28 days. */
const FRESH_MS = 28 * 24 * 60 * 60 * 1000
export const PORTS_SYNC_LAST_OK_KEY = 'ports_sync_last_ok_at'

@Injectable()
export class PortsSyncSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(PortsSyncSchedulerService.name)
  private intervalHandle: ReturnType<typeof setInterval> | null = null
  private bootHandle: ReturnType<typeof setTimeout> | null = null
  private running = false

  constructor(
    private readonly portsSync: PortsSyncService,
    private readonly settings: SettingsRepository,
  ) {}

  onModuleInit(): void {
    const raw = process.env.PORTS_SYNC_INTERVAL_MS
    const intervalMs =
      raw === undefined || raw === '' ? DEFAULT_INTERVAL_MS : Number(raw)
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      this.log.log('Ports master sync schedule disabled (PORTS_SYNC_INTERVAL_MS <= 0)')
      return
    }
    this.log.log(
      `Ports master sync every ${Math.round(intervalMs / 86_400_000)}d (boot check in ${BOOT_DELAY_MS / 1000}s)`,
    )
    this.bootHandle = setTimeout(() => {
      void this.tick('boot')
    }, BOOT_DELAY_MS)
    this.intervalHandle = setInterval(() => {
      void this.tick('interval')
    }, intervalMs)
    this.bootHandle.unref?.()
    this.intervalHandle.unref?.()
  }

  onModuleDestroy(): void {
    if (this.bootHandle) clearTimeout(this.bootHandle)
    if (this.intervalHandle) clearInterval(this.intervalHandle)
    this.bootHandle = null
    this.intervalHandle = null
  }

  async tick(reason: string = 'manual'): Promise<PortsSyncSummary | null> {
    if (this.running) {
      this.log.warn(`Ports sync skipped (still running; reason=${reason})`)
      return null
    }
    if (reason === 'boot' && !(await this.shouldSyncOnBoot())) {
      this.log.log('Ports sync boot skipped (last success still fresh)')
      return null
    }
    this.running = true
    try {
      const summary = await this.portsSync.sync()
      if (summary.error) {
        this.log.error(
          `Ports sync (${reason}): ERROR=${summary.error} fetched=${summary.fetched}`,
        )
      } else {
        this.log.log(
          `Ports sync (${reason}): fetched=${summary.fetched} inserted=${summary.inserted} updated=${summary.updated} withIata=${summary.withIata}`,
        )
        await this.settings.set(PORTS_SYNC_LAST_OK_KEY, new Date().toISOString())
      }
      return summary
    } catch (err) {
      this.log.error(
        `Ports sync failed (${reason}): ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      )
      return null
    } finally {
      this.running = false
    }
  }

  async shouldSyncOnBoot(now: number = Date.now()): Promise<boolean> {
    const force = process.env.PORTS_SYNC_ON_BOOT
    if (force === '0' || force === 'false') return false
    if (force === '1' || force === 'true') return true
    const last = await this.settings.get<string>(PORTS_SYNC_LAST_OK_KEY)
    if (!last) return true
    const t = Date.parse(last)
    if (!Number.isFinite(t)) return true
    return now - t >= FRESH_MS
  }
}
