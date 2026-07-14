/**
 * Config-page access registry. Each governed page declares its per-role DEFAULT level; a superadmin
 * overrides those at runtime (stored in app_settings, applied by PageAccessService). Governing a new
 * config page = append one entry here — the API and the Access Control matrix UI adapt automatically.
 */

export type Level = 'none' | 'view' | 'edit'
export const LEVELS: readonly Level[] = ['none', 'view', 'edit']
export const LEVEL_RANK: Record<Level, number> = { none: 0, view: 1, edit: 2 }

/** Roles that appear as configurable columns. SUPERADMIN is intentionally absent — it is always `edit`. */
export const CONFIG_ROLES = ['VIEWER', 'EDITOR', 'ADMIN'] as const
export type ConfigRole = (typeof CONFIG_ROLES)[number]

export interface ConfigPage {
  id: string
  label: string
  defaults: Record<ConfigRole, Level>
}

export const CONFIG_PAGES: ConfigPage[] = [
  { id: 'alert_rules', label: 'Alert Rules', defaults: { VIEWER: 'view', EDITOR: 'view', ADMIN: 'edit' } },
  { id: 'resolution_rules', label: 'Resolution Rules', defaults: { VIEWER: 'none', EDITOR: 'none', ADMIN: 'edit' } },
]

export const CONFIG_PAGE_IDS = CONFIG_PAGES.map((p) => p.id)

export const isLevel = (v: unknown): v is Level => typeof v === 'string' && (LEVELS as readonly string[]).includes(v)
export const isConfigRole = (v: unknown): v is ConfigRole =>
  typeof v === 'string' && (CONFIG_ROLES as readonly string[]).includes(v)

/** The seeded default level for a page/role — `none` for an unknown page or a non-configurable role. */
export function registryDefault(pageId: string, role: string): Level {
  const page = CONFIG_PAGES.find((p) => p.id === pageId)
  if (!page || !isConfigRole(role)) return 'none'
  return page.defaults[role]
}
