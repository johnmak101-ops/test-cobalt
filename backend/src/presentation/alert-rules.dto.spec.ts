import { describe, it, expect } from 'vitest'
import { ValidationPipe, BadRequestException } from '@nestjs/common'
import { SaveAlertRulesDto } from './alert-rules.dto'

const pipe = new ValidationPipe({ transform: true, whitelist: true })
const meta = { type: 'body' as const, metatype: SaveAlertRulesDto }

describe('SaveAlertRulesDto + global ValidationPipe(transform, whitelist)', () => {
  it('keeps countryThresholds keys and strips unknown rule fields', async () => {
    const out = (await pipe.transform(
      {
        rules: [
          {
            id: 'A1',
            thresholdDays: 2,
            severity: 'INFO',
            enabled: true,
            countryThresholds: { CN: 3, BD: 4 },
            name: 'client junk',
            locked: false,
            state: 'BOOKED',
          },
        ],
      },
      meta,
    )) as SaveAlertRulesDto
    expect(out.rules[0].countryThresholds).toEqual({ CN: 3, BD: 4 })
    expect(out.rules[0]).not.toHaveProperty('name')
    expect(out.rules[0]).not.toHaveProperty('locked')
    expect(out.rules[0]).not.toHaveProperty('state')
  })

  it('rejects an unknown severity', async () => {
    await expect(pipe.transform({ rules: [{ id: 'A1', severity: 'BANANA' }] }, meta)).rejects.toThrow(
      BadRequestException,
    )
  })

  it('rejects thresholdDays outside 0-30', async () => {
    await expect(pipe.transform({ rules: [{ id: 'A1', thresholdDays: 31 }] }, meta)).rejects.toThrow(
      BadRequestException,
    )
    await expect(pipe.transform({ rules: [{ id: 'A1', thresholdDays: -1 }] }, meta)).rejects.toThrow(
      BadRequestException,
    )
  })

  it('accepts a minimal payload (only id) and an explicit null countryThresholds', async () => {
    const out = (await pipe.transform(
      { rules: [{ id: 'A3', countryThresholds: null }] },
      meta,
    )) as SaveAlertRulesDto
    expect(out.rules[0].id).toBe('A3')
    expect(out.rules[0].countryThresholds).toBeNull()
  })
})
