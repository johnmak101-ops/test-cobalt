import { Plane, Ship, ClipboardCheck } from 'lucide-react'

/** Sea/air mode glyph — lucide icons (never emoji). Renders nothing when the mode is unknown. */
export function ModeIcon({
  mode,
  size = 14,
  className = 'text-text-muted',
}: {
  mode?: string | null
  size?: number
  className?: string
}) {
  if (!mode) return null
  const Icon = mode === 'AIR' ? Plane : Ship
  return <Icon size={size} className={className} aria-label={mode === 'AIR' ? 'Air' : 'Sea'} />
}

/**
 * Table-row mode slot: fixed-width so job numbers stay aligned whether or not a glyph renders.
 * Provisional (pending-review) legs get an amber dot on the corner of the mode icon; a mode-less
 * provisional leg shows an amber clipboard glyph in the slot instead of leaving it empty.
 */
export function ModeMark({
  mode,
  reviewStatus,
  size = 16,
}: {
  mode?: string | null
  reviewStatus?: string | null
  size?: number
}) {
  const pending = reviewStatus === 'provisional'
  return (
    <span className="relative flex w-4 shrink-0 justify-center">
      {mode ? (
        <ModeIcon mode={mode} size={size} className="text-cobalt-teal" />
      ) : pending ? (
        <ClipboardCheck size={size} className="text-status-warning" aria-label="Pending review" />
      ) : null}
      {pending && mode && (
        <span
          className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-status-warning ring-2 ring-surface-800"
          aria-label="Pending review"
        />
      )}
    </span>
  )
}
