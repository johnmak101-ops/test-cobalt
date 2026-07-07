/**
 * Enum / role / unit translation between the production model and the new UI's contract.
 * Pure functions only — the single place the UI-facing vocabulary diverges from `../../db/contracts`.
 */

/** Leg `state` (BOOKED..DELIVERED) -> the UI's 6-state staircase (update-summary terminology). */
const STATE_TO_UI_STATUS: Record<string, string> = {
  BOOKED: 'BOOKED',
  CONFIRMED: 'CONFIRMED',
  AT_WAREHOUSE: 'AT_WAREHOUSE',
  SAILED: 'SAILED',
  RELEASED: 'DEPARTED',
  DELIVERED: 'ARRIVED',
}

export function stateToUiStatus(state: string | null | undefined, legStatus?: string | null): string {
  // A cancelled leg overrides its lifecycle state — the tracker shows Cancelled, never an active
  // Booking Request. (SUPERSEDED legs are filtered out upstream, so only ACTIVE/CANCELLED reach here.)
  if (legStatus === 'CANCELLED') return 'CANCELLED'
  return (state && STATE_TO_UI_STATUS[state]) || 'BOOKED'
}

/** Backend RBAC role -> UI display label (display only; server still enforces the real 4 ranks).
 *  SUPERADMIN stays distinct so the UI can gate the Settings page on it. */
const ROLE_TO_UI: Record<string, string> = {
  VIEWER: 'COORDINATOR',
  EDITOR: 'MANAGER',
  ADMIN: 'ADMIN',
  SUPERADMIN: 'SUPERADMIN',
}

export function mapBackendRoleToUi(role: string | null | undefined): string {
  return (role && ROLE_TO_UI[role]) || 'COORDINATOR'
}

/** Alert-rule threshold stored in hours -> whole days for the UI (round half up). */
export function thresholdHoursToDays(hours: number | null | undefined): number {
  if (typeof hours !== 'number' || !Number.isFinite(hours)) return 0
  return Math.round(hours / 24)
}
