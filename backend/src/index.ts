import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { db } from './db/index.js'
import { users } from './db/schema.js'
import { eq } from 'drizzle-orm'
import { seed } from './db/seed.js'
import app from './app.js'

/**
 * Node.js entry point for local development and production.
 * Injects the better-sqlite3 DB into Hono context,
 * then mounts the shared routes.
 */
const server = new Hono<{ Variables: { db: typeof db } }>()

// Inject local DB into context for all routes
server.use('*', async (c, next) => {
  c.set('db' as any, db)
  await next()
})

server.route('/', app)

const port = parseInt(process.env.PORT ?? '3000', 10)

// Auto-seed if database is empty (ensures login always works after a fresh start)
async function startServer() {
  const existingUsers = await db.select().from(users)
  if (existingUsers.length === 0) {
    console.log('Database is empty — running seed...')
    await seed()
  }

  console.log(`Server is running on http://localhost:${port}`)
  serve({
    fetch: server.fetch,
    port,
  })
}

startServer()
