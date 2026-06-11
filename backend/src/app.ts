import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import authRouter from './routes/auth.js'
import dashboard from './routes/dashboard.js'
import shipmentsRouter from './routes/shipments.js'
import emailsRouter from './routes/emails.js'
import alertsRouter from './routes/alerts.js'
import alertRulesRouter from './routes/alert-rules.js'
import customersRouter from './routes/customers.js'
import forwardersRouter from './routes/forwarders.js'
import purchaseOrdersRouter from './routes/purchase-orders.js'
import vendorsRouter from './routes/vendors.js'
import emailIntegrationsRouter from './routes/email-integrations.js'

/**
 * Shared Hono routes — runtime-agnostic.
 * DB is accessed via c.var.db, injected by the entry point (index.ts).
 */
type AppEnv = { Variables: { db: any } }

const app = new Hono<AppEnv>()

// Global error handler
app.onError((err, c) => {
  console.error('Unhandled error:', err.message, err.stack)
  return c.json({ error: err.message }, 500)
})

// Middleware
app.use('*', logger())
app.use('*', cors())

// Health check
app.get('/api/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Auth routes (no session check needed)
app.route('/api', authRouter)

// Mount route modules under /api
app.route('/api', dashboard)
app.route('/api', shipmentsRouter)
app.route('/api', emailsRouter)
app.route('/api', alertsRouter)
app.route('/api', alertRulesRouter)
app.route('/api', customersRouter)
app.route('/api', forwardersRouter)
app.route('/api', purchaseOrdersRouter)
app.route('/api', vendorsRouter)
app.route('/api', emailIntegrationsRouter)

export default app
