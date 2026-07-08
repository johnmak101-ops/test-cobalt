import { describe, it, expect } from 'vitest'
import { PageAccessService } from './page-access.service'
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

describe('PageAccessService', () => {
  it('falls back to the registry default when nothing is stored', async () => {
    const s = new PageAccessService(fakeRepo())
    expect(await s.levelFor('resolution_rules', 'ADMIN')).toBe('edit')
    expect(await s.levelFor('resolution_rules', 'EDITOR')).toBe('none')
    expect(await s.levelFor('alert_rules', 'VIEWER')).toBe('view')
  })

  it('SUPERADMIN is always edit, even against an override', async () => {
    const s = new PageAccessService(fakeRepo())
    await s.setMatrix({ resolution_rules: { ADMIN: 'none' } }, null)
    expect(await s.levelFor('resolution_rules', 'SUPERADMIN')).toBe('edit')
  })

  it('an override wins over the default; untouched cells keep the default', async () => {
    const s = new PageAccessService(fakeRepo())
    await s.setMatrix({ alert_rules: { EDITOR: 'edit', VIEWER: 'none' } }, 'super-1')
    expect(await s.levelFor('alert_rules', 'EDITOR')).toBe('edit')
    expect(await s.levelFor('alert_rules', 'VIEWER')).toBe('none')
    expect(await s.levelFor('alert_rules', 'ADMIN')).toBe('edit')
  })

  it('setMatrix drops SUPERADMIN entries, unknown pages, and junk levels', async () => {
    const s = new PageAccessService(fakeRepo())
    await s.setMatrix(
      {
        alert_rules: { SUPERADMIN: 'none', ADMIN: 'view' },
        ghost_page: { ADMIN: 'edit' },
        resolution_rules: { ADMIN: 'banana' },
      } as never,
      null,
    )
    const { pages } = await s.matrix()
    const alert = pages.find((p) => p.id === 'alert_rules')!
    expect(alert.levels.ADMIN).toBe('view')
    expect((alert.levels as Record<string, unknown>).SUPERADMIN).toBeUndefined()
    expect(pages.find((p) => p.id === 'ghost_page')).toBeUndefined()
    expect(pages.find((p) => p.id === 'resolution_rules')!.levels.ADMIN).toBe('edit') // junk dropped → default
  })

  it('forUser returns a level for every governed page', async () => {
    const s = new PageAccessService(fakeRepo())
    const levels = await s.forUser('ADMIN')
    expect(Object.keys(levels).sort()).toEqual(['alert_rules', 'resolution_rules'])
    expect(levels.alert_rules).toBe('edit')
  })

  it('matrix lists every page × configurable role', async () => {
    const s = new PageAccessService(fakeRepo())
    const { pages } = await s.matrix()
    expect(pages.map((p) => p.id)).toEqual(['alert_rules', 'resolution_rules'])
    expect(Object.keys(pages[0].levels).sort()).toEqual(['ADMIN', 'EDITOR', 'VIEWER'])
  })
})
