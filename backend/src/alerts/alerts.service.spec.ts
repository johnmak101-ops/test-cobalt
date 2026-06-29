import { describe, it, expect } from 'vitest'
import { NotFoundException } from '@nestjs/common'
import { AlertsService } from './alerts.service'
import type { AlertRepository } from '../db/repositories/alert.repository'

/** A minimal fake AlertRepository that records setReadAt calls. */
function fakeRepo(impl: Partial<AlertRepository>): AlertRepository {
  return impl as unknown as AlertRepository
}

describe('AlertsService read / unread', () => {
  it('markRead stamps readAt with a Date (status untouched) and returns the row', async () => {
    const calls: Array<[string, Date | null]> = []
    const svc = new AlertsService(
      fakeRepo({
        async setReadAt(id: string, value: Date | null) {
          calls.push([id, value])
          return { id, readAt: value, status: 'ACTIVE' } as never
        },
      }),
    )

    const row = await svc.markRead('alert-1')

    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toBe('alert-1')
    expect(calls[0][1]).toBeInstanceOf(Date)
    expect((row as { readAt: unknown }).readAt).toBeInstanceOf(Date)
  })

  it('markUnread clears readAt (passes null)', async () => {
    let received: Date | null | undefined
    const svc = new AlertsService(
      fakeRepo({
        async setReadAt(_id: string, value: Date | null) {
          received = value
          return { id: _id, readAt: value, status: 'ACTIVE' } as never
        },
      }),
    )

    await svc.markUnread('alert-1')

    expect(received).toBeNull()
  })

  it('markRead throws NotFound when the alert is missing', async () => {
    const svc = new AlertsService(
      fakeRepo({
        async setReadAt() {
          return null
        },
      }),
    )

    await expect(svc.markRead('missing')).rejects.toBeInstanceOf(NotFoundException)
  })
})
