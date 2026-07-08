import { describe, it, expect, vi } from 'vitest'
import { makeTtlCache } from './ttl-cache'

describe('makeTtlCache', () => {
  it('builds once within the TTL, rebuilds after it expires', async () => {
    let t = 1000
    const cache = makeTtlCache<number>(100, () => t)
    const build = vi.fn(async () => t)
    expect(await cache(build)).toBe(1000)
    t = 1050
    expect(await cache(build)).toBe(1000) // within TTL → cached, build not re-run
    expect(build).toHaveBeenCalledTimes(1)
    t = 1200
    expect(await cache(build)).toBe(1200) // TTL expired → rebuilt
    expect(build).toHaveBeenCalledTimes(2)
  })

  it('shares one in-flight build across concurrent misses (no thundering herd)', async () => {
    const t = 0
    const cache = makeTtlCache<string>(1000, () => t)
    let resolve!: (v: string) => void
    const build = vi.fn(() => new Promise<string>((r) => (resolve = r)))
    const a = cache(build)
    const b = cache(build)
    expect(build).toHaveBeenCalledTimes(1)
    resolve('X')
    expect(await a).toBe('X')
    expect(await b).toBe('X')
  })

  it('does not cache a failed build — the next call retries', async () => {
    const cache = makeTtlCache<number>(1000, () => 0)
    const build = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(42)
    await expect(cache(build)).rejects.toThrow('boom')
    expect(await cache(build)).toBe(42)
    expect(build).toHaveBeenCalledTimes(2)
  })
})
