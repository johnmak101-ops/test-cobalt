import { describe, it, expect } from 'vitest'
import { CONFIG_PAGE_IDS, LEVEL_RANK, registryDefault, isLevel, isConfigRole } from './pages'

describe('access page registry', () => {
  it('governs alert_rules with per-role defaults; resolution_rules is retired from the matrix', () => {
    expect(CONFIG_PAGE_IDS).toEqual(['alert_rules'])
    expect(registryDefault('alert_rules', 'VIEWER')).toBe('view')
    expect(registryDefault('alert_rules', 'ADMIN')).toBe('edit')
    // Unknown / retired page → none (SUPERADMIN always edit in PageAccessService, not here)
    expect(registryDefault('resolution_rules', 'ADMIN')).toBe('none')
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
