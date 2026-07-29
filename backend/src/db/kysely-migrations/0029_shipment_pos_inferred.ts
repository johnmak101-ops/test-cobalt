import { sql, type Kysely } from 'kysely'

/**
 * 0029 — how STRONGLY this shipment claims this PO.
 *
 * The cross-HAWB guard in `planPoReconcile` refuses to link a PO a sibling leg already holds under a
 * different B/L. That guard is right — one PO on two same-mode HAWBs is the split it exists to prevent —
 * but it resolves the collision by ARRIVAL ORDER, and arrival order is not evidence.
 *
 * Set 5 is the case. The 2026-01-20 email states four POs in its subject and carries an attachment that
 * is a programme-wide list; the parser emits a record per attachment row and every one inherits that
 * email's AWB. So GZL26258522 claimed ten POs, including 28739/28740 — which the 2026-01-31 email then
 * names explicitly in its own subject. Arriving eleven days later, it lost: the guard skipped its POs as
 * "exclusive to sibling HAWB" and the real leg committed with NO cargo at all.
 *
 * `inferred` records which side of that a link came from, as the queue reported it (`posInferred`):
 *
 *   0 (default)  STATED   — a record's own `po_list_stated` named this PO, or the group stated nothing
 *                           at all and is therefore making its own claim
 *   1            INFERRED — swept up with the group but never stated; typically an attachment row that
 *                           inherited the email's B/L
 *
 * With it, a STATED claim can displace an INFERRED one instead of losing to it on timing. Nothing
 * displaces a stated link, and two stated claims still flag rather than fight.
 *
 * Defaults to 0 deliberately. Every row written before this has no recoverable provenance, and calling
 * them all STATED means the new rule can never retroactively move historical cargo — it only takes
 * effect once the queue starts reporting claim strength.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`ALTER TABLE shipment_pos ADD inferred bit NOT NULL CONSTRAINT df_shipment_pos_inferred DEFAULT 0`).execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`ALTER TABLE shipment_pos DROP CONSTRAINT IF EXISTS df_shipment_pos_inferred`).execute(db)
  await sql.raw(`ALTER TABLE shipment_pos DROP COLUMN IF EXISTS inferred`).execute(db)
}
