/**
 * Load the ports master from FREE static datasets (no API keys, offline-friendly):
 *  - UN/LOCODE code list (UNECE official, mirrored as CSV by datahub.io/core/un-locode) —
 *    canonical 5-char codes, names, countries, function classifiers, IATA overrides.
 *  - OurAirports airports.csv (public domain) — cross-check that a derived IATA code is a
 *    real scheduled airport (guards against stale/withdrawn UN/LOCODE airport rows).
 *
 * Import rule: keep locations with SEAPORT (function '1') or AIRPORT (function '4').
 *   mode: 1+4 → both, 4 → air, 1 → sea
 *   iata: airport rows use the IATA column when set (differs-from-locode case), else the
 *         3-letter location part — CNCAN → CAN, KHPNH → PNH, USLAX → LAX.
 * Upsert by unlocode; existing rows get name/country/mode/iata refreshed (masters stay curated
 * through this loader, re-run per UNECE release — twice a year).
 *
 * Usage (from backend/):
 *   npx ts-node --transpile-only -P tsconfig.json src/db/load-ports.ts <unlocode.csv> <airports.csv>
 */
import { readFileSync } from 'fs'
import { Client } from 'pg'

const url = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/cobalt'

/** Minimal CSV line parser (handles quoted fields with embedded commas/quotes). */
function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (ch === '"') inQ = false
      else cur += ch
    } else if (ch === '"') inQ = true
    else if (ch === ',') { out.push(cur); cur = '' }
    else cur += ch
  }
  out.push(cur)
  return out
}

function loadCsv(path: string): { header: string[]; rows: string[][] } {
  const text = readFileSync(path, 'utf8')
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0)
  const header = parseCsvLine(lines[0]!)
  return { header, rows: lines.slice(1).map(parseCsvLine) }
}

async function main() {
  const [unlocodePath, airportsPath] = process.argv.slice(2)
  if (!unlocodePath) {
    console.error('usage: load-ports.ts <unlocode.csv> [ourairports.csv]')
    process.exit(1)
  }

  // OurAirports: the set of IATA codes with real airport rows (any type, iata_code non-empty)
  const realIata = new Set<string>()
  if (airportsPath) {
    const air = loadCsv(airportsPath)
    const iataIdx = air.header.indexOf('iata_code')
    for (const r of air.rows) {
      const code = (r[iataIdx] ?? '').trim().toUpperCase()
      if (/^[A-Z0-9]{3}$/.test(code)) realIata.add(code)
    }
    console.log(`OurAirports: ${realIata.size} distinct IATA codes`)
  }

  const un = loadCsv(unlocodePath)
  const col = (name: string) => un.header.indexOf(name)
  const iCountry = col('Country'), iLoc = col('Location'), iName = col('NameWoDiacritics')
  const iNameRaw = col('Name'), iFunc = col('Function'), iIata = col('IATA')

  type PortRow = { unlocode: string; name: string; country: string; mode: string; iata: string | null }
  const ports = new Map<string, PortRow>()
  let airCount = 0
  for (const r of un.rows) {
    const country = (r[iCountry] ?? '').trim().toUpperCase()
    const loc = (r[iLoc] ?? '').trim().toUpperCase()
    if (!/^[A-Z]{2}$/.test(country) || !/^[A-Z0-9]{3}$/.test(loc)) continue
    const func = (r[iFunc] ?? '')
    const isSea = func.includes('1')
    const isAir = func.includes('4')
    if (!isSea && !isAir) continue
    const name = ((r[iName] ?? '').trim() || (r[iNameRaw] ?? '').trim()).replace(/\s+/g, ' ')
    if (!name) continue
    let iata: string | null = null
    if (isAir) {
      const override = (r[iIata] ?? '').trim().toUpperCase()
      const candidate = /^[A-Z0-9]{3}$/.test(override) ? override : loc
      // cross-check against OurAirports when available; keep UNECE's claim if no airports file given
      iata = realIata.size === 0 || realIata.has(candidate) ? candidate : null
    }
    if (iata) airCount++
    ports.set(country + loc, {
      unlocode: country + loc,
      name,
      country,
      mode: isSea && isAir ? 'both' : isAir ? 'air' : 'sea',
      iata,
    })
  }
  console.log(`UN/LOCODE: ${ports.size} sea/air locations (${airCount} with a verified IATA code)`)

  const c = new Client({ connectionString: url })
  await c.connect()
  const rows = [...ports.values()]
  const BATCH = 1000
  let done = 0
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH)
    const values: unknown[] = []
    const tuples = chunk.map((p, j) => {
      values.push(p.unlocode, p.name, p.country, p.mode, p.iata)
      const b = j * 5
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5})`
    })
    await c.query(
      `insert into tracking.ports (unlocode, name, country, mode, iata)
       values ${tuples.join(', ')}
       on conflict (unlocode) do update
         set name = excluded.name, country = excluded.country,
             mode = excluded.mode, iata = excluded.iata`,
      values,
    )
    done += chunk.length
    if (done % 10000 < BATCH) console.log(`upserted ${done}/${rows.length}`)
  }
  const stat = await c.query(
    `select count(*) total, count(iata) with_iata, count(*) filter (where mode = 'air') air, count(*) filter (where mode = 'both') both from tracking.ports`,
  )
  console.log('ports master:', JSON.stringify(stat.rows[0]))
  await c.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
