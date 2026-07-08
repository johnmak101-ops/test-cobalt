import bcrypt from 'bcryptjs'
import * as schema from './contracts'
import type { DrizzleDB } from './drizzle.provider'

/** Seed passwords are dev placeholders; in production they MUST come from env (fail otherwise). */
function seedPassword(envVar: string, devFallback: string): string {
  const v = process.env[envVar]
  if (v) return v
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`${envVar} must be set when seeding auth users in production`)
  }
  return devFallback
}
/** Placeholder password for the 2 human admin accounts (override via SEED_INITIAL_PASSWORD). Paired with
 *  `mustReset`, so it only ever grants the ONE first login before the account is forced to set a real one. */
const INITIAL_PASSWORD = seedPassword('SEED_INITIAL_PASSWORD', 'cobalt-change-me')
/** Agent VM (cobalt-queue Matcher) service-account password — must match the queue's TRACKING_AGENT_PASSWORD. */
const AGENT_PASSWORD = seedPassword('TRACKING_AGENT_PASSWORD', 'cobalt')

/**
 * Seed the initial auth accounts:
 *   - 2 HUMAN admins (super/admin) with a placeholder password + `mustReset` → forced change on first login.
 *   - the Agent VM SERVICE account (agent@cobalt.hk, EDITOR) with its own password and NO forced reset
 *     (a machine login can't do an interactive password change).
 * Returns the inserted rows so callers can attribute demo data to a real user id.
 */
export async function seedAuthUsers(db: DrizzleDB) {
  const initialPw = await bcrypt.hash(INITIAL_PASSWORD, 10)
  const agentPw = await bcrypt.hash(AGENT_PASSWORD, 10)
  // Idempotent: the seed no longer truncates `users` (that CASCADE would wipe master_resolution), so a
  // reseed must not duplicate the demo accounts. Existing accounts (incl. a changed password) are left as-is;
  // drop + recreate the DB for a fully pristine demo.
  return db
    .insert(schema.users)
    .values([
      { email: 'super@cobalt.hk', name: 'Sue Super', passwordHash: initialPw, role: 'SUPERADMIN', avatarInitials: 'SS', mustReset: true },
      { email: 'admin@cobalt.hk', name: 'Amon Admin', passwordHash: initialPw, role: 'ADMIN', avatarInitials: 'AA', mustReset: true },
      { email: 'agent@cobalt.hk', name: 'Cobalt Agent', passwordHash: agentPw, role: 'EDITOR', avatarInitials: 'AG', mustReset: false },
    ])
    .onConflictDoNothing({ target: schema.users.email })
    .returning()
}
