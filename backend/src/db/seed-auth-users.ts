import bcrypt from 'bcryptjs'
import * as schema from './contracts'
import type { DrizzleDB } from './drizzle.provider'

/** Placeholder password for the 2 human admin accounts (override via SEED_INITIAL_PASSWORD). Paired with
 *  `mustReset`, so it only ever grants the ONE first login before the account is forced to set a real one. */
const INITIAL_PASSWORD = process.env.SEED_INITIAL_PASSWORD ?? 'cobalt-change-me'
/** Agent VM (cobalt-queue Matcher) service-account password — must match the queue's TRACKING_AGENT_PASSWORD. */
const AGENT_PASSWORD = process.env.TRACKING_AGENT_PASSWORD ?? 'cobalt'

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
  return db
    .insert(schema.users)
    .values([
      { email: 'super@cobalt.hk', name: 'Sue Super', passwordHash: initialPw, role: 'SUPERADMIN', avatarInitials: 'SS', mustReset: true },
      { email: 'admin@cobalt.hk', name: 'Amon Admin', passwordHash: initialPw, role: 'ADMIN', avatarInitials: 'AA', mustReset: true },
      { email: 'agent@cobalt.hk', name: 'Cobalt Agent', passwordHash: agentPw, role: 'EDITOR', avatarInitials: 'AG', mustReset: false },
    ])
    .returning()
}
