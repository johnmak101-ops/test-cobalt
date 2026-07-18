/**
 * #159 — full UN/LOCODE + OurAirports ports ingest (upsert-never-delete).
 * Shared by Nest scheduler and CLI `sync-ports.ts`.
 */
import { Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { sql, type Kysely } from 'kysely'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import type { DB } from '../db/kysely/db'
import { KYSELY } from '../db/kysely.provider'
import { extractRealIataSet, parseUnlocodePorts, type PortRow } from './ports-sync.parse'

/** Default mirrors (overridable via env). */
export const DEFAULT_UNLOCODE_URL =
  process.env.PORTS_UNLOCODE_URL ??
  'https://raw.githubusercontent.com/datasets/un-locode/master/data/code-list.csv'
export const DEFAULT_OURAIRPORTS_URL =
  process.env.PORTS_OURAIRPORTS_URL ??
  'https://davidmegginson.github.io/ourairports-data/airports.csv'

export type PortsSyncSummary = {
  fetched: number
  inserted: number
  updated: number
  withIata: number
  error?: string
}

// tedious 2100-param cap → 5 params/row → 400 rows/batch (same as load-ports.ts)
const MERGE_BATCH = 400

@Injectable()
export class PortsSyncService {
  private readonly log = new Logger(PortsSyncService.name)

  constructor(
    @Inject(KYSELY) private readonly db: Kysely<DB>,
    private readonly config: ConfigService,
  ) {}

  /**
   * Download (or read local paths) → parse → MERGE into ports.
   * Fail soft: returns summary with error string; never throws for fetch/parse/merge failures.
   */
  async sync(opts?: {
    unlocodePath?: string
    airportsPath?: string
    unlocodeUrl?: string
    airportsUrl?: string
    cacheDir?: string
  }): Promise<PortsSyncSummary> {
    try {
      const unText = await this.loadText({
        path: opts?.unlocodePath,
        url: opts?.unlocodeUrl ?? DEFAULT_UNLOCODE_URL,
        cacheName: 'un-locode-code-list.csv',
        cacheDir: opts?.cacheDir,
      })
      let airText = ''
      try {
        airText = await this.loadText({
          path: opts?.airportsPath,
          url: opts?.airportsUrl ?? DEFAULT_OURAIRPORTS_URL,
          cacheName: 'ourairports-airports.csv',
          cacheDir: opts?.cacheDir,
        })
      } catch (e) {
        this.log.warn(
          `OurAirports load failed — continuing without IATA cross-check: ${e instanceof Error ? e.message : e}`,
        )
      }

      const realIata = airText ? extractRealIataSet(airText) : new Set<string>()
      if (realIata.size) this.log.log(`OurAirports: ${realIata.size} distinct IATA codes`)

      const { ports, withIata } = parseUnlocodePorts(unText, realIata)
      if (!ports.length) {
        return { fetched: 0, inserted: 0, updated: 0, withIata: 0, error: 'no sea/air ports parsed from UN/LOCODE' }
      }
      this.log.log(`UN/LOCODE: ${ports.length} sea/air locations (${withIata} with IATA)`)

      const before = await this.countByUnlocode()
      await this.mergePorts(ports)
      const after = await this.countByUnlocode()
      // Approximate insert/update: new codes vs total written
      let inserted = 0
      for (const p of ports) {
        if (!before.has(p.unlocode)) inserted++
      }
      const updated = ports.length - inserted
      // after size for sanity (never shrink — we never delete)
      void after

      return { fetched: ports.length, inserted, updated, withIata }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      this.log.error(`ports sync failed: ${msg}`, e instanceof Error ? e.stack : undefined)
      return { fetched: 0, inserted: 0, updated: 0, withIata: 0, error: msg }
    }
  }

  private async countByUnlocode(): Promise<Set<string>> {
    const rows = await this.db.selectFrom('ports').select('unlocode').execute()
    return new Set(rows.map((r) => r.unlocode))
  }

  async mergePorts(ports: PortRow[]): Promise<void> {
    for (let i = 0; i < ports.length; i += MERGE_BATCH) {
      const chunk = ports.slice(i, i + MERGE_BATCH)
      const tuples = chunk.map(
        (p) => sql`(${p.unlocode}, ${p.name}, ${p.country}, ${p.mode}, ${p.iata})`,
      )
      await sql`
        merge ports as t
        using (values ${sql.join(tuples)}) as s (unlocode, name, country, mode, iata)
        on t.unlocode = s.unlocode
        when matched then update set name = s.name, country = s.country, mode = s.mode, iata = s.iata
        when not matched then insert (unlocode, name, country, mode, iata)
          values (s.unlocode, s.name, s.country, s.mode, s.iata);
      `.execute(this.db)
      if ((i + MERGE_BATCH) % 10000 < MERGE_BATCH || i + MERGE_BATCH >= ports.length) {
        this.log.log(`ports upsert ${Math.min(i + MERGE_BATCH, ports.length)}/${ports.length}`)
      }
    }
  }

  private async loadText(opts: {
    path?: string
    url: string
    cacheName: string
    cacheDir?: string
  }): Promise<string> {
    if (opts.path) {
      return await readFile(opts.path, 'utf8')
    }
    const cacheDir = opts.cacheDir ?? this.config.get<string>('PORTS_CACHE_DIR') ?? ''
    if (cacheDir) {
      const cachePath = join(cacheDir, opts.cacheName)
      if (this.config.get<string>('PORTS_CACHE_READ') === '1') {
        try {
          return await readFile(cachePath, 'utf8')
        } catch {
          /* cache miss — fall through to fetch */
        }
      }
    }
    const res = await fetch(opts.url, {
      headers: { 'user-agent': 'cobalt-shiptrack-ports-sync/1.0' },
      signal: AbortSignal.timeout(120_000),
    })
    if (!res.ok) throw new Error(`GET ${opts.url} → ${res.status}`)
    const text = await res.text()
    if (cacheDir) {
      try {
        await mkdir(cacheDir, { recursive: true })
        await writeFile(join(cacheDir, opts.cacheName), text, 'utf8')
      } catch {
        /* ignore cache write */
      }
    }
    return text
  }
}
