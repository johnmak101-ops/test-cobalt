/**
 * Pure UN/LOCODE + OurAirports CSV parse/filter for ports master (#159).
 * No I/O — unit-tested without network/DB.
 */

export type PortRow = {
  unlocode: string
  name: string
  country: string
  mode: 'sea' | 'air' | 'both'
  iata: string | null
}

/** Minimal CSV line parser (quoted fields with embedded commas/quotes). */
export function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (ch === '"') inQ = false
      else cur += ch
    } else if (ch === '"') inQ = true
    else if (ch === ',') {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}

export function parseCsvText(text: string): { header: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0)
  if (!lines.length) return { header: [], rows: [] }
  const header = parseCsvLine(lines[0]!)
  return { header, rows: lines.slice(1).map(parseCsvLine) }
}

/** Distinct IATA codes from OurAirports airports.csv (iata_code column). */
export function extractRealIataSet(airportsCsv: string): Set<string> {
  const { header, rows } = parseCsvText(airportsCsv)
  const iataIdx = header.indexOf('iata_code')
  const real = new Set<string>()
  if (iataIdx < 0) return real
  for (const r of rows) {
    const code = (r[iataIdx] ?? '').trim().toUpperCase()
    if (/^[A-Z0-9]{3}$/.test(code)) real.add(code)
  }
  return real
}

/**
 * UN/LOCODE code-list → sea/air ports.
 * Function contains '1' = seaport, '4' = airport. mode: both | air | sea.
 * IATA: override column or 3-char location; cross-check OurAirports when set is non-empty.
 */
export function parseUnlocodePorts(
  unlocodeCsv: string,
  realIata: Set<string> = new Set(),
): { ports: PortRow[]; withIata: number } {
  const { header, rows } = parseCsvText(unlocodeCsv)
  const col = (name: string) => header.indexOf(name)
  const iCountry = col('Country')
  const iLoc = col('Location')
  const iName = col('NameWoDiacritics')
  const iNameRaw = col('Name')
  const iFunc = col('Function')
  const iIata = col('IATA')

  const ports = new Map<string, PortRow>()
  let withIata = 0
  for (const r of rows) {
    const country = (r[iCountry] ?? '').trim().toUpperCase()
    const loc = (r[iLoc] ?? '').trim().toUpperCase()
    if (!/^[A-Z]{2}$/.test(country) || !/^[A-Z0-9]{3}$/.test(loc)) continue
    const func = r[iFunc] ?? ''
    const isSea = func.includes('1')
    const isAir = func.includes('4')
    if (!isSea && !isAir) continue
    const name = ((r[iName] ?? '').trim() || (r[iNameRaw] ?? '').trim()).replace(/\s+/g, ' ')
    if (!name) continue
    let iata: string | null = null
    if (isAir) {
      const override = (r[iIata] ?? '').trim().toUpperCase()
      const candidate = /^[A-Z0-9]{3}$/.test(override) ? override : loc
      // empty realIata = no OurAirports file → keep UNECE claim
      iata = realIata.size === 0 || realIata.has(candidate) ? candidate : null
    }
    if (iata) withIata++
    ports.set(country + loc, {
      unlocode: country + loc,
      name,
      country,
      mode: isSea && isAir ? 'both' : isAir ? 'air' : 'sea',
      iata,
    })
  }
  return { ports: [...ports.values()], withIata }
}
