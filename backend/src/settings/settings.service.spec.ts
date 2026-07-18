import { describe, it, expect } from 'vitest'
import {
  SettingsService,
  DEFAULT_THRESHOLD,
  DEFAULT_ROUTING_MODE,
  THRESHOLD_KEY,
  ROUTING_MODE_KEY,
} from './settings.service'
import type { SettingsRepository } from '../db/repositories/settings.repository'
import type { RoutingShadowRepository } from '../db/repositories/routing-shadow.repository'
import type { CriticCalibrationRepository } from '../db/repositories/critic-calibration.repository'

function fakeRepo(): SettingsRepository {
  const store: Record<string, unknown> = {}
  return {
    get: async (k: string) => store[k] ?? null,
    set: async (k: string, v: unknown) => {
      store[k] = v
    },
  } as unknown as SettingsRepository
}

// These specs exercise only the settings-tunable methods, not the report methods,
// so the report repositories are unused stubs.
const stubRoutingShadow = {} as RoutingShadowRepository
const stubCriticCalibration = {} as CriticCalibrationRepository
const makeService = (repo: SettingsRepository) =>
  new SettingsService(repo, stubRoutingShadow, stubCriticCalibration)

describe('SettingsService', () => {
  it('confidenceThreshold defaults when absent or junk', async () => {
    const repo = fakeRepo()
    const s = makeService(repo)
    expect(await s.confidenceThreshold()).toBe(DEFAULT_THRESHOLD)
    await repo.set(THRESHOLD_KEY, 'not-a-number')
    expect(await s.confidenceThreshold()).toBe(DEFAULT_THRESHOLD)
  })

  it('confidenceThreshold round-trips a valid number', async () => {
    const s = makeService(fakeRepo())
    await s.setConfidenceThreshold(70, 'user-1')
    expect(await s.confidenceThreshold()).toBe(70)
  })

  it('criticRoutingMode defaults to gate when absent or junk', async () => {
    const repo = fakeRepo()
    const s = makeService(repo)
    expect(await s.criticRoutingMode()).toBe(DEFAULT_ROUTING_MODE)
    await repo.set(ROUTING_MODE_KEY, 'shadow')
    expect(await s.criticRoutingMode()).toBe('gate')
  })

  it('criticRoutingMode round-trips gate and band', async () => {
    const s = makeService(fakeRepo())
    await s.setCriticRoutingMode('band', 'admin-1')
    expect(await s.criticRoutingMode()).toBe('band')
    await s.setCriticRoutingMode('gate', null)
    expect(await s.criticRoutingMode()).toBe('gate')
  })
})
