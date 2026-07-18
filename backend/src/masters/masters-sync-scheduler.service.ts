import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { MastersRepository } from '../db/repositories/masters.repository'
import { SettingsRepository } from '../db/repositories/settings.repository'
import { MeshClient } from './mesh/mesh.client'
import { meshConfigFromEnv } from './mesh/mesh.config'
import { MastersSyncService, type SyncSummary } from './mesh/masters-sync.service'

/** Default: daily. Override with MESH_SYNC_INTERVAL_MS; 0 = Nest schedule off (CLI still works). */
const DEFAULT_INTERVAL_MS = 86_400_000
/** First attempt shortly after boot when catalog may be stale. */
const BOOT_DELAY_MS = 20_000
/** Skip boot pull when last success is newer than this (~23h). */
const FRESH_MS = 23 * 60 * 60 * 1000
export const MESH_SYNC_LAST_OK_KEY = 'mesh_sync_last_ok_at'

/**
 * Nest in-app Mesh masters sync (shiptrack#161).
 * Same upsert path as CLI `src/db/sync-masters.ts` — never deletes local rows.
 */
@Injectable()
export class MastersSyncSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(MastersSyncSchedulerService.name)
  private intervalHandle: ReturnType<typeof setInterval> | null = null
  private bootHandle: ReturnType<typeof setTimeout> | null = null
  private running = false
  private syncService: MastersSyncService | null = null

  constructor(
    private readonly masters: MastersRepository,
    private readonly settings: SettingsRepository,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const raw = this.config.get<string>('MESH_SYNC_INTERVAL_MS')
    const intervalMs =
      raw === undefined || raw === '' ? DEFAULT_INTERVAL_MS : Number(raw)
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      this.log.log('Mesh masters sync schedule disabled (MESH_SYNC_INTERVAL_MS <= 0)')
      return
    }
    try {
      // Mesh client is config-driven and shared with CLI; construct here rather than module provider.
      const cfg = meshConfigFromEnv(process.env)
      // nestjs-doctor-ignore-next-line architecture/no-manual-instantiation -- runtime Mesh config
      this.syncService = new MastersSyncService(new MeshClient(cfg), this.masters)
    } catch (e) {
      this.log.warn(
        `Mesh masters sync schedule off — ${e instanceof Error ? e.message : String(e)}`,
      )
      return
    }
    this.log.log(
      `Mesh masters sync every ${Math.round(intervalMs / 1000)}s (boot check in ${BOOT_DELAY_MS / 1000}s)`,
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

  /** Manual / test entry — runs one sync with overlap protection. */
  async tick(reason: string = 'manual'): Promise<SyncSummary[] | null> {
    if (!this.syncService) {
      this.log.warn(`Mesh sync skipped (not configured; reason=${reason})`)
      return null
    }
    if (this.running) {
      this.log.warn(`Mesh sync skipped (still running; reason=${reason})`)
      return null
    }
    if (reason === 'boot' && !(await this.shouldSyncOnBoot())) {
      this.log.log('Mesh sync boot skipped (last success still fresh)')
      return null
    }
    this.running = true
    try {
      const summary = await this.syncService.sync()
      for (const s of summary) {
        if (s.error) {
          this.log.error(
            `Mesh sync ${s.type} (${reason}): ERROR=${s.error} fetched=${s.fetched}`,
          )
        } else {
          this.log.log(
            `Mesh sync ${s.type} (${reason}): fetched=${s.fetched} inserted=${s.inserted} updated=${s.updated}`,
          )
        }
      }
      if (!summary.some((s) => s.error)) {
        await this.settings.set(MESH_SYNC_LAST_OK_KEY, new Date().toISOString())
      }
      return summary
    } catch (err) {
      this.log.error(
        `Mesh sync failed (${reason}): ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      )
      return null
    } finally {
      this.running = false
    }
  }

  /** Pure-ish policy for tests: boot runs unless last_ok is fresh, unless MESH_SYNC_ON_BOOT forces. */
  async shouldSyncOnBoot(now: number = Date.now()): Promise<boolean> {
    const force = this.config.get<string>('MESH_SYNC_ON_BOOT')
    if (force === '0' || force === 'false') return false
    if (force === '1' || force === 'true') return true
    const last = await this.settings.get<string>(MESH_SYNC_LAST_OK_KEY)
    if (!last) return true
    const t = Date.parse(last)
    if (!Number.isFinite(t)) return true
    return now - t >= FRESH_MS
  }
}
