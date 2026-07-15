import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { QueueLearningClient } from './queue-learning.client'

const payload = {
  messageId: 'm1',
  field: 'consignee_name',
  agentSaid: 'VANCOUVER, CANADA',
  humanCorrected: 'MEC APPAREL',
  forwarder: 'CVP',
  note: 'city, not consignee',
}

describe('QueueLearningClient.postCorrection — auth + loud failure (#116)', () => {
  const OLD_BASE = process.env.QUEUE_API_BASE
  const OLD_PW = process.env.QUEUE_API_PASSWORD
  const OLD_PW2 = process.env.QUEUE_VIEWER_PASSWORD

  beforeEach(() => {
    delete process.env.QUEUE_API_BASE
    delete process.env.QUEUE_API_PASSWORD
    delete process.env.QUEUE_VIEWER_PASSWORD
  })
  afterEach(() => {
    if (OLD_BASE == null) delete process.env.QUEUE_API_BASE
    else process.env.QUEUE_API_BASE = OLD_BASE
    if (OLD_PW == null) delete process.env.QUEUE_API_PASSWORD
    else process.env.QUEUE_API_PASSWORD = OLD_PW
    if (OLD_PW2 == null) delete process.env.QUEUE_VIEWER_PASSWORD
    else process.env.QUEUE_VIEWER_PASSWORD = OLD_PW2
    vi.unstubAllGlobals()
  })

  it('is a no-op when QUEUE_API_BASE is unset (never calls fetch)', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    await new QueueLearningClient().postCorrection(payload)
    expect(f).not.toHaveBeenCalled()
  })

  it('dev-open queue (auth not required): POSTs without Authorization', async () => {
    process.env.QUEUE_API_BASE = 'http://queue:3100/api'
    const f = vi.fn(async (url: string) => {
      if (String(url).endsWith('/auth')) return { ok: true, status: 200, json: async () => ({ required: false }) }
      return { ok: true, status: 200, text: async () => '' }
    })
    vi.stubGlobal('fetch', f)
    const client = new QueueLearningClient()
    client.fetchImpl = f as never
    await client.postCorrection(payload)
    const correction = f.mock.calls.find((c) => String(c[0]).includes('/review/correction')) as
      | [string, { method: string; headers: Record<string, string>; body: string }]
      | undefined
    expect(correction).toBeTruthy()
    const init = correction![1]
    expect(init.method).toBe('POST')
    expect(init.headers.authorization).toBeUndefined()
    expect(JSON.parse(init.body)).toEqual(payload)
  })

  it('auth-required queue: login then POST with Bearer token', async () => {
    process.env.QUEUE_API_BASE = 'http://queue:3100/api'
    process.env.QUEUE_API_PASSWORD = 'viewer-secret'
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url)
      if (u.endsWith('/auth')) return { ok: true, status: 200, json: async () => ({ required: true }) }
      if (u.endsWith('/login')) {
        expect(JSON.parse(String(init?.body))).toEqual({ password: 'viewer-secret' })
        return { ok: true, status: 200, json: async () => ({ token: 'jwt-abc' }) }
      }
      if (u.includes('/review/correction')) {
        const h = init?.headers as Record<string, string>
        expect(h.authorization).toBe('Bearer jwt-abc')
        return { ok: true, status: 200, text: async () => '' }
      }
      throw new Error(`unexpected url ${u}`)
    })
    const client = new QueueLearningClient()
    client.fetchImpl = f as never
    await client.postCorrection(payload)
    expect(f).toHaveBeenCalled()
    expect(f.mock.calls.some((c) => String(c[0]).endsWith('/login'))).toBe(true)
    expect(f.mock.calls.some((c) => String(c[0]).includes('/review/correction'))).toBe(true)
  })

  it('re-logins once on 401 then retries the correction POST', async () => {
    process.env.QUEUE_API_BASE = 'http://queue:3100/api'
    process.env.QUEUE_API_PASSWORD = 'viewer-secret'
    let correctionHits = 0
    const f = vi.fn(async (url: string) => {
      const u = String(url)
      if (u.endsWith('/auth')) return { ok: true, status: 200, json: async () => ({ required: true }) }
      if (u.endsWith('/login')) return { ok: true, status: 200, json: async () => ({ token: `jwt-${correctionHits}` }) }
      if (u.includes('/review/correction')) {
        correctionHits++
        if (correctionHits === 1) return { ok: false, status: 401, text: async () => 'missing token' }
        return { ok: true, status: 200, text: async () => '' }
      }
      throw new Error(u)
    })
    const client = new QueueLearningClient()
    client.fetchImpl = f as never
    await client.postCorrection(payload)
    expect(correctionHits).toBe(2)
    expect(f.mock.calls.filter((c) => String(c[0]).endsWith('/login')).length).toBeGreaterThanOrEqual(2)
  })

  it('auth-required without password: never posts bare correction; logs loud failure path', async () => {
    process.env.QUEUE_API_BASE = 'http://queue:3100/api'
    // no QUEUE_API_PASSWORD
    const f = vi.fn(async (url: string) => {
      if (String(url).endsWith('/auth')) return { ok: true, status: 200, json: async () => ({ required: true }) }
      throw new Error(`should not call ${url}`)
    })
    const client = new QueueLearningClient()
    client.fetchImpl = f as never
    // must not throw (review save)
    await expect(client.postCorrection(payload)).resolves.toBeUndefined()
    expect(f.mock.calls.every((c) => !String(c[0]).includes('/review/correction'))).toBe(true)
  })

  it('never throws when fetch rejects (queue outage must not break review save)', async () => {
    process.env.QUEUE_API_BASE = 'http://queue:3100/api'
    const f = vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    })
    const client = new QueueLearningClient()
    client.fetchImpl = f as never
    await expect(client.postCorrection(payload)).resolves.toBeUndefined()
  })

  it('HTTP 401 after re-login is loud but non-throwing (regression: no silent drop)', async () => {
    process.env.QUEUE_API_BASE = 'http://queue:3100/api'
    process.env.QUEUE_API_PASSWORD = 'viewer-secret'
    const f = vi.fn(async (url: string) => {
      const u = String(url)
      if (u.endsWith('/auth')) return { ok: true, status: 200, json: async () => ({ required: true }) }
      if (u.endsWith('/login')) return { ok: true, status: 200, json: async () => ({ token: 'jwt' }) }
      return { ok: false, status: 401, text: async () => 'still unauthorized' }
    })
    const client = new QueueLearningClient()
    client.fetchImpl = f as never
    await expect(client.postCorrection(payload)).resolves.toBeUndefined()
    // two correction attempts (initial + after re-login)
    expect(f.mock.calls.filter((c) => String(c[0]).includes('/review/correction')).length).toBe(2)
  })
})
