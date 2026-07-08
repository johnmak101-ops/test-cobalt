import { describe, it, expect } from 'vitest'
import { SettingsService } from './settings.service'
import { SettingsController } from './settings.controller'
import { REVIEW_TRIGGER_IDS } from '../decisions/review-policy'
import { PAGE_READ_KEY, PAGE_WRITE_KEY } from '../access/page-access.decorators'
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

describe('SettingsService review policy', () => {
  it('defaults to an empty enabled set', async () => {
    const s = new SettingsService(fakeRepo())
    expect(await s.reviewPolicy()).toEqual({ enabled: [] })
  })

  it('persists and reads back the enabled set (dedup + drop unknown ids)', async () => {
    const s = new SettingsService(fakeRepo())
    await s.setReviewPolicy(['conflict', 'conflict', 'made_up', 'no_po'], 'user-1')
    expect((await s.reviewPolicy()).enabled.sort()).toEqual(['conflict', 'no_po'])
  })

  it('reviewPolicyView returns the whole catalog with enabled flags', async () => {
    const s = new SettingsService(fakeRepo())
    await s.setReviewPolicy(['conflict'], null)
    const { triggers } = await s.reviewPolicyView()
    expect(triggers.length).toBe(REVIEW_TRIGGER_IDS.length)
    expect(triggers.find((t) => t.id === 'conflict')?.enabled).toBe(true)
  })
})

describe('SettingsController review-policy access (governed by the matrix, not @Roles)', () => {
  it('GET /settings/review-policy requires View on review_policy', () => {
    expect(Reflect.getMetadata(PAGE_READ_KEY, SettingsController.prototype.getReviewPolicy)).toBe('review_policy')
  })
  it('PUT /settings/review-policy requires Edit on review_policy', () => {
    expect(Reflect.getMetadata(PAGE_WRITE_KEY, SettingsController.prototype.setReviewPolicy)).toBe('review_policy')
  })
})
