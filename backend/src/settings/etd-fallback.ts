import { SettingsRepository } from '../db/repositories/settings.repository'
import { ETD_FALLBACK_DEFAULTS, type EtdFallback } from '../reconcile/state'

/**
 * Transit allowances for the no-arrival-data Delivered fallback (state.ts, ops 2026-07-24):
 * a leg with no eta/ata/in-DC delivers once its departure is older than these. Stored as two
 * plain app_settings keys so the Settings page edits them like any other tunable.
 */
export const ETD_FALLBACK_AIR_KEY = 'delivered_fallback_air_days'
export const ETD_FALLBACK_SEA_KEY = 'delivered_fallback_sea_days'

const num = (v: unknown, dflt: number): number => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) && n >= 0 ? n : dflt
}

/** Current allowances, defaults when unset/garbage. Read by the committer + the state refresher. */
export async function loadEtdFallback(repo: SettingsRepository): Promise<EtdFallback> {
  const [air, sea] = await Promise.all([
    repo.get<number>(ETD_FALLBACK_AIR_KEY),
    repo.get<number>(ETD_FALLBACK_SEA_KEY),
  ])
  return {
    airDays: num(air, ETD_FALLBACK_DEFAULTS.airDays),
    seaDays: num(sea, ETD_FALLBACK_DEFAULTS.seaDays),
  }
}
