import { sql, type Kysely } from 'kysely'

/**
 * 0023 — collapse `shipments.mode` to SEA | AIR.
 *
 * Ops track sea vs air only; FCL/LCL is a container-loading detail nobody filters or reports on.
 * Carrying it was actively harmful: leg identity partitions on (mode, pod), so ONE shipment split
 * into TWO legs whenever two documents described the same move at different granularity — the
 * booking saying `Sea`, the B/L saying `Sea-LCL`. A single day of real mail produced 11 duplicate-HBL
 * pairs that way.
 *
 * Order matters: the CHECK must come off BEFORE the rows are rewritten, and the narrowed CHECK can
 * only go on AFTER, or the ALTER fails against existing SEA_FCL/SEA_LCL rows.
 *
 * `down` restores the wider CHECK but CANNOT restore the granularity — SEA_FCL/SEA_LCL rows have been
 * rewritten to SEA and the distinction is not recoverable from this table. That is intentional and
 * accepted: the value is re-derivable only by re-parsing the source email, and ops do not want it.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`ALTER TABLE shipments DROP CONSTRAINT IF EXISTS ck_shipments_mode`).execute(db)
  await sql.raw(`UPDATE shipments SET mode = 'SEA' WHERE mode IN ('SEA_FCL', 'SEA_LCL')`).execute(db)
  await sql
    .raw(`ALTER TABLE shipments ADD CONSTRAINT ck_shipments_mode CHECK (mode IS NULL OR mode IN ('SEA','AIR'))`)
    .execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`ALTER TABLE shipments DROP CONSTRAINT IF EXISTS ck_shipments_mode`).execute(db)
  await sql
    .raw(
      `ALTER TABLE shipments ADD CONSTRAINT ck_shipments_mode CHECK (mode IS NULL OR mode IN ('SEA','SEA_FCL','SEA_LCL','AIR'))`,
    )
    .execute(db)
}
