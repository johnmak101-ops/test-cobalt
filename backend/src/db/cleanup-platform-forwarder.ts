/**
 * One-shot cleanup: clear the TradeLink CVP platform from forwarder slots — it is a notification
 * platform, never the freight forwarder (John 2026-07-02). Clears shipments.forwarder_id/forwarder_raw
 * and bookings.forwarder_id where they point at a platform forwarder master or a platform raw string,
 * writing an audit.change_log row per cleared shipment. Idempotent — re-running finds nothing.
 *
 * Run: npx tsx src/db/cleanup-platform-forwarder.ts
 */
import { Pool } from 'pg'

const PLATFORM_SQL = `(name ~* 'TRADE\\s*LINK\\s*(TECHNOLOGIES|ONE)' OR name ~* 'TRADELINKONE\\.COM')`
const RAW_SQL = `(forwarder_raw ~* 'TRADE\\s*LINK\\s*(TECHNOLOGIES|ONE)' OR forwarder_raw ~* 'TRADELINKONE\\.COM')`

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/cobalt_track',
  })

  const fwd = (await pool.query(`SELECT id, name FROM tracking.forwarders WHERE ${PLATFORM_SQL}`)).rows
  console.log('platform forwarder masters:', fwd.map((f: { id: string; name: string }) => f.name))
  const ids = fwd.map((f: { id: string }) => f.id)

  const legs = ids.length
    ? (
        await pool.query(
          `SELECT id, forwarder_id, forwarder_raw FROM tracking.shipments
            WHERE forwarder_id = ANY($1) OR ${RAW_SQL}`,
          [ids],
        )
      ).rows
    : (await pool.query(`SELECT id, forwarder_id, forwarder_raw FROM tracking.shipments WHERE ${RAW_SQL}`)).rows

  console.log(`legs to clear: ${legs.length}`)
  for (const leg of legs) {
    await pool.query(`UPDATE tracking.shipments SET forwarder_id = NULL, forwarder_raw = NULL, updated_at = now() WHERE id = $1`, [leg.id])
    await pool.query(
      `INSERT INTO audit.change_log (entity_type, entity_id, field, old_value, new_value, change_type, source_type, note)
       VALUES ('shipment', $1, 'forwarder', $2, NULL, 'update', 'system',
               'TradeLink CVP platform is not a forwarder — cleared (cleanup 2026-07-02)')`,
      [leg.id, leg.forwarder_raw ?? leg.forwarder_id],
    )
  }

  const bk = ids.length
    ? await pool.query(`UPDATE tracking.bookings SET forwarder_id = NULL, updated_at = now() WHERE forwarder_id = ANY($1)`, [ids])
    : { rowCount: 0 }
  console.log(`bookings cleared: ${bk.rowCount}`)

  const check = ids.length
    ? (await pool.query(`SELECT count(*)::int AS n FROM tracking.shipments WHERE forwarder_id = ANY($1) OR ${RAW_SQL}`, [ids])).rows[0]
    : { n: 0 }
  console.log(`remaining references: ${check.n}`)
  await pool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
