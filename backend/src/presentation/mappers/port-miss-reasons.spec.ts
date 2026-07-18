import { describe, it, expect } from 'vitest'
import { filterPortMissReasons, isPortMasterMissReason } from './port-miss-reasons'

describe('filterPortMissReasons — suppress when ports auto-linked', () => {
  const france =
    'Cannot match "FRANCE" as a port UN/LOCODE. Add or alias the port in ShipTrack port masters (UN/LOCODE), then rematch.'
  const polMiss = 'pol "CHITTAGONG" did not exact/curated-match a port master — left unlinked'
  const other = 'No vendor code in subject or body'

  it('detects port-miss reasons', () => {
    expect(isPortMasterMissReason(france)).toBe(true)
    expect(isPortMasterMissReason(polMiss)).toBe(true)
    expect(isPortMasterMissReason(other)).toBe(false)
  })

  it('drops FRANCE ops note when both pol and pod are linked', () => {
    const out = filterPortMissReasons([france, other], { polLinked: true, podLinked: true })
    expect(out).toEqual([other])
  })

  it('drops FRANCE when either side is linked (auto-match present)', () => {
    expect(filterPortMissReasons([france], { polLinked: true, podLinked: false })).toEqual([])
    expect(filterPortMissReasons([france], { polLinked: false, podLinked: true })).toEqual([])
  })

  it('keeps field-specific miss only when that side is unlinked', () => {
    expect(filterPortMissReasons([polMiss], { polLinked: false, podLinked: true })).toEqual([polMiss])
    expect(filterPortMissReasons([polMiss], { polLinked: true, podLinked: true })).toEqual([])
  })

  it('keeps all when no ports linked', () => {
    expect(filterPortMissReasons([france, polMiss, other], { polLinked: false, podLinked: false })).toEqual([
      france,
      polMiss,
      other,
    ])
  })
})
