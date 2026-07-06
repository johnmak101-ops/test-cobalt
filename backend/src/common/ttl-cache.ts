/**
 * A trivial single-value async TTL cache. `build()` runs at most once per `ttlMs`; calls within the window
 * return the cached value, and concurrent misses share ONE in-flight build (no thundering herd). A failed
 * build is not cached — the next call retries. `now` is injectable for tests.
 *
 * Used to stop the presentation layer rebuilding the ~24,768-row master/port maps on every list / detail /
 * alerts / dashboard render (the dashboard + tracker poll every 30s per open tab).
 */
export function makeTtlCache<T>(ttlMs: number, now: () => number = () => Date.now()) {
  let cache: { at: number; value: T } | null = null
  let inflight: Promise<T> | null = null
  return function cached(build: () => Promise<T>): Promise<T> {
    if (cache && now() - cache.at < ttlMs) return Promise.resolve(cache.value)
    if (inflight) return inflight
    inflight = build().then(
      (value) => {
        cache = { at: now(), value }
        inflight = null
        return value
      },
      (err) => {
        inflight = null
        throw err
      },
    )
    return inflight
  }
}
