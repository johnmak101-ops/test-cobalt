import { Inject, Injectable } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import * as schema from '@cobalt/contracts'
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
}
