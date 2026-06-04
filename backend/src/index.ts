import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { db } from './db/index.js'
import { users } from './db/schema.js'
import { emailIntegrations } from './db/schema.js'
import { eq } from 'drizzle-orm'
import { seed } from './db/seed.js'
import { runEmailSync } from './services/email-sync.js'
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

  // Background email sync — polls every 5 minutes when active
  const SYNC_INTERVAL = 5 * 60 * 1000
  setInterval(async () => {
    try {
      const config = await db.select().from(emailIntegrations).get()
      if (config?.isActive && config.tenantId && config.clientId && config.clientSecret && config.mailboxEmail) {
        console.log('[EmailSync] Running scheduled sync...')
        const result = await runEmailSync(db)
        console.log(`[EmailSync] Scheduled sync complete: ${result.synced} synced, ${result.errors.length} errors`)
      }
    } catch (err) {
      console.error('[EmailSync] Scheduled sync error:', err)
    }
  }, SYNC_INTERVAL)
  console.log('[EmailSync] Background sync enabled (5 min interval)')
}

startServer()
