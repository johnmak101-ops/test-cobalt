import { Inject, Injectable } from '@nestjs/common'
import { and, eq } from 'drizzle-orm'
import * as schema from '../contracts'
import { DRIZZLE, type DrizzleDB } from '../drizzle.provider'

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
}
