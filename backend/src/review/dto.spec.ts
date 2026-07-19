import { describe, it, expect } from 'vitest'
import { ValidationPipe } from '@nestjs/common'
import { CorrectDto } from './dto'

describe('CorrectDto + ValidationPipe', () => {
  it('keeps nested field keys under transform+whitelist (must not wipe fields)', async () => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true })
    const body = {
      fields: { customerRaw: 'test', itemStyleNo: 'STY-1', vesselName: 'X' },
      reason: 'try',
      expectedUpdatedAt: '2026-07-19T00:00:00.000Z',
    }
    const out = (await pipe.transform(body, { type: 'body', metatype: CorrectDto })) as CorrectDto
    expect(out.fields).toEqual({
      customerRaw: 'test',
      itemStyleNo: 'STY-1',
      vesselName: 'X',
    })
    expect(out.reason).toBe('try')
    expect(out.expectedUpdatedAt).toBe('2026-07-19T00:00:00.000Z')
  })
})
