/**
 * Seed the co-valid-entity relationship facts into tracking.master_resolution (status=approved). This is
 * the ONE step that ACTIVATES the co-valid customer-entity model: until these rows exist every distinct
 * customer code stays a conflict (the fail-safe). Read by BOTH the VM1 committer (writeParties) and the
 * cobalt-queue validator (loadMasters reads tracking.master_resolution WHERE status='approved').
 *
 * Idempotent (ON CONFLICT DO NOTHING on the (kind,lhs,rhs) unique key) — safe to re-run. NON-destructive
 * (inserts only; never truncates). Run: pnpm --filter backend seed:entity-facts  (uses DATABASE_URL).
 *
 * Decisions encoded (see the design): bill_to wins the primary; SEH is a Primark GROUP sibling (NOT a
 * canonical rewrite — stays reviewed until a human confirms); COLEB→COLE is a true duplicate (canonical).
 * Regional siblings (TORY / PRIMARK / COBALT_FASHION) carry group membership only — no curated bill_to —
 * so they co-list but route to a primary-review rather than auto-applying an arrival-order primary.
 */
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from '@cobalt/contracts'

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/cobalt'

/** code → buyer-group id (two codes sharing a non-empty group are co-valid siblings) */
const GROUPS: [string, string][] = [
  ['AEOW', 'AMERICAN_EAGLE'], ['BLUI', 'AMERICAN_EAGLE'],
  ['TORL', 'TORY'], ['TOFE', 'TORY'], ['TORY', 'TORY'], ['TOJP', 'TORY'],
  ['PRMK', 'PRIMARK'], ['PRMS', 'PRIMARK'], ['PRMT', 'PRIMARK'], ['SEH', 'PRIMARK'],
  ['CFUK', 'COBALT_FASHION'], ['CLLC', 'COBALT_FASHION'],
]
/** code → curated role; only a bill_to pins the booking's primary for auto-apply */
const ROLES: [string, string][] = [['AEOW', 'bill_to'], ['BLUI', 'importer_of_record']]
/** alias/duplicate code → canonical survivor (folded before merge) */
const CANONICAL: [string, string][] = [['COLEB', 'COLE']]

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const db = drizzle(pool, { schema })
  const rows = [
    ...GROUPS.map(([lhs, rhs]) => ({ kind: 'customer_group' as const, lhs, rhs })),
    ...ROLES.map(([lhs, rhs]) => ({ kind: 'customer_role' as const, lhs, rhs })),
    ...CANONICAL.map(([lhs, rhs]) => ({ kind: 'customer_canonical' as const, lhs, rhs })),
  ].map((r) => ({ ...r, status: 'approved' as const, source: 'seed' as const, reason: 'co-valid entity model seed' }))

  await db.insert(schema.masterResolution).values(rows).onConflictDoNothing()
  // eslint-disable-next-line no-console
  console.log(`entity-relationship facts seeded (idempotent): ${GROUPS.length} group + ${ROLES.length} role + ${CANONICAL.length} canonical`)
  await pool.end()
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e)
  process.exit(1)
})
