import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { alertRules } from '../db/schema.js'

type Env = { Variables: { db: any } }

const alertRulesRouter = new Hono<Env>()

// GET /alert-rules - List all rules
alertRulesRouter.get('/alert-rules', async (c) => {
  const db = c.get('db')
  const rules = await db.select().from(alertRules)
  return c.json({ rules })
})

// PUT /alert-rules - Bulk update rules
alertRulesRouter.put('/alert-rules', async (c) => {
  const db = c.get('db')
  const body = await c.req.json()
  const rules = body.rules

  if (!Array.isArray(rules)) {
    return c.json({ error: 'rules must be an array' }, 400)
  }

  for (const rule of rules) {
    // Don't allow modifying locked rules
    const existing = await db.select().from(alertRules).where(eq(alertRules.id, rule.id)).get()
    if (!existing) continue
    if (existing.locked) continue

    await db
      .update(alertRules)
      .set({
        thresholdDays: rule.thresholdDays,
        severity: rule.severity,
        enabled: rule.enabled,
        updatedAt: new Date(),
      })
      .where(eq(alertRules.id, rule.id))
  }

  const updated = await db.select().from(alertRules)
  return c.json({ rules: updated })
})

export default alertRulesRouter
