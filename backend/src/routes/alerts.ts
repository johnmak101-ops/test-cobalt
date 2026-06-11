import { Hono } from 'hono'
import { eq, desc } from 'drizzle-orm'
import { alerts, shipments, customers } from '../db/schema.js'
import { evaluateAlerts, evaluateAlertsForShipment } from '../services/alert-evaluator.js'

type Env = { Variables: { db: any } }

const alertsRouter = new Hono<Env>()

// GET /alerts - List all alerts (active by default)
alertsRouter.get('/alerts', async (c) => {
  const db = c.get('db')
  const statusFilter = c.req.query('status') // 'ACTIVE', 'ALL', etc.

  let results
  if (statusFilter && statusFilter !== 'ALL') {
    results = await db
      .select()
      .from(alerts)
      .where(eq(alerts.status, statusFilter as any))
      .orderBy(desc(alerts.triggeredAt))
  } else {
    results = await db
      .select()
      .from(alerts)
      .where(eq(alerts.status, 'ACTIVE'))
      .orderBy(desc(alerts.triggeredAt))
  }

  // Enrich with shipment info
  const enriched = []
  for (const alert of results) {
    const shipment = await db
      .select()
      .from(shipments)
      .where(eq(shipments.id, alert.shipmentId))
      .get()

    let customer = null
    if (shipment?.customerId) {
      customer = await db
        .select()
        .from(customers)
        .where(eq(customers.id, shipment.customerId))
        .get()
    }

    enriched.push({
      ...alert,
      shipment: shipment
        ? {
            id: shipment.id,
            poNumbers: shipment.poNumbers,
            route: shipment.route,
            customer: customer ? { name: customer.name } : null,
          }
        : null,
    })
  }

  return c.json({ alerts: enriched })
})

// PATCH /alerts/:id/dismiss
alertsRouter.patch('/alerts/:id/dismiss', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')

  await db
    .update(alerts)
    .set({ status: 'DISMISSED', dismissedAt: new Date() })
    .where(eq(alerts.id, id))

  return c.json({ success: true })
})

// PATCH /alerts/:id/snooze
alertsRouter.patch('/alerts/:id/snooze', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')
  const body = await c.req.json()
  const hours = body.hours ?? 24

  const snoozedUntil = new Date(Date.now() + hours * 3600000)
  await db
    .update(alerts)
    .set({ status: 'SNOOZED', snoozedUntil })
    .where(eq(alerts.id, id))

  return c.json({ success: true })
})

// PATCH /alerts/:id/read - Mark alert as read (keeps it visible)
alertsRouter.patch('/alerts/:id/read', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')

  await db
    .update(alerts)
    .set({ readAt: new Date() })
    .where(eq(alerts.id, id))

  return c.json({ success: true })
})

// PATCH /alerts/:id/unread - Mark alert as unread
alertsRouter.patch('/alerts/:id/unread', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')

  await db
    .update(alerts)
    .set({ readAt: null })
    .where(eq(alerts.id, id))

  return c.json({ success: true })
})

// POST /alerts/evaluate - Re-evaluate all alert rules against all active shipments
alertsRouter.post('/alerts/evaluate', async (c) => {
  const db = c.get('db')

  try {
    const result = await evaluateAlerts(db)
    return c.json({
      success: true,
      ...result,
    })
  } catch (err) {
    console.error('Alert evaluation error:', err)
    return c.json(
      {
        error: 'Alert evaluation failed',
        detail: err instanceof Error ? err.message : String(err),
      },
      500
    )
  }
})

// POST /alerts/evaluate/:shipmentId - Evaluate alerts for a single shipment
alertsRouter.post('/alerts/evaluate/:shipmentId', async (c) => {
  const db = c.get('db')
  const shipmentId = c.req.param('shipmentId')

  try {
    const result = await evaluateAlertsForShipment(db, shipmentId)
    return c.json({
      success: true,
      shipmentId,
      created: result.created,
      resolved: result.resolved,
    })
  } catch (err) {
    console.error('Alert evaluation error:', err)
    return c.json(
      {
        error: 'Alert evaluation failed',
        detail: err instanceof Error ? err.message : String(err),
      },
      500
    )
  }
})

export default alertsRouter
