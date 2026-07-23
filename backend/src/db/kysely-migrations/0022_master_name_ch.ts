import { sql, type Kysely } from 'kysely'

/**
 * 0022 — Chinese legal names on the party masters (Chinese-name retrieval for the LLM Master Matcher):
 *   customers.name_ch  nvarchar(400) NULL — Mesh FullNameCh, previously fetched-and-dropped
 *   vendors.name_ch    nvarchar(400) NULL — Mesh FullNameCh (factories + gmtsuppliers both carry it)
 * The candidates retrieval serves name_ch as an alias (trigram/token scoring folds 简↔繁 — see
 * masters/cjk-fold.ts), so a simplified-Chinese document name can surface a master stored in
 * traditional script (东莞市嘉发服饰有限公司 → DGJAFA 東莞市嘉發服飾有限公司). Forwarders carry no
 * Chinese name in the Mesh API (code + English name only) — nothing to store there.
 * Additive; rows stay NULL until the next masters sync.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`ALTER TABLE customers ADD name_ch nvarchar(400) NULL`).execute(db)
  await sql.raw(`ALTER TABLE vendors ADD name_ch nvarchar(400) NULL`).execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`ALTER TABLE vendors DROP COLUMN IF EXISTS name_ch`).execute(db)
  await sql.raw(`ALTER TABLE customers DROP COLUMN IF EXISTS name_ch`).execute(db)
}
