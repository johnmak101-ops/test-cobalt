import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { emailIntegrations } from '../db/schema.js'
import { testGraphConnection, runEmailSync } from '../services/email-sync.js'

type Env = { Variables: { db: any } }

const emailIntegrationsRouter = new Hono<Env>()

// Mask a secret string, showing only last 4 characters
function maskSecret(secret: string): string {
  if (secret.length <= 4) return '••••'
  return '••••••••' + secret.slice(-4)
}

// GET /email-integrations — Get current configuration (secrets masked)
emailIntegrationsRouter.get('/email-integrations', async (c) => {
  const db = c.get('db')
  const config = await db.select().from(emailIntegrations).get()

  if (!config) {
    return c.json({ config: null })
  }

  // Mask the client secret for security
  return c.json({
    config: {
      ...config,
      clientSecret: maskSecret(config.clientSecret),
      _secretMasked: true,
    },
  })
})

// PUT /email-integrations — Save/update configuration
emailIntegrationsRouter.put('/email-integrations', async (c) => {
  const db = c.get('db')
  const body = await c.req.json()

  const { tenantId, clientId, clientSecret, mailboxEmail, isActive } = body

  if (!tenantId || !clientId) {
    return c.json({ error: 'Tenant ID and Client ID are required' }, 400)
  }

  const existing = await db.select().from(emailIntegrations).get()

  // Determine the actual client secret value
  // If the client secret is the masked value, keep the existing one
  let actualSecret = clientSecret
  if (existing && clientSecret && clientSecret.includes('••')) {
    actualSecret = existing.clientSecret
  } else if (!clientSecret && existing) {
    actualSecret = existing.clientSecret
  }

  if (!actualSecret) {
    return c.json({ error: 'Client Secret is required' }, 400)
  }

  const configData = {
    tenantId,
    clientId,
    clientSecret: actualSecret,
    mailboxEmail: mailboxEmail || null,
    isActive: isActive === true,
    updatedAt: new Date(),
  }

  if (existing) {
    await db
      .update(emailIntegrations)
      .set(configData)
      .where(eq(emailIntegrations.id, existing.id))
  } else {
    await db.insert(emailIntegrations).values({
      id: 'default',
      ...configData,
    })
  }

  // Return the saved config with masked secret
  const saved = await db.select().from(emailIntegrations).get()
  return c.json({
    config: {
      ...saved,
      clientSecret: maskSecret(saved!.clientSecret),
      _secretMasked: true,
    },
  })
})

// POST /email-integrations/test — Test the connection
emailIntegrationsRouter.post('/email-integrations/test', async (c) => {
  const db = c.get('db')
  const result = await testGraphConnection(db)

  // Reload config to get the updated mailbox email (if auto-detected)
  const config = await db.select().from(emailIntegrations).get()
  return c.json({
    ...result,
    config: config
      ? { ...config, clientSecret: maskSecret(config.clientSecret), _secretMasked: true }
      : null,
  })
})

// POST /email-integrations/sync — Trigger manual sync
emailIntegrationsRouter.post('/email-integrations/sync', async (c) => {
  const db = c.get('db')

  const config = await db.select().from(emailIntegrations).get()
  if (!config) {
    return c.json({ error: 'No email integration configured. Save credentials first.' }, 400)
  }

  if (!config.tenantId || !config.clientId || !config.clientSecret) {
    return c.json({ error: 'Missing required credentials.' }, 400)
  }

  if (!config.mailboxEmail) {
    return c.json({ error: 'Mailbox email not detected. Run "Test Connection" first.' }, 400)
  }

  const result = await runEmailSync(db)

  // Return updated config
  const updated = await db.select().from(emailIntegrations).get()
  return c.json({
    ...result,
    config: updated
      ? { ...updated, clientSecret: maskSecret(updated.clientSecret), _secretMasked: true }
      : null,
  })
})

export default emailIntegrationsRouter