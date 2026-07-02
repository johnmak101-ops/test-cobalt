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

/** Date + wall-clock time — thread emails often land hours apart on the same day. */
export function formatDateTime(date: Date | string | number | null | undefined): string {
  if (!date) return 'TBD'
  const d = new Date(date)
  const day = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return `${day} ${time}`
}

/**
 * Date, plus the wall-clock time WHEN one was actually stated ("截仓时间 6.29 15:00" → "29 Jun 2026 15:00").
 * Cut-off style deadlines carry operationally-critical times; plain dates (midnight local) stay date-only.
 */
export function formatDateMaybeTime(date: Date | string | number | null | undefined): string {
  if (!date) return 'TBD'
  const d = new Date(date)
  if (d.getHours() === 0 && d.getMinutes() === 0) return formatDate(d)
  return formatDateTime(d)
}

export function parsePONumbers(json: string): string[] {
  try {
    return JSON.parse(json)
  } catch {
    return [json]
  }
}
