import { Inject, Injectable } from '@nestjs/common'
import { and, eq } from 'drizzle-orm'
import * as schema from '../contracts'
import { DRIZZLE, type DrizzleDB } from '../drizzle.provider'

/** Raised when a mutation would leave zero active SUPERADMINs. HTTP-agnostic — the service maps it. */
export class LastActiveSuperadminError extends Error {
  constructor() {
    super('cannot deactivate or demote the last active superadmin')
    this.name = 'LastActiveSuperadminError'
  }
}

/** Data access for auth users. */
@Injectable()
export class UsersRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async findByEmail(email: string) {
    const [u] = await this.db.select().from(schema.users).where(eq(schema.users.email, email.toLowerCase()))
    return u ?? null
  }
  async findById(id: string) {
    const [u] = await this.db.select().from(schema.users).where(eq(schema.users.id, id))
    return u ?? null
  }
  async create(values: typeof schema.users.$inferInsert) {
    const [u] = await this.db.insert(schema.users).values(values).returning()
    return u
  }
  list() {
    return this.db.select().from(schema.users).orderBy(schema.users.createdAt)
  }
  async update(id: string, patch: Partial<typeof schema.users.$inferInsert>) {
    const [u] = await this.db
      .update(schema.users)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(schema.users.id, id))
      .returning()
    return u ?? null
  }
  async countActiveByRole(role: string) {
    const rows = await this.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(and(eq(schema.users.role, role as never), eq(schema.users.active, true)))
    return rows.length
  }

  /**
   * Apply `patch` to user `id` inside a transaction that FIRST locks every active SUPERADMIN row
   * (`FOR UPDATE`) and re-counts. Two concurrent deactivations/demotions of the final superadmins
   * therefore serialize on those row locks instead of both reading a stale "2 active" and both
   * committing (check-then-act → zero active). Throws {@link LastActiveSuperadminError} when the
   * change would leave fewer than one active superadmin.
   *
   * Precondition (enforced by the caller): `id` is itself an active superadmin being deactivated or
   * demoted, so it is in the locked set and "≤1 remaining" means "this is the last one".
   */
  async updateGuardingLastActiveSuperadmin(id: string, patch: Partial<typeof schema.users.$inferInsert>) {
    return this.db.transaction(async (tx) => {
      const activeSupers = await tx
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(and(eq(schema.users.role, 'SUPERADMIN' as never), eq(schema.users.active, true)))
        .for('update')
      if (activeSupers.length <= 1) throw new LastActiveSuperadminError()
      const [u] = await tx
        .update(schema.users)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(schema.users.id, id))
        .returning()
      return u ?? null
    })
  }
}
