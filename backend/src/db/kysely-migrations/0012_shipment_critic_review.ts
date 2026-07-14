import { sql, type Kysely } from 'kysely'

/** 0012 — store agent criticReview JSON on the leg (advisory Phase 1-UI). */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`ALTER TABLE shipments ADD critic_review nvarchar(max) NULL`).execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`ALTER TABLE shipments DROP COLUMN critic_review`).execute(db)
}
