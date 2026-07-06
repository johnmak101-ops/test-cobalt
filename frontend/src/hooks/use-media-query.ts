import { useEffect, useState } from 'react'

/**
 * SSR/jsdom-safe media-query hook. Returns `false` when `matchMedia` is
 * unavailable (jsdom, SSR), so components fall back to their mobile layout in
 * tests. On the client it reflects the current match and updates on change.
 */
export function useMediaQuery(query: string): boolean {
  const getMatch = () =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false

  const [matches, setMatches] = useState(getMatch)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return matches
}
