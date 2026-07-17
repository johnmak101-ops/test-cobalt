import { describe, it, expect } from 'vitest'
import { parseCsvLine, extractRealIataSet, parseUnlocodePorts } from './ports-sync.parse'

describe('parseCsvLine', () => {
  it('handles quoted commas', () => {
    expect(parseCsvLine('a,"b,c",d')).toEqual(['a', 'b,c', 'd'])
  })
})

describe('parseUnlocodePorts (#159)', () => {
  const header =
    'Change,Country,Location,Name,NameWoDiacritics,Subdivision,Status,Function,Date,IATA,Coordinates,Remarks'
  const unCsv = [
    header,
    ',,XX,Skip,Skip,,,----,,,,', // no country
    ',CN,SHA,Shanghai,Shanghai,,,1-3-----,,,', // sea only
    ',CN,PVG,Shanghai Pudong,Shanghai Pudong,,,---4----,,PVG,,', // air + IATA
    ',CN,CAN,Guangzhou,Guangzhou,,,1--4----,,,', // both, IATA from loc
    ',US,LAX,Los Angeles,Los Angeles,,,---4----,,,', // air, loc as IATA
    ',CN,XXX,Road only,Road only,,,--3-----,,,', // road only → drop
  ].join('\n')

  it('keeps sea (1) and air (4) only; sets mode', () => {
    const { ports } = parseUnlocodePorts(unCsv)
    const by = Object.fromEntries(ports.map((p) => [p.unlocode, p]))
    expect(by.CNSHA?.mode).toBe('sea')
    expect(by.CNSHA?.iata).toBeNull()
    expect(by.CNPVG?.mode).toBe('air')
    expect(by.CNPVG?.iata).toBe('PVG')
    expect(by.CNCAN?.mode).toBe('both')
    expect(by.CNCAN?.iata).toBe('CAN')
    expect(by.USLAX?.iata).toBe('LAX')
    expect(by.CNXXX).toBeUndefined()
  })

  it('OurAirports cross-check rejects unknown IATA', () => {
    const real = extractRealIataSet('iata_code\nPVG\nLAX\n')
    expect(real.has('PVG')).toBe(true)
    const { ports, withIata } = parseUnlocodePorts(unCsv, real)
    const by = Object.fromEntries(ports.map((p) => [p.unlocode, p]))
    expect(by.CNPVG?.iata).toBe('PVG')
    expect(by.CNCAN?.iata).toBeNull() // CAN not in real set
    expect(by.USLAX?.iata).toBe('LAX')
    expect(withIata).toBe(2)
  })

  it('empty realIata keeps UNECE IATA claims', () => {
    const { withIata } = parseUnlocodePorts(unCsv, new Set())
    expect(withIata).toBeGreaterThanOrEqual(3)
  })
})
