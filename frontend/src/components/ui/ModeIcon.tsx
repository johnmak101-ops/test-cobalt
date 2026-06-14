import { Plane, Ship } from 'lucide-react'

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
