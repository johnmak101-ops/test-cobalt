// HTTP smoke test — assumes the backend is running (PORT 3000) against the seeded dev DB.
// Run: pnpm --filter backend smoke   (after `pnpm --filter backend dev` + seed + reconcile)
const BASE = process.env.SMOKE_BASE ?? 'http://localhost:3000'

const get = async (p) => {
  const r = await fetch(BASE + p)
  if (!r.ok) throw new Error(`GET ${p} -> ${r.status}`)
  return r.json()
}
const post = async (p) => {
  const r = await fetch(BASE + p, { method: 'POST' })
  if (!r.ok) throw new Error(`POST ${p} -> ${r.status}`)
  return r.json()
}
const ok = (c, m) => {
  if (!c) throw new Error('FAIL: ' + m)
  console.log('  ok: ' + m)
}

;(async () => {
  const h = await get('/api/health')
  ok(h.status === 'ok' && h.db === 'up', 'health: status ok + db up')
  const r = await post('/api/reconcile/run')
  ok(typeof r.groups === 'number' && typeof r.evidence === 'number', `reconcile ran (evidence=${r.evidence} groups=${r.groups})`)
  const bk = await get('/api/bookings')
  ok(Array.isArray(bk) && bk.length > 0, `bookings returned (${bk.length})`)
  const d = await get('/api/bookings/' + bk[0].id)
  ok(Array.isArray(d.legs) && d.legs.length > 0, `booking detail has legs (${d.legs.length})`)
  ok(Array.isArray((await get('/api/masters/ports'))), 'masters/ports list')
  console.log('SMOKE PASSED')
})().catch((e) => {
  console.error('SMOKE FAILED:', e.message)
  process.exit(1)
})
