import { describe, it, expect } from 'vitest'
import {
  SettingsService,
  DEFAULT_THRESHOLD,
  DEFAULT_ROUTING_MODE,
  THRESHOLD_KEY,
  ROUTING_MODE_KEY,
} from './settings.service'
import type { SettingsRepository } from '../db/repositories/settings.repository'

function fakeRepo(): SettingsRepository {
  const store: Record<string, unknown> = {}
  return {
    get: async (k: string) => store[k] ?? null,
    set: async (k: string, v: unknown) => {
      store[k] = v
    },
  } as unknown as SettingsRepository
}

describe('SettingsService', () => {
  it('confidenceThreshold defaults when absent or junk', async () => {
    const repo = fakeRepo()
    const s = new SettingsService(repo)
    expect(await s.confidenceThreshold()).toBe(DEFAULT_THRESHOLD)
    await repo.set(THRESHOLD_KEY, 'not-a-number')
    expect(await s.confidenceThreshold()).toBe(DEFAULT_THRESHOLD)
  })

  it('confidenceThreshold round-trips a valid number', async () => {
    const s = new SettingsService(fakeRepo())
    await s.setConfidenceThreshold(70, 'user-1')
    expect(await s.confidenceThreshold()).toBe(70)
  })

  it('criticRoutingMode defaults to gate when absent or junk', async () => {
    const repo = fakeRepo()
    const s = new SettingsService(repo)
    expect(await s.criticRoutingMode()).toBe(DEFAULT_ROUTING_MODE)
    await repo.set(ROUTING_MODE_KEY, 'shadow')
    expect(await s.criticRoutingMode()).toBe('gate')
  })

  it('criticRoutingMode round-trips gate and band', async () => {
    const s = new SettingsService(fakeRepo())
    await s.setCriticRoutingMode('band', 'admin-1')
    expect(await s.criticRoutingMode()).toBe('band')
    await s.setCriticRoutingMode('gate', null)
    expect(await s.criticRoutingMode()).toBe('gate')
  })
})
