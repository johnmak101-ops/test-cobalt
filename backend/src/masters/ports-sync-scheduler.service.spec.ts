import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  PortsSyncSchedulerService,
  PORTS_SYNC_LAST_OK_KEY,
  clampTimerMs,
  MAX_SAFE_TIMER_MS,
} from './ports-sync-scheduler.service'

describe('PortsSyncSchedulerService (#159)', () => {
  const settings = {
    store: new Map<string, string>(),
    get: async (k: string) => settings.store.get(k) ?? null,
    set: async (k: string, v: unknown) => {
      settings.store.set(k, String(v))
    },
  }
  const portsSync = {
    sync: vi.fn(async () => ({ fetched: 10, inserted: 2, updated: 8, withIata: 3 })),
  }

  beforeEach(() => {
    settings.store.clear()
    portsSync.sync.mockClear()
    delete process.env.PORTS_SYNC_ON_BOOT
    delete process.env.PORTS_SYNC_INTERVAL_MS
  })

  const envConfig = { get: (k: string) => process.env[k] } as any
  function svc() {
    return new PortsSyncSchedulerService(portsSync as never, settings as never, envConfig)
  }

  it('shouldSyncOnBoot true when never synced', async () => {
    expect(await svc().shouldSyncOnBoot()).toBe(true)
  })

  it('shouldSyncOnBoot false when last_ok fresh (<28d)', async () => {
    settings.store.set(PORTS_SYNC_LAST_OK_KEY, JSON.stringify(new Date().toISOString()))
    // settings.get parses JSON — mimic repository
    const s = {
      get: async () => new Date().toISOString(),
      set: settings.set,
    }
    const sch = new PortsSyncSchedulerService(portsSync as never, s as never, envConfig)
    expect(await sch.shouldSyncOnBoot()).toBe(false)
  })

  it('shouldSyncOnBoot true when last_ok older than 28d', async () => {
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const s = {
      get: async () => old,
      set: settings.set,
    }
    expect(await new PortsSyncSchedulerService(portsSync as never, s as never, envConfig).shouldSyncOnBoot()).toBe(
      true,
    )
  })

  it('PORTS_SYNC_ON_BOOT=0 forces skip', async () => {
    process.env.PORTS_SYNC_ON_BOOT = '0'
    expect(await svc().shouldSyncOnBoot()).toBe(false)
  })

  it('tick skips when already running (overlap)', async () => {
    const sch = svc()
    ;(sch as unknown as { running: boolean }).running = true
    expect(await sch.tick('manual')).toBeNull()
    expect(portsSync.sync).not.toHaveBeenCalled()
  })

  it('clampTimerMs caps above Node signed-32-bit max (regression: 30d → 1ms thrash)', () => {
    // 30 days in ms overflows setInterval and Node silently used delay=1
    expect(clampTimerMs(30 * 24 * 60 * 60 * 1000)).toBe(MAX_SAFE_TIMER_MS)
    expect(clampTimerMs(2_592_000_000)).toBe(MAX_SAFE_TIMER_MS)
    expect(clampTimerMs(86_400_000)).toBe(86_400_000)
  })

  it('tick records last_ok on success', async () => {
    const sets: string[] = []
    const s = {
      get: async () => null,
      set: async (k: string, v: unknown) => {
        sets.push(`${k}=${v}`)
      },
    }
    const sch = new PortsSyncSchedulerService(portsSync as never, s as never, envConfig)
    const r = await sch.tick('manual')
    expect(r?.fetched).toBe(10)
    expect(sets.some((x) => x.startsWith(PORTS_SYNC_LAST_OK_KEY))).toBe(true)
  })

  it('tick does not set last_ok on error', async () => {
    portsSync.sync.mockResolvedValueOnce({
      fetched: 0,
      inserted: 0,
      updated: 0,
      withIata: 0,
      error: 'network',
    } as { fetched: number; inserted: number; updated: number; withIata: number; error: string })
    const sets: string[] = []
    const s = {
      get: async () => null,
      set: async (k: string) => {
        sets.push(k)
      },
    }
    await new PortsSyncSchedulerService(portsSync as never, s as never, envConfig).tick('manual')
    expect(sets).not.toContain(PORTS_SYNC_LAST_OK_KEY)
  })
})
