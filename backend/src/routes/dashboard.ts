import { Hono } from 'hono'
import { eq, desc, sql, and, or, ne } from 'drizzle-orm'
import { shipments, customers, forwarders, alerts, shippingEmails } from '../db/schema.js'

type Env = { Variables: { db: any } }

const dashboard = new Hono<Env>()

dashboard.get('/dashboard', async (c) => {
  const db = c.get('db')

  // Count active shipments (not DELIVERED)
  const allShipments = await db
    .select()
    .from(shipments)
    .where(ne(shipments.status, 'DELIVERED'))

  const activeShipments = allShipments.length
  const atRiskShipments = allShipments.filter(
    (s: any) => s.riskLevel === 'AT_RISK' || s.riskLevel === 'DELAYED'
  ).length

  // Count critical alerts
  const activeAlerts = await db
    .select()
    .from(alerts)
    .where(eq(alerts.status, 'ACTIVE'))

  const criticalAlerts = activeAlerts.filter((a: any) => a.severity === 'CRITICAL').length

  // Count new emails (last 24h)
  const oneDayAgo = new Date(Date.now() - 86400000)
  const newEmails = await db
    .select()
    .from(shippingEmails)
    .where(sql`${shippingEmails.receivedAt} > ${Math.floor(oneDayAgo.getTime() / 1000)}`)

  // Recent alerts with shipment info
  const recentAlerts = []
  for (const alert of activeAlerts.slice(0, 10)) {
    const shipment = await db.select().from(shipments).where(eq(shipments.id, alert.shipmentId)).get()
    let customer = null
    if (shipment?.customerId) {
      customer = await db.select().from(customers).where(eq(customers.id, shipment.customerId)).get()
    }
    recentAlerts.push({
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

  // Recent activity - shipments ordered by updatedAt
  const recentShipments = await db
    .select()
    .from(shipments)
    .orderBy(desc(shipments.updatedAt))
    .limit(10)

  const recentActivity = []
  for (const s of recentShipments) {
    const customer = s.customerId
      ? await db.select().from(customers).where(eq(customers.id, s.customerId)).get()
      : null
    const forwarder = s.forwarderId
      ? await db.select().from(forwarders).where(eq(forwarders.id, s.forwarderId)).get()
      : null
    recentActivity.push({
      ...s,
      customer: customer ? { name: customer.name } : null,
      forwarder: forwarder ? { name: forwarder.name } : null,
    })
  }

  return c.json({
    stats: {
      activeShipments,
      atRiskShipments,
      criticalAlerts,
      newEmails: newEmails.length,
    },
    recentAlerts,
    recentActivity,
  })
})

export default dashboard
