import { Hono } from 'hono'
import { eq, desc } from 'drizzle-orm'
import {
  purchaseOrders,
  shipmentPos,
  shipments,
  customers,
  vendors,
} from '../db/schema.js'
import crypto from 'node:crypto'

type Env = { Variables: { db: any } }

const purchaseOrdersRouter = new Hono<Env>()

// GET /purchase-orders - List all POs with customer/vendor names and shipment counts
purchaseOrdersRouter.get('/purchase-orders', async (c) => {
  const db = c.get('db')
  const customerId = c.req.query('customerId')

  let results
  if (customerId) {
    results = await db
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.customerId, customerId))
      .orderBy(desc(purchaseOrders.updatedAt))
  } else {
    results = await db
      .select()
      .from(purchaseOrders)
      .orderBy(desc(purchaseOrders.updatedAt))
  }

  // Enrich with customer/vendor names and shipment progress
  const enriched = []
  for (const po of results) {
    const customer = po.customerId
      ? await db.select().from(customers).where(eq(customers.id, po.customerId)).get()
      : null
    const vendor = po.vendorId
      ? await db.select().from(vendors).where(eq(vendors.id, po.vendorId)).get()
      : null

    // Get linked shipments with quantities
    const links = await db
      .select()
      .from(shipmentPos)
      .where(eq(shipmentPos.poId, po.id))

    const shippedQuantity = links.reduce(
      (sum: number, link: any) => sum + (link.quantity ?? 0),
      0
    )

    enriched.push({
      ...po,
      customer: customer ? { id: customer.id, name: customer.name, code: customer.code } : null,
      vendor: vendor ? { id: vendor.id, name: vendor.name } : null,
      shipmentCount: links.length,
      shippedQuantity,
    })
  }

  return c.json({ purchaseOrders: enriched })
})

// GET /purchase-orders/:id - Single PO with full detail + linked shipments
purchaseOrdersRouter.get('/purchase-orders/:id', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')

  const po = await db
    .select()
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, id))
    .get()

  if (!po) {
    return c.json({ error: 'Purchase order not found' }, 404)
  }

  const customer = po.customerId
    ? await db.select().from(customers).where(eq(customers.id, po.customerId)).get()
    : null
  const vendor = po.vendorId
    ? await db.select().from(vendors).where(eq(vendors.id, po.vendorId)).get()
    : null

  // Get linked shipments with quantities
  const links = await db
    .select()
    .from(shipmentPos)
    .where(eq(shipmentPos.poId, id))

  const linkedShipments = []
  for (const link of links) {
    const shipment = await db
      .select()
      .from(shipments)
      .where(eq(shipments.id, link.shipmentId))
      .get()
    if (shipment) {
      linkedShipments.push({
        ...shipment,
        linkId: link.id,
        linkedQuantity: link.quantity,
        linkedAt: link.createdAt,
      })
    }
  }

  const shippedQuantity = links.reduce(
    (sum: number, link: any) => sum + (link.quantity ?? 0),
    0
  )

  return c.json({
    ...po,
    customer: customer ? { id: customer.id, name: customer.name, code: customer.code } : null,
    vendor: vendor ? { id: vendor.id, name: vendor.name } : null,
    linkedShipments,
    shippedQuantity,
  })
})

// POST /purchase-orders - Create a new PO
purchaseOrdersRouter.post('/purchase-orders', async (c) => {
  const db = c.get('db')
  const body = await c.req.json()

  if (!body.poNumber) {
    return c.json({ error: 'Missing required field: poNumber' }, 400)
  }

  const id = crypto.randomUUID()
  const now = new Date()

  try {
    await db.insert(purchaseOrders).values({
      id,
      poNumber: body.poNumber,
      customerId: body.customerId ?? null,
      vendorId: body.vendorId ?? null,
      totalQuantity: body.totalQuantity ?? null,
      quantityUnit: body.quantityUnit ?? null,
      notes: body.notes ?? null,
      createdAt: now,
      updatedAt: now,
    })
  } catch (err: any) {
    if (err.message?.includes('UNIQUE')) {
      return c.json({ error: `PO number "${body.poNumber}" already exists` }, 409)
    }
    throw err
  }

  const created = await db
    .select()
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, id))
    .get()

  return c.json(created, 201)
})

// PATCH /purchase-orders/:id - Update a PO
purchaseOrdersRouter.patch('/purchase-orders/:id', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')
  const body = await c.req.json()

  const existing = await db
    .select()
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, id))
    .get()

  if (!existing) {
    return c.json({ error: 'Purchase order not found' }, 404)
  }

  const updates: Record<string, any> = { updatedAt: new Date() }
  if (body.poNumber !== undefined) updates.poNumber = body.poNumber
  if (body.customerId !== undefined) updates.customerId = body.customerId
  if (body.vendorId !== undefined) updates.vendorId = body.vendorId
  if (body.totalQuantity !== undefined) updates.totalQuantity = body.totalQuantity
  if (body.quantityUnit !== undefined) updates.quantityUnit = body.quantityUnit
  if (body.notes !== undefined) updates.notes = body.notes

  await db.update(purchaseOrders).set(updates).where(eq(purchaseOrders.id, id))
  const updated = await db
    .select()
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, id))
    .get()

  return c.json(updated)
})

// DELETE /purchase-orders/:id - Delete a PO (and its links)
purchaseOrdersRouter.delete('/purchase-orders/:id', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')

  const existing = await db
    .select()
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, id))
    .get()

  if (!existing) {
    return c.json({ error: 'Purchase order not found' }, 404)
  }

  // Delete links first (foreign key)
  await db.delete(shipmentPos).where(eq(shipmentPos.poId, id))
  await db.delete(purchaseOrders).where(eq(purchaseOrders.id, id))

  return c.json({ success: true })
})

// POST /purchase-orders/:id/link-shipment - Link a shipment to this PO
purchaseOrdersRouter.post('/purchase-orders/:id/link-shipment', async (c) => {
  const db = c.get('db')
  const poId = c.req.param('id')
  const body = await c.req.json()

  if (!body.shipmentId) {
    return c.json({ error: 'Missing required field: shipmentId' }, 400)
  }

  // Verify PO exists
  const po = await db
    .select()
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, poId))
    .get()
  if (!po) {
    return c.json({ error: 'Purchase order not found' }, 404)
  }

  // Verify shipment exists
  const shipment = await db
    .select()
    .from(shipments)
    .where(eq(shipments.id, body.shipmentId))
    .get()
  if (!shipment) {
    return c.json({ error: 'Shipment not found' }, 404)
  }

  const linkId = crypto.randomUUID()
  await db.insert(shipmentPos).values({
    id: linkId,
    shipmentId: body.shipmentId,
    poId,
    quantity: body.quantity ?? null,
    createdAt: new Date(),
  })

  const link = await db
    .select()
    .from(shipmentPos)
    .where(eq(shipmentPos.id, linkId))
    .get()

  return c.json(link, 201)
})

// DELETE /purchase-orders/:poId/link-shipment/:linkId - Unlink a shipment from PO
purchaseOrdersRouter.delete(
  '/purchase-orders/:poId/link-shipment/:linkId',
  async (c) => {
    const db = c.get('db')
    const linkId = c.req.param('linkId')

    const link = await db
      .select()
      .from(shipmentPos)
      .where(eq(shipmentPos.id, linkId))
      .get()

    if (!link) {
      return c.json({ error: 'Link not found' }, 404)
    }

    await db.delete(shipmentPos).where(eq(shipmentPos.id, linkId))
    return c.json({ success: true })
  }
)

export default purchaseOrdersRouter
