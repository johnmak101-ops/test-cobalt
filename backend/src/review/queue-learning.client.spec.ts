import { describe, it, expect, vi, afterEach } from 'vitest'
import { QueueLearningClient } from './queue-learning.client'

const payload = { messageId: 'm1', field: 'consignee_name', agentSaid: 'VANCOUVER, CANADA', humanCorrected: 'MEC APPAREL', forwarder: 'CVP', note: 'city, not consignee' }

describe('QueueLearningClient.postCorrection — best-effort push to the queue learning feed', () => {
  const OLD = process.env.QUEUE_API_BASE
  afterEach(() => { if (OLD == null) delete process.env.QUEUE_API_BASE; else process.env.QUEUE_API_BASE = OLD; vi.unstubAllGlobals() })

  it('is a no-op when QUEUE_API_BASE is unset (never calls fetch)', async () => {
    delete process.env.QUEUE_API_BASE
    const f = vi.fn(); vi.stubGlobal('fetch', f)
    await new QueueLearningClient().postCorrection(payload)
    expect(f).not.toHaveBeenCalled()
  })

  it('POSTs the correction as JSON to {base}/review/correction', async () => {
    process.env.QUEUE_API_BASE = 'http://queue:3100/api'
    const f = vi.fn(async () => ({ ok: true, status: 200 })); vi.stubGlobal('fetch', f)
    await new QueueLearningClient().postCorrection(payload)
    expect(f).toHaveBeenCalledTimes(1)
    const call = f.mock.calls[0] as unknown as [string, { method: string; body: string }]
    expect(call[0]).toBe('http://queue:3100/api/review/correction')
    expect(call[1].method).toBe('POST')
    expect(JSON.parse(call[1].body)).toEqual(payload)
  })

  it('never throws when fetch rejects (a queue outage must not break the review save)', async () => {
    process.env.QUEUE_API_BASE = 'http://queue:3100/api'
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED') }))
    await expect(new QueueLearningClient().postCorrection(payload)).resolves.toBeUndefined()
  })
})
