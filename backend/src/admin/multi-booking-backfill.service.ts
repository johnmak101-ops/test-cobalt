/**
 * Hybrid-C PR3 E1: inventory + flag-gated stamp for multi-booking mush provisionals.
 * Full re-split is queue rematch (parser/partition); track only inventories and stamps.
 */
import { ForbiddenException, Inject, Injectable } from '@nestjs/common'
import { sql, type Kysely } from 'kysely'
import { KYSELY } from '../db/kysely.provider'
import type { DB } from '../db/kysely/db'
import { AuditRepository } from '../db/repositories/audit.repository'
import { BACKFILL_STAMP_REASON, detectMultiBookingMushSignals } from './multi-booking-backfill.signals'

export { BACKFILL_STAMP_REASON, detectMultiBookingMushSignals } from './multi-booking-backfill.signals'

export const BACKFILL_APPLY_ENV = 'HYBRID_C_BACKFILL_APPLY'
export const BACKFILL_DEFAULT_LIMIT = 25
export const BACKFILL_MAX_LIMIT = 100

export interface BackfillCandidate {
  shipmentId: string
  jobNo: string | null
  reviewStatus: string | null
  bookingNo: string | null
  soNo: string | null
  reasons: string[]
  signals: string[]
}

function clampLimit(raw: number | undefined): number {
  const n = Number.isFinite(raw) ? Math.floor(raw as number) : BACKFILL_DEFAULT_LIMIT
  return Math.min(BACKFILL_MAX_LIMIT, Math.max(1, n || BACKFILL_DEFAULT_LIMIT))
}

function parseReasons(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String)
  if (typeof raw === 'string') {
    try {
      const j = JSON.parse(raw) as unknown
      return Array.isArray(j) ? j.map(String) : raw ? [raw] : []
    } catch {
      return raw ? [raw] : []
    }
  }
  return []
}

function parseCritic(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null
  if (typeof raw === 'object') return raw as Record<string, unknown>
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as Record<string, unknown>
    } catch {
      return null
    }
  }
  return null
}

@Injectable()
export class MultiBookingBackfillService {
  constructor(
    @Inject(KYSELY) private readonly db: Kysely<DB>,
    private readonly audit: AuditRepository,
  ) {}

  async inventory(limitRaw?: number, includeStamped = false): Promise<{
    dryRun: true
    limit: number
    count: number
    candidates: BackfillCandidate[]
    applyEnabled: boolean
  }> {
    const limit = clampLimit(limitRaw)
    const rows = await this.db
      .selectFrom('shipments')
      .leftJoin('bookings', 'bookings.id', 'shipments.bookingId')
      .select([
        'shipments.id as shipmentId',
        'bookings.jobNo as jobNo',
        'shipments.reviewStatus as reviewStatus',
        'shipments.bookingNo as bookingNo',
        'shipments.soNo as soNo',
        'shipments.reviewReasons as reviewReasons',
        'shipments.criticReview as criticReview',
      ])
      .where('shipments.reviewStatus', '=', 'provisional')
      .where((eb) =>
        eb.or([
          sql<boolean>`cast(shipments.review_reasons as nvarchar(max)) like ${'%co-current%'}`,
          sql<boolean>`cast(shipments.review_reasons as nvarchar(max)) like ${'%Multi-booking split incomplete%'}`,
          sql<boolean>`cast(shipments.review_reasons as nvarchar(max)) like ${'%matched multiple%'}`,
          sql<boolean>`cast(shipments.critic_review as nvarchar(max)) like ${'%splitAudit%'}`,
          sql<boolean>`cast(shipments.critic_review as nvarchar(max)) like ${'%matchAmbiguity%'}`,
          sql<boolean>`shipments.booking_no like ${'%,%'}`,
          sql<boolean>`shipments.booking_no like ${'%&%'}`,
        ]),
      )
      .orderBy('shipments.createdAt', 'desc')
      .limit(limit * 3)
      .execute()

    const candidates: BackfillCandidate[] = []
    for (const r of rows) {
      const reasons = parseReasons(r.reviewReasons)
      const critic = parseCritic(r.criticReview)
      const signals = detectMultiBookingMushSignals({
        reviewReasons: reasons,
        bookingNo: r.bookingNo ?? null,
        criticReview: critic,
      })
      if (signals.length === 0) continue
      if (!includeStamped && signals.includes('already_stamped')) continue
      if (signals.every((s) => s === 'already_stamped')) continue
      candidates.push({
        shipmentId: String(r.shipmentId),
        jobNo: r.jobNo ?? null,
        reviewStatus: r.reviewStatus ?? null,
        bookingNo: r.bookingNo ?? null,
        soNo: r.soNo ?? null,
        reasons: reasons.slice(0, 8),
        signals: signals.filter((s) => s !== 'already_stamped'),
      })
      if (candidates.length >= limit) break
    }

    return {
      dryRun: true,
      limit,
      count: candidates.length,
      candidates,
      applyEnabled: process.env[BACKFILL_APPLY_ENV] === '1',
    }
  }

  /**
   * Flag-gated stamp only. Does not re-split legs (queue rematch owns that).
   * Requires HYBRID_C_BACKFILL_APPLY=1.
   */
  async apply(opts: {
    limit?: number
    shipmentIds?: string[]
    actor?: string
  }): Promise<{
    dryRun: false
    applied: number
    skipped: number
    shipmentIds: string[]
    stamp: string
  }> {
    if (process.env[BACKFILL_APPLY_ENV] !== '1') {
      throw new ForbiddenException(
        `Backfill apply disabled. Set ${BACKFILL_APPLY_ENV}=1 after reviewing dry-run inventory.`,
      )
    }
    const inv = await this.inventory(opts.limit, false)
    const allow = opts.shipmentIds?.length ? new Set(opts.shipmentIds) : null
    const targets = inv.candidates.filter((c) => !allow || allow.has(c.shipmentId))
    let applied = 0
    let skipped = 0
    const done: string[] = []

    for (const c of targets) {
      const row = await this.db
        .selectFrom('shipments')
        .select(['id', 'reviewReasons'])
        .where('id', '=', c.shipmentId)
        .executeTakeFirst()
      if (!row) {
        skipped++
        continue
      }
      const reasons = parseReasons(row.reviewReasons)
      if (reasons.some((r) => r.includes('Hybrid-C multi-booking backfill'))) {
        skipped++
        continue
      }
      const next = [...reasons, BACKFILL_STAMP_REASON]
      await this.db
        .updateTable('shipments')
        .set({ reviewReasons: JSON.stringify(next) as never })
        .where('id', '=', c.shipmentId)
        .execute()
      // F10: audit every stamped shipment (admin data mutation)
      await this.audit.write({
        entityType: 'shipment',
        entityId: c.shipmentId,
        field: 'reviewReasons',
        oldValue: null,
        newValue: 'hybrid-c-backfill-stamp',
        changeType: 'update',
        sourceType: 'manual',
        actorUserId: opts.actor?.slice(0, 200) ?? null,
        note: 'admin: hybrid-c backfill stamp',
      })
      applied++
      done.push(c.shipmentId)
    }

    return {
      dryRun: false,
      applied,
      skipped,
      shipmentIds: done,
      stamp: BACKFILL_STAMP_REASON,
    }
  }
}
