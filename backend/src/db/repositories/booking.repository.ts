import { Inject, Injectable } from '@nestjs/common'
import { sql, type Kysely } from 'kysely'
import { formatJobNo, JOB_NO_PREFIX } from '../../common/job-no'
import { isUniqueViolation } from '../../common/db-errors'
import type { DB } from '../kysely/db'
import { KYSELY } from '../kysely.provider'
import type { BOOKING_STATUS } from '../enums'

/** Attempts allowed when minting a job_no against concurrent writers before giving up. */
const JOB_NO_MAX_ATTEMPTS = 8

/** Insert/patch shape for a booking row. `jobNo` is required on create (NOT NULL, unique). */
export type BookingInsert = Partial<{
  customerId: string | null
  vendorId: string | null
  forwarderId: string | null
  consigneeId: string | null
  brand: string | null
  crd: Date | null
  status: (typeof BOOKING_STATUS)[number]
  notes: string | null
}> & { jobNo: string }

/** Kysely/SQL Server port of BookingRepository. The Booking aggregate: bookings + booking_pos links.
 *  (PO master reads/CRUD and PO↔shipment links live in PurchaseOrderRepository.)
 *
 *  Postgres → MSSQL notes:
 *  - `returning` → `OUTPUT` (.output/.outputAll).
 *  - `onConflictDoNothing` (booking_pos unique) → check-then-insert (the `uq_booking_pos` absorbs replays).
 *  - `count(*)::int` → `count(*)` cast to number client-side.
 *  - `nextJobSeq`: Postgres `substring(job_no from '[0-9]+$')::int` (trailing-digit regex capture) → T-SQL
 *    `TRY_CAST(RIGHT(..., n) AS int)` extracting the trailing digit run via PATINDEX on the reversed string.
 *    Scoped to the JOB-2026- family so a foreign-format booking can't perturb the sequence. */
@Injectable()
export class BookingRepository {
  constructor(@Inject(KYSELY) private readonly db: Kysely<DB>) {}

  listOrdered() {
    return this.db.selectFrom('bookings').orderBy('createdAt', 'desc').selectAll().execute()
  }

  async findById(id: string) {
    const row = await this.db.selectFrom('bookings').where('id', '=', id).selectAll().executeTakeFirst()
    return row ?? null
  }

  /** Fetch many bookings in ONE query (id -> booking) — replaces per-leg findById in read loops. */
  async findByIds(ids: string[]): Promise<Map<string, NonNullable<Awaited<ReturnType<BookingRepository['findById']>>>>> {
    const map = new Map<string, NonNullable<Awaited<ReturnType<BookingRepository['findById']>>>>()
    if (!ids.length) return map
    const rows = await this.db.selectFrom('bookings').where('id', 'in', ids).selectAll().execute()
    for (const b of rows) map.set(b.id, b)
    return map
  }

  async create(values: BookingInsert) {
    const row = await this.db.insertInto('bookings').values(values).outputAll('inserted').executeTakeFirstOrThrow()
    return row
  }

  /** Patch is a dynamic column->value record (the committer builds it key-by-key), like the Drizzle
   *  `Partial<$inferInsert>` was used in practice. */
  async update(id: string, patch: Record<string, unknown>) {
    const row = await this.db
      .updateTable('bookings')
      .set({ ...patch, updatedAt: new Date() })
      .where('id', '=', id)
      .outputAll('inserted')
      .executeTakeFirst()
    return row ?? null
  }

  async count() {
    const row = await this.db.selectFrom('bookings').select(sql<number>`count(*)`.as('n')).executeTakeFirst()
    return Number(row?.n ?? 0)
  }

  /**
   * Create a booking with a freshly minted job_no — race-safe under concurrent writers.
   *
   * {@link nextJobSeq} is a MAX()+1 read, so concurrent creates can compute the SAME sequence and the
   * `uq_bookings_job_no` unique then rejects all but one (SQL 2627 → HTTP 400 at the API edge). That is
   * exactly what happens when the agent posts a batch in parallel: every group that matches no existing
   * leg mints a booking, so N concurrent writers produce N-1 failures.
   *
   * Rather than serialize booking creation with a range lock over `job_no LIKE 'JOB-2026-%'` (a scan,
   * held across a round-trip), the loser simply retries: re-read the sequence — which now sees the
   * winner's row — and insert again. Converges in one extra round-trip per collision.
   *
   * Callers pass everything except `jobNo`; the minted number is on the returned row.
   */
  async createWithGeneratedJobNo(values: Omit<BookingInsert, 'jobNo'>) {
    let lastErr: unknown
    for (let attempt = 0; attempt < JOB_NO_MAX_ATTEMPTS; attempt++) {
      const jobNo = formatJobNo(await this.nextJobSeq())
      try {
        return await this.create({ ...values, jobNo })
      } catch (e) {
        if (!isUniqueViolation(e)) throw e
        lastErr = e
        // Jitter, so a wave of writers doesn't re-read and re-collide in lockstep.
        await new Promise((r) => setTimeout(r, 10 + Math.floor(Math.random() * 40)))
      }
    }
    throw lastErr
  }

  /** Next job-number sequence = MAX(existing trailing number) + 1, scoped to the JOB-2026-NNNN family so a
   *  foreign-format/legacy booking can't perturb the sequence. Gap-safe, unlike count()+1 which collides the
   *  moment a number is missing. NOT atomic on its own — concurrent callers can read the same value, so mint
   *  job numbers via {@link createWithGeneratedJobNo}, which retries the unique violation. */
  async nextJobSeq() {
    // trailing digit run of job_no: reverse, find first non-digit, take the leading (was-trailing) digits.
    const rev = sql<string>`reverse(${sql.ref('job_no')})`
    const trailingDigits = sql<string>`right(${sql.ref('job_no')}, patindex('%[^0-9]%', ${rev}) - 1)`
    const row = await this.db
      .selectFrom('bookings')
      .where('jobNo', 'like', JOB_NO_PREFIX + '%')
      .select(sql<number>`coalesce(max(try_cast(${trailingDigits} as int)), 0)`.as('n'))
      .executeTakeFirst()
    return Number(row?.n ?? 0) + 1
  }

  // --- booking_pos ---

  /** Idempotently link a booking to a PO (the `uq_booking_pos` unique absorbs replays). */
  async linkPo(bookingId: string, poId: string) {
    const existing = await this.db
      .selectFrom('bookingPos')
      .where('bookingId', '=', bookingId)
      .where('poId', '=', poId)
      .select('id')
      .executeTakeFirst()
    if (existing) return
    try {
      await this.db.insertInto('bookingPos').values({ bookingId, poId }).execute()
    } catch (e) {
      // unique violation (booking_id, po_id) — a concurrent insert won the race; idempotent
      if (!/unique|duplicate/i.test((e as Error).message)) throw e
    }
  }

  async posFor(bookingId: string) {
    // One links query + one bulk PO query (was 1 + N per-link PO round-trips).
    const links = await this.db.selectFrom('bookingPos').where('bookingId', '=', bookingId).select('poId').execute()
    if (!links.length) return []
    return this.db.selectFrom('purchaseOrders').where('id', 'in', links.map((l) => l.poId)).selectAll().execute()
  }

  async poNumbersFor(bookingId: string): Promise<string[]> {
    const rows = await this.db
      .selectFrom('bookingPos')
      .innerJoin('purchaseOrders', 'bookingPos.poId', 'purchaseOrders.id')
      .where('bookingPos.bookingId', '=', bookingId)
      .select('purchaseOrders.poNumber as poNumber')
      .execute()
    return rows.map((r) => r.poNumber)
  }

  /** Every given booking's PO numbers in ONE query (bookingId -> [poNumber]) — replaces the per-leg
   *  poNumbersFor N+1 inside the committer's match loop (the dominant ingest cost as shipments grow). */
  async poNumbersByBooking(bookingIds: string[]): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>()
    if (!bookingIds.length) return map
    const rows = await this.db
      .selectFrom('bookingPos')
      .innerJoin('purchaseOrders', 'bookingPos.poId', 'purchaseOrders.id')
      .where('bookingPos.bookingId', 'in', bookingIds)
      .select(['bookingPos.bookingId as bookingId', 'purchaseOrders.poNumber as poNumber'])
      .execute()
    for (const r of rows) {
      const arr = map.get(r.bookingId)
      if (arr) arr.push(r.poNumber)
      else map.set(r.bookingId, [r.poNumber])
    }
    return map
  }
}
