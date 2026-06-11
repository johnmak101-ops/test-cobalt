import { Hono } from 'hono'
import { eq, desc } from 'drizzle-orm'
import {
  shipments,
  customers,
  forwarders,
  vendors,
  shipmentMilestones,
  shippingEmails,
  alerts,
  shipmentHistory,
  shipmentPos,
  purchaseOrders,
} from '../db/schema.js'
import { trackShipmentUpdate } from '../services/history.js'
import crypto from 'node:crypto'

type Env = { Variables: { db: any } }

const shipmentsRouter = new Hono<Env>()

// GET /shipments - List all shipments with optional filters
shipmentsRouter.get('/shipments', async (c) => {
  const db = c.get('db')
  const status = c.req.query('status')
  const customerId = c.req.query('customerId')
  const forwarderId = c.req.query('forwarderId')

  let query = db.select().from(shipments).orderBy(desc(shipments.updatedAt))

  // Build conditions
  const conditions = []
  if (status) conditions.push(eq(shipments.status, status as any))
  if (customerId) conditions.push(eq(shipments.customerId, customerId))
  if (forwarderId) conditions.push(eq(shipments.forwarderId, forwarderId))

  let results
  if (conditions.length > 0) {
    const { and } = await import('drizzle-orm')
    results = await db
      .select()
      .from(shipments)
      .where(and(...conditions))
      .orderBy(desc(shipments.updatedAt))
  } else {
    results = await query
  }

  // Attach customer, forwarder, and vendor names
  const enriched = []
  for (const s of results) {
    const customer = s.customerId
      ? await db.select().from(customers).where(eq(customers.id, s.customerId)).get()
      : null
    const forwarder = s.forwarderId
      ? await db.select().from(forwarders).where(eq(forwarders.id, s.forwarderId)).get()
      : null
    const vendor = s.vendorId
      ? await db.select().from(vendors).where(eq(vendors.id, s.vendorId)).get()
      : null
    enriched.push({
      ...s,
      customer: customer ? { id: customer.id, name: customer.name, code: customer.code } : null,
      forwarder: forwarder ? { id: forwarder.id, name: forwarder.name } : null,
      vendor: vendor ? { id: vendor.id, name: vendor.name, code: vendor.code } : null,
    })
  }

  return c.json({ shipments: enriched })
})

// GET /shipments/:id - Single shipment with full detail
shipmentsRouter.get('/shipments/:id', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')

  const shipment = await db.select().from(shipments).where(eq(shipments.id, id)).get()
  if (!shipment) {
    return c.json({ error: 'Shipment not found' }, 404)
  }

  const customer = shipment.customerId
    ? await db.select().from(customers).where(eq(customers.id, shipment.customerId)).get()
    : null
  const forwarder = shipment.forwarderId
    ? await db.select().from(forwarders).where(eq(forwarders.id, shipment.forwarderId)).get()
    : null
  const vendor = shipment.vendorId
    ? await db.select().from(vendors).where(eq(vendors.id, shipment.vendorId)).get()
    : null

  const milestones = await db
    .select()
    .from(shipmentMilestones)
    .where(eq(shipmentMilestones.shipmentId, id))
    .orderBy(shipmentMilestones.occurredAt)

  const emails = await db
    .select()
    .from(shippingEmails)
    .where(eq(shippingEmails.shipmentId, id))
    .orderBy(desc(shippingEmails.receivedAt))

  const shipmentAlerts = await db
    .select()
    .from(alerts)
    .where(eq(alerts.shipmentId, id))
    .orderBy(desc(alerts.triggeredAt))

  return c.json({
    ...shipment,
    customer: customer ? { id: customer.id, name: customer.name, code: customer.code } : null,
    forwarder: forwarder ? { id: forwarder.id, name: forwarder.name } : null,
    vendor: vendor ? { id: vendor.id, name: vendor.name, code: vendor.code } : null,
    milestones,
    emails,
    alerts: shipmentAlerts,
  })
})

// POST /shipments - Create a new shipment
shipmentsRouter.post('/shipments', async (c) => {
  const db = c.get('db')
  const body = await c.req.json()

  const id = crypto.randomUUID()
  const now = new Date()

  await db.insert(shipments).values({
    id,
    poNumbers: JSON.stringify(body.poNumbers ?? []),
    customerId: body.customerId ?? null,
    vendorId: body.vendorId ?? null,
    forwarderId: body.forwarderId ?? null,
    route: body.route ?? null,
    status: body.status ?? 'BOOKED',
    riskLevel: body.riskLevel ?? 'ON_TRACK',
    bookingNo: body.bookingNo ?? null,
    soNumber: body.soNumber ?? null,
    itemStyleNo: body.itemStyleNo ?? null,
    consigneeName: body.consigneeName ?? null,
    consigneeAddress: body.consigneeAddress ?? null,
    containerNo: body.containerNo ?? null,
    mblNumber: body.mblNumber ?? null,
    crd: body.crd ? new Date(body.crd) : null,
    cfsCutoff: body.cfsCutoff ? new Date(body.cfsCutoff) : null,
    etd: body.etd ? new Date(body.etd) : null,
    eta: body.eta ? new Date(body.eta) : null,
    actualDeparture: body.actualDeparture ? new Date(body.actualDeparture) : null,
    actualArrival: body.actualArrival ? new Date(body.actualArrival) : null,
    warehouseStartDate: body.warehouseStartDate ? new Date(body.warehouseStartDate) : null,
    warehouseEndDate: body.warehouseEndDate ? new Date(body.warehouseEndDate) : null,
    inDcDate: body.inDcDate ? new Date(body.inDcDate) : null,
    hblNumber: body.hblNumber ?? null,
    vesselName: body.vesselName ?? null,
    voyageNumber: body.voyageNumber ?? null,
    warehouseAddress: body.warehouseAddress ?? null,
    quantityShipped: body.quantityShipped ?? null,
    quantityUnit: body.quantityUnit ?? null,
    createdAt: now,
    updatedAt: now,
  })

  // Create initial milestone
  await db.insert(shipmentMilestones).values({
    id: crypto.randomUUID(),
    shipmentId: id,
    milestoneType: 'BOOKING_SENT',
    occurredAt: now,
    createdAt: now,
  })

  const created = await db.select().from(shipments).where(eq(shipments.id, id)).get()
  return c.json(created, 201)
})

// PATCH /shipments/:id - Update a shipment (with audit trail)
shipmentsRouter.patch('/shipments/:id', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')
  const body = await c.req.json()

  const existing = await db.select().from(shipments).where(eq(shipments.id, id)).get()
  if (!existing) {
    return c.json({ error: 'Shipment not found' }, 404)
  }

  const updates: Record<string, any> = {}
  if (body.status !== undefined) updates.status = body.status
  if (body.riskLevel !== undefined) updates.riskLevel = body.riskLevel
  if (body.poNumbers !== undefined) updates.poNumbers = JSON.stringify(body.poNumbers)
  if (body.customerId !== undefined) updates.customerId = body.customerId
  if (body.vendorId !== undefined) updates.vendorId = body.vendorId
  if (body.forwarderId !== undefined) updates.forwarderId = body.forwarderId
  if (body.route !== undefined) updates.route = body.route
  if (body.bookingNo !== undefined) updates.bookingNo = body.bookingNo
  if (body.soNumber !== undefined) updates.soNumber = body.soNumber
  if (body.itemStyleNo !== undefined) updates.itemStyleNo = body.itemStyleNo
  if (body.consigneeName !== undefined) updates.consigneeName = body.consigneeName
  if (body.consigneeAddress !== undefined) updates.consigneeAddress = body.consigneeAddress
  if (body.containerNo !== undefined) updates.containerNo = body.containerNo
  if (body.mblNumber !== undefined) updates.mblNumber = body.mblNumber
  if (body.crd !== undefined) updates.crd = body.crd ? new Date(body.crd) : null
  if (body.cfsCutoff !== undefined) updates.cfsCutoff = body.cfsCutoff ? new Date(body.cfsCutoff) : null
  if (body.etd !== undefined) updates.etd = body.etd ? new Date(body.etd) : null
  if (body.eta !== undefined) updates.eta = body.eta ? new Date(body.eta) : null
  if (body.actualDeparture !== undefined) updates.actualDeparture = body.actualDeparture ? new Date(body.actualDeparture) : null
  if (body.actualArrival !== undefined) updates.actualArrival = body.actualArrival ? new Date(body.actualArrival) : null
  if (body.warehouseStartDate !== undefined) updates.warehouseStartDate = body.warehouseStartDate ? new Date(body.warehouseStartDate) : null
  if (body.warehouseEndDate !== undefined) updates.warehouseEndDate = body.warehouseEndDate ? new Date(body.warehouseEndDate) : null
  if (body.inDcDate !== undefined) updates.inDcDate = body.inDcDate ? new Date(body.inDcDate) : null
  if (body.hblNumber !== undefined) updates.hblNumber = body.hblNumber
  if (body.vesselName !== undefined) updates.vesselName = body.vesselName
  if (body.voyageNumber !== undefined) updates.voyageNumber = body.voyageNumber
  if (body.warehouseAddress !== undefined) updates.warehouseAddress = body.warehouseAddress
  if (body.quantityShipped !== undefined) updates.quantityShipped = body.quantityShipped
  if (body.quantityUnit !== undefined) updates.quantityUnit = body.quantityUnit

  // Use trackShipmentUpdate for audit trail on tracked fields
  const trackResult = await trackShipmentUpdate(db, id, updates, {
    sourceType: 'manual',
    changedBy: body.changedBy ?? null,
    notes: body.changeNotes ?? null,
  })

  const updated = await db.select().from(shipments).where(eq(shipments.id, id)).get()
  return c.json({
    ...updated,
    _audit: {
      fieldsChanged: trackResult.fieldsChanged,
      delaysDetected: trackResult.delaysDetected,
      changes: trackResult.changes,
    },
  })
})

// GET /shipments/:id/history - Get audit trail for a shipment
shipmentsRouter.get('/shipments/:id/history', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')

  // Verify shipment exists
  const shipment = await db.select().from(shipments).where(eq(shipments.id, id)).get()
  if (!shipment) {
    return c.json({ error: 'Shipment not found' }, 404)
  }

  const history = await db
    .select()
    .from(shipmentHistory)
    .where(eq(shipmentHistory.shipmentId, id))
    .orderBy(desc(shipmentHistory.changedAt))

  return c.json({ history })
})

// GET /shipments/:id/purchase-orders - Get POs linked to a shipment
shipmentsRouter.get('/shipments/:id/purchase-orders', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')

  const links = await db
    .select()
    .from(shipmentPos)
    .where(eq(shipmentPos.shipmentId, id))

  const pos = []
  for (const link of links) {
    const po = await db
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, link.poId))
      .get()
    if (po) {
      pos.push({
        ...po,
        linkId: link.id,
        linkedQuantity: link.quantity,
        linkedAt: link.createdAt,
      })
    }
  }

  return c.json({ purchaseOrders: pos })
})

export default shipmentsRouter
