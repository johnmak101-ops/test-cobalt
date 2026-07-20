import { Inject, Injectable } from '@nestjs/common'
import { sql, type Kysely } from 'kysely'
import { KYSELY } from '../db/kysely.provider'
import type { DB } from '../db/kysely/db'
import { normalizeMasterName, type MasterMiss } from '../decisions/critic-review.types'

export interface MeshMissRow {
  type: 'vendor' | 'forwarder' | 'customer'
  rawName: string
  normalizedName: string
  shipmentIds: string[]
  count: number
  firstSeen: string
  lastSeen: string
  status: 'open' | 'acked' | 'recurred'
}

interface LegRow {
  id: string
  createdAt: string | Date
  criticReview: string | Record<string, unknown> | null
}

interface AckRow {
  type: string
  normalized_name: string
  acked_at: string | Date
}

const RECUR_MS = 7 * 24 * 3600 * 1000

function parseMisses(criticReview: LegRow['criticReview']): MasterMiss[] {
  if (criticReview == null) return []
  try {
    const obj =
      typeof criticReview === 'string'
        ? (JSON.parse(criticReview) as { masterMisses?: MasterMiss[] })
        : (criticReview as { masterMisses?: MasterMiss[] })
    const arr = obj.masterMisses
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

/** Pure aggregation — unit-tested without DB. */
export function aggregateMisses(legs: LegRow[], acks: AckRow[]): MeshMissRow[] {
  const ackMap = new Map(
    acks.map((a) => [`${a.type}:${a.normalized_name}`, new Date(a.acked_at).getTime()]),
  )
  const groups = new Map<
    string,
    {
      type: MasterMiss['type']
      rawName: string
      normalizedName: string
      shipmentIds: string[]
      first: number
      last: number
    }
  >()
  for (const leg of legs) {
    const misses = parseMisses(leg.criticReview)
    if (!misses.length) continue
    const t = new Date(leg.createdAt).getTime()
    if (!Number.isFinite(t)) continue
    for (const m of misses) {
      if (!m?.type || !m?.rawName) continue
      if (m.type !== 'vendor' && m.type !== 'forwarder' && m.type !== 'customer') continue
      const normalizedName = normalizeMasterName(m.rawName)
      if (!normalizedName) continue
      const key = `${m.type}:${normalizedName}`
      const g = groups.get(key) ?? {
        type: m.type,
        rawName: m.rawName,
        normalizedName,
        shipmentIds: [],
        first: t,
        last: t,
      }
      g.shipmentIds.push(leg.id)
      if (t < g.first) g.first = t
      if (t >= g.last) {
        g.last = t
        g.rawName = m.rawName
      }
      groups.set(key, g)
    }
  }
  return [...groups.values()]
    .map((g) => {
      const ids = [...new Set(g.shipmentIds)]
      const ackedAt = ackMap.get(`${g.type}:${g.normalizedName}`)
      const status: MeshMissRow['status'] =
        ackedAt === undefined ? 'open' : g.last > ackedAt + RECUR_MS ? 'recurred' : 'acked'
      return {
        type: g.type,
        rawName: g.rawName,
        normalizedName: g.normalizedName,
        shipmentIds: ids,
        count: ids.length,
        firstSeen: new Date(g.first).toISOString(),
        lastSeen: new Date(g.last).toISOString(),
        status,
      }
    })
    .sort((a, b) => b.count - a.count)
}

@Injectable()
export class MeshMissesService {
  constructor(@Inject(KYSELY) private readonly db: Kysely<DB>) {}

  async list(days = 30, includeAcked = false): Promise<MeshMissRow[]> {
    const d = Math.min(Math.max(1, Number(days) || 30), 365)
    const since = new Date(Date.now() - d * 24 * 3600 * 1000)
    // Prefer LIKE on nvarchar critic_review text; ParseJSON may leave objects — cast via sql.
    const legs = await this.db
      .selectFrom('shipments')
      .where('createdAt', '>=', since)
      .where(sql`cast(critic_review as nvarchar(max))`, 'like', '%masterMisses%')
      .select(['id', 'createdAt', 'criticReview'])
      .execute()

    const acks = await this.db
      .selectFrom('meshMissAck')
      .select(['type', 'normalizedName', 'ackedAt'])
      .execute()

    const ackRows: AckRow[] = acks.map((a) => ({
      type: a.type,
      normalized_name: a.normalizedName,
      acked_at: a.ackedAt,
    }))

    const rows = aggregateMisses(
      legs.map((l) => ({
        id: l.id,
        createdAt: l.createdAt,
        criticReview: l.criticReview as LegRow['criticReview'],
      })),
      ackRows,
    )
    if (includeAcked) return rows
    return rows.filter((r) => r.status !== 'acked')
  }

  async ack(type: string, normalizedName: string, ackedBy: string): Promise<void> {
    const norm = normalizeMasterName(normalizedName)
    const t = String(type ?? '').toLowerCase()
    if (!['vendor', 'forwarder', 'customer'].includes(t) || !norm) {
      throw new Error('invalid type or name')
    }
    // MSSQL: delete+insert for unique (type, normalized_name) upsert
    await this.db
      .deleteFrom('meshMissAck')
      .where('type', '=', t)
      .where('normalizedName', '=', norm)
      .execute()
    await this.db
      .insertInto('meshMissAck')
      .values({
        type: t,
        normalizedName: norm,
        ackedBy: ackedBy.slice(0, 200) || 'unknown',
      })
      .execute()
  }
}
