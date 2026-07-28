import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'

/**
 * Pin a combobox's dropdown to its input using FIXED positioning, so no ancestor can clip it.
 *
 * The lists were `position: absolute` inside the picker's own `relative` wrapper, which works
 * anywhere the ancestors let content overflow. The review desk does not: `REVIEW_TD` carries
 * `overflow-hidden` (it stops a long value blowing out a `table-fixed` cell) and the decision grid's
 * wrapper carries `overflow-x-auto` — and `overflow-x: auto` computes `overflow-y: auto`, so that
 * clips vertically too. Between them the suggestion list was cut off at the row boundary: operators
 * saw one truncated option on a tall row, and on a short row a bare sliver, which reads as "the
 * search is broken" rather than "the list is behind the edge of a cell". `z-index` cannot help —
 * clipping is not a stacking question.
 *
 * Fixed positioning takes the list out of every ancestor's overflow box while leaving it in the DOM
 * where it was, so the pickers' outside-click detection (`rootRef.contains`) and focus order keep
 * working unchanged.
 *
 * The list also flips above the input when there is more room up there, which is what a row near the
 * bottom of a long card needs — the case that produced the thinnest sliver of all.
 *
 * Caveat worth knowing: a `transform`, `filter` or `contain` on an ancestor makes it the containing
 * block for fixed children, and the list would follow that instead of the viewport. Nothing on this
 * card does that today; if one is ever added, this is where it will show up.
 */
export function useAnchoredListbox(open: boolean) {
  const anchorRef = useRef<HTMLInputElement>(null)
  const [style, setStyle] = useState<CSSProperties>({ position: 'fixed', visibility: 'hidden' })

  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const el = anchorRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const gap = 4
      const below = window.innerHeight - r.bottom - gap
      const above = r.top - gap
      // Only flip when below genuinely cannot hold a usable list AND above is roomier. A list that
      // hops sides on a few pixels of scroll is worse than a slightly short one.
      const flip = below < 160 && above > below
      setStyle({
        position: 'fixed',
        left: Math.round(r.left),
        width: Math.round(r.width),
        maxHeight: Math.max(120, Math.round(flip ? above : below)),
        ...(flip
          ? { bottom: Math.round(window.innerHeight - r.top + gap) }
          : { top: Math.round(r.bottom + gap) }),
      })
    }
    place()
    // `true` — capture, so a scroll on ANY ancestor (the grid's own overflow-x box included) moves
    // the list with its input instead of leaving it stranded mid-air.
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open])

  return { anchorRef, listStyle: style }
}

/** Shared list chrome. Geometry comes from `listStyle`, so no `absolute`/`w-full`/`max-h-*` here. */
export const ANCHORED_LIST_CLASS =
  'z-50 overflow-auto rounded-lg border border-border bg-surface-800 py-1 shadow-lg'
