import { useState } from 'react'
import { ConflictReason } from './ConflictReason'

/**
 * Flagged conflicts / review reasons, capped with a show-more toggle. Rotating-ID threads
 * (booking# → SO# → HBL#) can produce dozens of near-duplicate reasons; showing them all makes
 * the "flagged for review" panel unreadably long, so we cap and let the reviewer expand.
 */
export function ConflictList({ reasons, limit = 6 }: { reasons: string[]; limit?: number }) {
  const [open, setOpen] = useState(false)
  const unique = [...new Set(reasons)]
  const shown = open ? unique : unique.slice(0, limit)
  return (
    <>
      <ul className="list-inside list-disc space-y-0.5 text-sm text-status-warning">
        {shown.map((r, i) => (
          <li key={i}>
            <ConflictReason reason={r} />
          </li>
        ))}
      </ul>
      {unique.length > limit && (
        <button onClick={() => setOpen(!open)} className="mt-2 text-xs text-cobalt-primary hover:underline">
          {open ? 'Show less' : `+${unique.length - limit} more`}
        </button>
      )}
    </>
  )
}
