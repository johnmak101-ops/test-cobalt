import { sql, type Kysely } from 'kysely'

/**
 * 0003 — the queryable strong-key index (`shipment_match_keys`), write-side prerequisite for removing the
 * `allLegs()` full-scan in the committer (TODO "Ingest N+1 — full-scans remain").
 *
 * `findExistingLeg` matches a leg on `strongKeys(l.matchKeys)` — the normalized booking/SO/HBL/MBL/container
 * ids — read from a scan of EVERY leg. This table persists those SAME keys (same source, same normalization)
 * indexed on `(type, value)`, so a later candidate query `WHERE (type,value) IN gk` is a PROVABLE SUPERSET of
 * the strong-overlap match and the scan can be replaced without ever missing a leg (a miss would mint a
 * duplicate shipment). It is (re)written on every commit by the committer; the read-side swap is a separate
 * increment, so nothing reads this table yet — creating + backfilling it is inert on live behavior.
 *
 * `type`/`value` mirror `shipment_identifiers` (same 5 strong types, CHECK-guarded) but `value` here is the
 * NORMALIZED key (what matching compares), not the raw display value — the two tables serve different jobs
 * (this = machine index; identifiers = human history).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `CREATE TABLE shipment_match_keys (
  id uniqueidentifier NOT NULL DEFAULT NEWID(),
  shipment_id uniqueidentifier NOT NULL,
  type nvarchar(30) NOT NULL,
  value nvarchar(200) NOT NULL,
  created_at datetimeoffset(7) NOT NULL DEFAULT SYSDATETIMEOFFSET(),
  CONSTRAINT pk_shipment_match_keys PRIMARY KEY (id),
  CONSTRAINT uq_shipment_match_keys UNIQUE (shipment_id, type, value),
  CONSTRAINT fk_shipment_match_keys_shipment FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE CASCADE,
  CONSTRAINT ck_shipment_match_keys_type CHECK (type IN ('booking_no','so_no','hbl_awb_fcr_no','mbl','container_no'))
)`,
    )
    .execute(db)
  await sql
    .raw(`CREATE INDEX ix_shipment_match_keys_type_value ON shipment_match_keys (type, value)`)
    .execute(db)

  await backfill(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`DROP TABLE IF EXISTS shipment_match_keys`).execute(db)
}

/**
 * Populate the index for every existing leg from its `match_keys`. The normalization is a FROZEN inline copy
 * of `strongKeys`/`normKey`/`normBookingKey` (match-keys.ts) — a migration must stay reproducible and must not
 * drift if that app code later changes; new writes go through the live code via the committer. Empty on a
 * fresh DB (no legs) and on prod (Fabric ShipTrackDB provisioned empty).
 */
async function backfill(db: Kysely<unknown>): Promise<void> {
  const normKey = (v: unknown): string => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  const normBookingKey = (v: unknown): string => {
    const raw = String(v ?? '').toUpperCase().trim()
    const base = raw.replace(/[\s\-/]+(?:V|R|REV|AMD|AMEND(?:ED)?|REVISION)\s*\d*$/, '')
    return normKey(base)
  }
  const STRONG = ['so_no', 'booking_no', 'hbl_awb_fcr_no', 'mbl', 'container_no'] as const

  // CamelCasePlugin camelCases result keys; ParseJSONResultsPlugin turns the JSON column into an object —
  // read both shapes defensively (raw string / already-parsed / snake_case fallback).
  const res = await sql<{ id: string; matchKeys?: unknown; match_keys?: unknown }>`select id, match_keys from shipments`.execute(db)
  const rows: { shipmentId: string; type: string; value: string }[] = []
  for (const r of res.rows) {
    const rawMk = r.matchKeys ?? r.match_keys
    let mk: Record<string, unknown> = {}
    if (rawMk && typeof rawMk === 'object') mk = rawMk as Record<string, unknown>
    else if (typeof rawMk === 'string') {
      try {
        mk = JSON.parse(rawMk) as Record<string, unknown>
      } catch {
        mk = {}
      }
    }
    for (const k of STRONG) {
      const value = k === 'booking_no' ? normBookingKey(mk[k]) : normKey(mk[k])
      if (value) rows.push({ shipmentId: r.id, type: k, value })
    }
  }
  if (!rows.length) return
  // batch (SQL Server caps parameters at 2100; 3 per row → 500 rows is well under)
  const anyDb = db as unknown as Kysely<{ shipmentMatchKeys: { shipmentId: string; type: string; value: string } }>
  for (let i = 0; i < rows.length; i += 500) {
    await anyDb.insertInto('shipmentMatchKeys').values(rows.slice(i, i + 500)).execute()
  }
}
