import { Inject, Injectable } from '@nestjs/common'
import { sql, type Kysely } from 'kysely'
import type { DB } from '../kysely/db'
import { KYSELY } from '../kysely.provider'

/** Raised when a mutation would leave zero active SUPERADMINs. */
export class LastActiveSuperadminError extends Error {
  constructor() {
    super('cannot deactivate or demote the last active superadmin')
    this.name = 'LastActiveSuperadminError'
  }
}

type UserInsert = {
  email: string
  name: string
  passwordHash: string
  role: string
  avatarInitials?: string | null
  active?: boolean
  mustReset?: boolean
}

/** Kysely/SQL Server port of UsersRepository. */
@Injectable()
export class UsersRepository {
  constructor(@Inject(KYSELY) private readonly db: Kysely<DB>) {}

  async findByEmail(email: string) {
    const u = await this.db.selectFrom('users').where('email', '=', email.toLowerCase()).selectAll().executeTakeFirst()
    return u ?? null
  }
  async findById(id: string) {
    const u = await this.db.selectFrom('users').where('id', '=', id).selectAll().executeTakeFirst()
    return u ?? null
  }
  async create(values: UserInsert) {
    const u = await this.db.insertInto('users').values(values).outputAll('inserted').executeTakeFirstOrThrow()
    return u
  }
  list() {
    return this.db.selectFrom('users').orderBy('createdAt').selectAll().execute()
  }
  async update(id: string, patch: Partial<UserInsert>) {
    const u = await this.db.updateTable('users').set({ ...patch, updatedAt: new Date() }).where('id', '=', id).outputAll('inserted').executeTakeFirst()
    return u ?? null
  }
  async countActiveByRole(role: string) {
    const rows = await this.db.selectFrom('users').select('id').where('role', '=', role).where('active', '=', true).execute()
    return rows.length
  }

  /**
   * Apply `patch` to user `id` inside a transaction that FIRST locks every active SUPERADMIN row
   * (MSSQL: `WITH (UPDLOCK, HOLDLOCK)`) and re-counts. Throws when the change would leave fewer than
   * one active superadmin. Mirrors the Drizzle `FOR UPDATE` guard.
   */
  updateGuardingLastActiveSuperadmin(id: string, patch: Partial<UserInsert>) {
    return this.db.transaction().execute(async (tx) => {
      // MSSQL row lock: WITH (UPDLOCK, HOLDLOCK) — the MSSQL equivalent of Postgres FOR UPDATE.
      // Kysely's forUpdate() emits `FOR UPDATE` which MSSQL rejects ( DECLARE CURSOR only).
      const locked = await sql<{ id: string }>`SELECT id FROM users WITH (UPDLOCK, HOLDLOCK) WHERE role = 'SUPERADMIN' AND active = 1`.execute(tx)
      if (locked.rows.length <= 1) throw new LastActiveSuperadminError()
      const u = await tx.updateTable('users').set({ ...patch, updatedAt: new Date() }).where('id', '=', id).outputAll('inserted').executeTakeFirst()
      return u ?? null
    })
  }
}
