import { clsx, type ClassValue } from 'clsx'

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs)
}

export function formatRelativeTime(date: Date | string | number): string {
  const now = new Date()
  const d = new Date(date)
  const diffMs = now.getTime() - d.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays}d ago`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export function formatDate(date: Date | string | number | null | undefined): string {
  if (!date) return 'TBD'
  const d = new Date(date)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function formatShortDate(date: Date | string | number | null | undefined): string {
  if (!date) return 'TBD'
  const d = new Date(date)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export function parsePONumbers(json: string): string[] {
  try {
    return JSON.parse(json)
  } catch {
    return [json]
  }
}

// --- enum → human label (never show raw DB tokens like SEA_LCL / AT_WAREHOUSE in the UI) ---
const MODE_LABELS: Record<string, string> = { SEA: 'Sea', SEA_FCL: 'Sea (FCL)', SEA_LCL: 'Sea (LCL)', AIR: 'Air' }
export const modeLabel = (mode?: string | null): string => (mode ? MODE_LABELS[mode] ?? mode : '—')

const STATE_LABELS: Record<string, string> = {
  BOOKED: 'Booked',
  CONFIRMED: 'Confirmed',
  AT_WAREHOUSE: 'At Warehouse',
  SAILED: 'Sailed',
  RELEASED: 'Released',
  DELIVERED: 'Delivered',
}
export const stateLabel = (state?: string | null): string => (state ? STATE_LABELS[state] ?? state : '—')

/** Title-case a single-word enum chip (ACTIVE → Active). For compound enums, use an explicit map. */
export const titleCase = (s?: string | null): string => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : '—')
