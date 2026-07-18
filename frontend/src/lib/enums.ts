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

export const MODE_OPTIONS = ['SEA', 'SEA_FCL', 'SEA_LCL', 'AIR'] as const

export type UomOption = (typeof UOM_OPTIONS)[number]
export type ModeOption = (typeof MODE_OPTIONS)[number]
