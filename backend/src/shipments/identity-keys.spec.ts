import { describe, expect, it, vi } from 'vitest'
import { syncIdentityMatchKeys, LEG_COLUMN_TO_KEY } from './identity-keys'

const repo = (existingMatchKeys: Record<string, unknown>) => ({
  findById: vi.fn().mockResolvedValue({ matchKeys: existingMatchKeys }),
  updateLeg: vi.fn().mockResolvedValue(undefined),
  replaceMatchKeys: vi.fn().mockResolvedValue(undefined),
})

describe('syncIdentityMatchKeys', () => {
  it('folds a typed booking into match_keys and rebuilds the index', async () => {
    const r = repo({ conversation_id: 'CONV-1' })
    const changed = await syncIdentityMatchKeys(r, 'S1', { bookingNo: 'BX845666' })
    expect(changed).toBe(true)
    expect(r.updateLeg).toHaveBeenCalledWith('S1', {
      matchKeys: { conversation_id: 'CONV-1', booking_no: 'BX845666' },
    })
    expect(r.replaceMatchKeys).toHaveBeenCalledTimes(1)
  })

  it('non-identity edits are a no-op (no writes at all)', async () => {
    const r = repo({})
    const changed = await syncIdentityMatchKeys(r, 'S1', { etd: '2026-08-01', qty: 5 })
    expect(changed).toBe(false)
    expect(r.updateLeg).not.toHaveBeenCalled()
    expect(r.replaceMatchKeys).not.toHaveBeenCalled()
  })

  it('covers all five strong columns', () => {
    expect(Object.keys(LEG_COLUMN_TO_KEY).sort()).toEqual(
      ['bookingNo', 'containerNo', 'hblAwbFcrNo', 'mbl', 'soNo'].sort(),
    )
  })
})
