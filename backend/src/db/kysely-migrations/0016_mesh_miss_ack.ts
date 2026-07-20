import { sql, type Kysely } from 'kysely'

/**
 * 0016 — mesh_miss_ack: admin "已入 Mesh" acknowledgements for structured masterMisses.
 * Unique (type, normalized_name); additive only.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE dbo.mesh_miss_ack (
      id uniqueidentifier NOT NULL DEFAULT NEWID() PRIMARY KEY,
      type nvarchar(20) NOT NULL,
      normalized_name nvarchar(400) NOT NULL,
      acked_by nvarchar(200) NOT NULL,
      acked_at datetimeoffset(7) NOT NULL DEFAULT SYSDATETIMEOFFSET(),
      CONSTRAINT uq_mesh_miss_ack UNIQUE (type, normalized_name)
    )
  `.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE dbo.mesh_miss_ack`.execute(db)
}
