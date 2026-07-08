import { describe, it, expect } from 'vitest'
import { CONFIG_PAGE_IDS, LEVEL_RANK, registryDefault, isLevel, isConfigRole } from './pages'

describe('access page registry', () => {
  it('governs alert_rules and resolution_rules with per-role defaults', () => {
    expect(CONFIG_PAGE_IDS).toEqual(['alert_rules', 'resolution_rules', 'review_policy'])
    expect(registryDefault('resolution_rules', 'ADMIN')).toBe('edit')
    expect(registryDefault('resolution_rules', 'EDITOR')).toBe('none')
    expect(registryDefault('alert_rules', 'VIEWER')).toBe('view')
    expect(registryDefault('review_policy', 'EDITOR')).toBe('edit') // tunable → Manager edits by default
    expect(registryDefault('review_policy', 'VIEWER')).toBe('none')
  })

  it('registryDefault is none for an unknown page or a non-configurable role', () => {
    expect(registryDefault('nope', 'ADMIN')).toBe('none')
    // SUPERADMIN is not a registry column — the service special-cases it to edit, not the registry.
    expect(registryDefault('alert_rules', 'SUPERADMIN')).toBe('none')
  })

  it('levels are ordered none < view < edit', () => {
    expect(LEVEL_RANK.none).toBeLessThan(LEVEL_RANK.view)
    expect(LEVEL_RANK.view).toBeLessThan(LEVEL_RANK.edit)
  })

  it('validates levels and configurable roles', () => {
    expect(isLevel('edit')).toBe(true)
    expect(isLevel('x')).toBe(false)
    expect(isConfigRole('ADMIN')).toBe(true)
    expect(isConfigRole('SUPERADMIN')).toBe(false)
  })
})
