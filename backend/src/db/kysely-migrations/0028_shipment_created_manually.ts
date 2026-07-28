import { sql, type Kysely } from 'kysely'

/**
 * 0028 — did a PERSON type this leg?
 *
 * Every leg in `shipments` looks the same to the committer, and two of its rules quietly assume the
 * row was minted by the pipeline:
 *
 *   1. `findExistingLeg`'s shared-PO branch only fires when ONE side has no strong id. A leg a human
 *      created carries whatever number they happened to hold (usually the booking no.), so a later
 *      forwarder email citing a DIFFERENT id (an HBL, say) plus the same PO cannot reconnect — it
 *      mints a second leg beside the first. For two agent legs that rule is right: one PO genuinely
 *      ships across several shipments, which is why the branch is narrow. For a hand-typed leg it
 *      inverts the intent — the operator created it precisely BECAUSE the booking email never
 *      arrived, so a partial identity is the normal case, not a signal of a different shipment.
 *
 *   2. `findSupersededByIdentityCorrection` retires a *provisional* leg whose booking-layer ids
 *      conflict-and-overlap with a newer one — the re-parse ghost (BEFF01). A manual leg is born
 *      provisional, so an operator's typo in the SO number was enough to have their row dismissed
 *      and linked away by the next email. The content survives on the successor; the field LOCKS do
 *      not, so a value the human deliberately protected quietly stopped being protected.
 *
 * Neither is fixed by loosening the matcher — that would silently MERGE shipments that may be
 * distinct, which is the failure the narrow rules exist to prevent. Both are fixed by knowing which
 * legs a person made, so the committer can surface the situation for review instead of acting on it.
 * (See `findPoOnlyDuplicateRisk` / `findManualIdentityClash`.)
 *
 * `bit NOT NULL DEFAULT 0`: absence is not ambiguous here the way `committer_action` (0027) was —
 * a leg either came through POST /shipments or it did not, and every row that predates this column
 * did not. The backfill recovers the ones already on record: `createManual` has always written a
 * `change_log` row with `field='created', new_value='manual'`, so the history can name them exactly
 * rather than leaving legs the operator hand-entered last week outside the protection.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `ALTER TABLE shipments ADD created_manually bit NOT NULL
         CONSTRAINT df_shipments_created_manually DEFAULT 0`,
    )
    .execute(db)
  // Retroactive: legs POST /shipments already minted, identified by their own create-audit row.
  await sql
    .raw(
      `UPDATE s SET created_manually = 1
         FROM shipments s
        WHERE EXISTS (
          SELECT 1 FROM change_log c
           WHERE c.entity_id = s.id
             AND c.entity_type = 'shipment'
             AND c.field = 'created'
             AND c.new_value = 'manual'
        )`,
    )
    .execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(`ALTER TABLE shipments DROP CONSTRAINT IF EXISTS df_shipments_created_manually`)
    .execute(db)
  await sql.raw(`ALTER TABLE shipments DROP COLUMN IF EXISTS created_manually`).execute(db)
}
