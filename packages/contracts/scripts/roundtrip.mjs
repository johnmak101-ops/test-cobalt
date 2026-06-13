// Phase-0 exit proof: apply the generated DDL to a fresh Postgres, then exercise the
// model end-to-end — the cobalt-queue seam (queue_message -> evidence.parsed_record) AND
// the tracking truth model (PO -> booking -> two legs with a sea->air supersede, a field-lock,
// an audit row) — and read it back. Plain `pg`, no ORM/tsx needed.
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
const drizzleDir = join(__dirname, '..', 'drizzle')
const url = process.env.DATABASE_URL
if (!url) { console.error('DATABASE_URL not set'); process.exit(1) }
const log = (...a) => console.log(...a)

async function getClient(tries = 20) {
  for (let i = 0; i < tries; i++) {
    const c = new pg.Client({ connectionString: url })
    try { await c.connect(); return c } catch (e) {
      try { await c.end() } catch {}
      if (i === tries - 1) throw e
      await new Promise((r) => setTimeout(r, 1000))
    }
  }
}

async function main() {
  const client = await getClient()

  // 1) Apply the generated DDL (all 6 schemas + every table)
  const sqlFile = readdirSync(drizzleDir).filter((f) => f.endsWith('.sql')).sort()[0]
  if (!sqlFile) throw new Error('no generated .sql — run drizzle-kit generate first')
  await client.query(readFileSync(join(drizzleDir, sqlFile), 'utf8'))
  log('OK applied DDL:', sqlFile)

  // 2) SEAM: queue_message -> evidence.parsed_record (what the matching agent will read)
  const msg = await client.query(
    `insert into queue.queue_message (graph_message_id, subject, sender, status)
     values ($1,$2,$3,'DONE') returning id`,
    ['rt-graph-001', 'NLOB UK Torque ID_118997 Booking', 'ops@torque.example'],
  )
  const messageId = msg.rows[0].id
  const fields = { customer_code: 'NEWLOB', customer_po: '100-100209', vendor_code: 'ROKNFT', booking_no: '118997', forwarder_name: 'Torque', poi: 'CNYTN', pod: 'GBFXT', cargo_ready_date: '2026-02-03' }
  const matchKeys = { customer_po: '100-100209', booking_no: '118997', conversation_id: 'conv-rt-1' }
  const rec = await client.query(
    `insert into evidence.parsed_record
       (message_id, graph_message_id, record_idx, po_no, email_type, sender_type, mode, fields, match_keys, amendments, needs_review, confidence, parser_adapter)
     values ($1,'rt-graph-001',0,'100-100209','Booking Request','forwarder','SEA',$2,$3,'[]','[]','high','responses')
     returning id`,
    [messageId, fields, matchKeys],
  )
  log('OK evidence.parsed_record:', rec.rows[0].id)

  // 3) TRUTH: PO -> booking -> two legs (sea SUPERSEDED by air) -> split, field-lock, audit
  const po = await client.query(
    `insert into tracking.purchase_orders (po_number, brand, item_style_no, total_quantity, quantity_unit)
     values ('100-100209','New Lobster','KT-771',5000,'pieces') returning id`)
  const poId = po.rows[0].id
  const bk = await client.query(
    `insert into tracking.bookings (job_no, brand, status) values ('JOB-000001','New Lobster','ACTIVE') returning id`)
  const bookingId = bk.rows[0].id
  await client.query(`insert into tracking.booking_pos (booking_id, po_id) values ($1,$2)`, [bookingId, poId])

  const leg1 = await client.query(
    `insert into tracking.shipments (booking_id, leg_no, mode, state, leg_status, booking_no, vessel_name, match_keys)
     values ($1,1,'SEA','CONFIRMED','SUPERSEDED','118997','EVER GLOBE',$2) returning id`, [bookingId, matchKeys])
  const leg2 = await client.query(
    `insert into tracking.shipments (booking_id, leg_no, mode, state, leg_status, flight_no, match_keys)
     values ($1,2,'AIR','BOOKED','ACTIVE','CX251',$2) returning id`, [bookingId, matchKeys])
  await client.query(`update tracking.shipments set superseded_by_id=$1 where id=$2`, [leg2.rows[0].id, leg1.rows[0].id])
  await client.query(`insert into tracking.shipment_pos (shipment_id, po_id, quantity, quantity_unit) values ($1,$2,5000,'pieces')`, [leg2.rows[0].id, poId])
  await client.query(
    `insert into tracking.field_locks (entity_type, entity_id, field, locked_value)
     values ('booking',$1,'consignee_name','CINQ-HUITIEMES S.A.')`, [bookingId])
  await client.query(
    `insert into audit.change_log (entity_type, entity_id, field, old_value, new_value, change_type, source_type)
     values ('shipment',$1,'leg_status','ACTIVE','SUPERSEDED','supersede','system')`, [leg1.rows[0].id])

  // 4) Read back the booking with both legs
  const view = await client.query(
    `select b.job_no, s.leg_no, s.mode, s.state, s.leg_status, (s.superseded_by_id is not null) superseded
       from tracking.bookings b join tracking.shipments s on s.booking_id=b.id where b.id=$1 order by s.leg_no`, [bookingId])
  log(`\n-- Booking ${view.rows[0].job_no} --`)
  for (const r of view.rows) log(`   leg ${r.leg_no}: ${r.mode} | ${r.state} | ${r.leg_status}${r.superseded ? '  (-> superseded)' : ''}`)

  const counts = await client.query(`
    select 'queue.queue_message' t, count(*)::int n from queue.queue_message
    union all select 'evidence.parsed_record', count(*)::int from evidence.parsed_record
    union all select 'tracking.bookings', count(*)::int from tracking.bookings
    union all select 'tracking.shipments', count(*)::int from tracking.shipments
    union all select 'tracking.field_locks', count(*)::int from tracking.field_locks
    union all select 'audit.change_log', count(*)::int from audit.change_log order by t`)
  log('\n-- row counts --')
  for (const r of counts.rows) log(`   ${r.t}: ${r.n}`)

  const schemas = await client.query(
    `select schema_name from information_schema.schemata
      where schema_name in ('queue','evidence','tracking','audit','alerts','match') order by 1`)
  log('\n-- schemas --', schemas.rows.map((r) => r.schema_name).join(', '))
  await client.end()
  log('\nOK round-trip complete')
}
main().catch((e) => { console.error('FAIL', e.message); process.exit(1) })
