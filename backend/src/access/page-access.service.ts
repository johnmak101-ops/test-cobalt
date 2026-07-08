import { Injectable } from '@nestjs/common'
import { SettingsRepository } from '../db/repositories/settings.repository'
import {
  CONFIG_PAGES,
  CONFIG_PAGE_IDS,
  CONFIG_ROLES,
  isConfigRole,
  isLevel,
  registryDefault,
  type ConfigRole,
  type Level,
} from './pages'

/** app_settings key holding the sparse per-page/per-role override map (only non-default cells). */
export const PAGE_ACCESS_KEY = 'page_access'

type OverrideMap = Record<string, Partial<Record<ConfigRole, Level>>>

/** Resolves the effective access level for a (page, role) from the superadmin's overrides + registry
 *  defaults. SUPERADMIN is always `edit` (never stored) so it can't be locked out. */
@Injectable()
export class PageAccessService {
  constructor(private readonly repo: SettingsRepository) {}

  private async overrides(): Promise<OverrideMap> {
    const v = await this.repo.get<OverrideMap>(PAGE_ACCESS_KEY)
    return v && typeof v === 'object' ? v : {}
  }

  private resolve(ov: OverrideMap, pageId: string, role: string): Level {
    if (role === 'SUPERADMIN') return 'edit'
    const cell = isConfigRole(role) ? ov[pageId]?.[role] : undefined
    return isLevel(cell) ? cell : registryDefault(pageId, role)
  }

  /** Effective level for one page/role. */
  async levelFor(pageId: string, role: string): Promise<Level> {
    return this.resolve(await this.overrides(), pageId, role)
  }

  /** The caller's effective level for every governed page — what the frontend gates on. */
  async forUser(role: string): Promise<Record<string, Level>> {
    const ov = await this.overrides()
    return Object.fromEntries(CONFIG_PAGES.map((p) => [p.id, this.resolve(ov, p.id, role)]))
  }

  /** The full effective matrix (defaults merged with overrides) for the superadmin Access Control panel. */
  async matrix(): Promise<{ pages: { id: string; label: string; levels: Record<ConfigRole, Level> }[] }> {
    const ov = await this.overrides()
    return {
      pages: CONFIG_PAGES.map((p) => ({
        id: p.id,
        label: p.label,
        levels: Object.fromEntries(CONFIG_ROLES.map((r) => [r, this.resolve(ov, p.id, r)])) as Record<ConfigRole, Level>,
      })),
    }
  }

  /** Replace the stored overrides. Defensively drops unknown pages/roles, junk levels, and any
   *  SUPERADMIN entry (that role is not configurable). Returns the resulting matrix. */
  async setMatrix(input: OverrideMap, updatedBy: string | null = null) {
    const clean: OverrideMap = {}
    for (const [pageId, roles] of Object.entries(input ?? {})) {
      if (!CONFIG_PAGE_IDS.includes(pageId)) continue
      for (const [role, level] of Object.entries(roles ?? {})) {
        if (!isConfigRole(role) || !isLevel(level)) continue
        ;(clean[pageId] ??= {})[role] = level
      }
    }
    await this.repo.set(PAGE_ACCESS_KEY, clean, updatedBy)
    return this.matrix()
  }
}
