import { sql, type Kysely } from 'kysely'
import { JOB_NO_PREFIX } from '../../common/job-no'
import type { DB } from '../kysely/db.generated'

/** Insert/patch shape for a booking row. `jobNo` is required on create (NOT NULL, unique). */
export type BookingInsert = Partial<{
  customerId: string | null
  vendorId: string | null
  forwarderId: string | null
  consigneeId: string | null
  brand: string | null
  crd: Date | null
  status: string
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
export class KyselyBookingRepository {
  constructor(private readonly db: Kysely<DB>) {}

  listOrdered() {
    return this.db.selectFrom('bookings').orderBy('createdAt', 'desc').selectAll().execute()
  }

  async findById(id: string) {
    const row = await this.db.selectFrom('bookings').where('id', '=', id).selectAll().executeTakeFirst()
    return row ?? null
  }

  /** Fetch many bookings in ONE query (id -> booking) — replaces per-leg findById in read loops. */
  async findByIds(ids: string[]): Promise<Map<string, Awaited<ReturnType<KyselyBookingRepository['findById']>>>> {
    const map = new Map<string, Awaited<ReturnType<KyselyBookingRepository['findById']>>>()
    if (!ids.length) return map
    const rows = await this.db.selectFrom('bookings').where('id', 'in', ids).selectAll().execute()
    for (const b of rows) map.set(b.id, b)
    return map
  }

  async create(values: BookingInsert) {
    const row = await this.db.insertInto('bookings').values(values).outputAll('inserted').executeTakeFirstOrThrow()
    return row
  }

  async update(id: string, patch: BookingInsert) {
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

  /** Next job-number sequence = MAX(existing trailing number) + 1, scoped to the JOB-2026-NNNN family so a
   *  foreign-format/legacy booking can't perturb the sequence. Gap-safe, unlike count()+1 which collides the
   *  moment a number is missing. The agent posts sequentially so a max-based seed is race-free in practice
   *  (job_no is UNIQUE, so a concurrent double would fail-fast). */
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
