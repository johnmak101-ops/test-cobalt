import { sql, type Kysely } from 'kysely'

/**
 * 0005 — queryable NORMALIZED PO key on `parsed_record` (`po_no_norm`), the write-side prerequisite for
 * replacing `evidence.allWithMessage()` in committer.apply (TODO "Ingest N+1 — evidence scan").
 *
 * `resolvePoEnrichment` attributes a record to a PO via `normKey(po_no) || normKey(match_keys.customer_po)`
 * (see po-enrichment `poKeyOf`). Persisting that SAME key, indexed, lets
 * `forCommitEnrichment` find every email that mentions a target PO without a full-table scan, then load
 * message-complete rows (broadcast siblings live on the same email). Backfill is inert until the
 * committer swaps the reader.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`ALTER TABLE parsed_record ADD po_no_norm nvarchar(100) NULL`).execute(db)
  await sql.raw(`CREATE INDEX ix_parsed_record_po_no_norm ON parsed_record (po_no_norm)`).execute(db)
  await backfill(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`DROP INDEX IF EXISTS ix_parsed_record_po_no_norm ON parsed_record`).execute(db)
  await sql.raw(`ALTER TABLE parsed_record DROP COLUMN IF EXISTS po_no_norm`).execute(db)
}

/** FROZEN inline copy of match-keys `normKey` + po-enrichment `poKeyOf` — migrations must not drift with app code. */
async function backfill(db: Kysely<unknown>): Promise<void> {
  const normKey = (v: unknown): string => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  const res = await sql<{
    id: string
    po_no?: string | null
    poNo?: string | null
    match_keys?: string | null
    matchKeys?: string | null
  }>`select id, po_no, match_keys from parsed_record`.execute(db)

  const anyDb = db as unknown as Kysely<{ parsedRecord: { id: string; poNoNorm: string | null } }>
  for (const r of res.rows) {
    const poNo = r.poNo ?? r.po_no ?? null
    let customerPo: unknown = null
    const raw = r.matchKeys ?? r.match_keys
    if (raw) {
      try {
        const mk = typeof raw === 'string' ? JSON.parse(raw) : raw
        customerPo = mk?.customer_po
      } catch {
        /* leave null */
      }
    }
    const norm = normKey(poNo) || normKey(customerPo) || null
    await anyDb.updateTable('parsedRecord').set({ poNoNorm: norm }).where('id', '=', r.id).execute()
  }
}
