/**
 * Frontend mirrors of backend enum arrays used for human-edit dropdowns.
 * Source of truth: `backend/src/db/enums.ts` (`QTY_UNIT`, `SHIPMENT_MODE`).
 * Keep these lists in lockstep — no shared FE/BE package in this monorepo.
 */
export const UOM_OPTIONS = [
  'cartons',
  'pieces',
  'cbm',
  'packages',
  'pallets',
  'units',
  'containers',
  'sets',
] as const

/**
 * Sea vs air — nothing finer. FCL/LCL was dropped end-to-end (2026-07-26): ops never filtered or
 * reported on it, and because leg identity partitions on (mode, pod) it split one shipment into two
 * legs whenever two documents stated the same move at different granularity. The agent now writes
 * only SEA/AIR (`normMode`), migration 0023 rewrote existing rows and narrowed the DB CHECK.
 */
export const MODE_OPTIONS = ['SEA', 'AIR'] as const

/** What the human-edit Mode dropdowns OFFER. Identical to MODE_OPTIONS now that the granular values
 *  are gone; kept as a separate name so the edit-surface and the validation vocabulary can diverge
 *  again without touching every call site. */
export const MODE_EDIT_OPTIONS = MODE_OPTIONS

export type UomOption = (typeof UOM_OPTIONS)[number]
export type ModeOption = (typeof MODE_OPTIONS)[number]
