import { Hono } from 'hono'
import { eq, desc, and, inArray, isNull, sql } from 'drizzle-orm'
import { shippingEmails, shipments, users, emailAttachments, purchaseOrders, shipmentPos, customers, forwarders } from '../db/schema.js'
import { processEmail } from '../services/pipeline.js'
import { trackShipmentUpdate } from '../services/history.js'
import crypto from 'node:crypto'

type Env = { Variables: { db: any } }

const emailsRouter = new Hono<Env>()

// GET /emails - List all emails
emailsRouter.get('/emails', async (c) => {
  const db = c.get('db')
  const results = await db
    .select()
    .from(shippingEmails)
    .orderBy(desc(shippingEmails.receivedAt))
    .limit(100)

  return c.json({ emails: results })
})

// GET /emails/review-queue - Get emails needing review
// Returns: emails with NEEDS_REVIEW status, ordered by received date
// NOTE: Must be registered BEFORE /emails/:id to avoid :id capturing "review-queue"
emailsRouter.get('/emails/review-queue', async (c) => {
  const db = c.get('db')
  const status = c.req.query('status') // Optional: filter by specific review status

  let results
  if (status) {
    results = await db
      .select()
      .from(shippingEmails)
      .where(eq(shippingEmails.reviewStatus, status as any))
      .orderBy(desc(shippingEmails.receivedAt))
      .limit(100)
  } else {
    // Default: show NEEDS_REVIEW (pending review queue)
    results = await db
      .select()
      .from(shippingEmails)
      .where(
        eq(shippingEmails.reviewStatus, 'NEEDS_REVIEW')
      )
      .orderBy(desc(shippingEmails.receivedAt))
      .limit(100)
  }

  // Enrich with shipment info for matched emails
  const enriched = []
  for (const email of results) {
    let shipment = null
    if (email.shipmentId) {
      shipment = await db
        .select()
        .from(shipments)
        .where(eq(shipments.id, email.shipmentId))
        .get()
    }
    enriched.push({
      ...email,
      shipment: shipment
        ? {
            id: shipment.id,
            poNumbers: shipment.poNumbers,
            status: shipment.status,
            route: shipment.route,
          }
        : null,
    })
  }

  return c.json({ emails: enriched })
})

// GET /emails/review-queue/counts - Get counts by review status
emailsRouter.get('/emails/review-queue/counts', async (c) => {
  const db = c.get('db')

  const statuses = [
    'NEEDS_REVIEW',
    'AUTO_ACCEPTED',
    'REVIEWED_OK',
    'REVIEWED_CORRECTED',
    'REJECTED',
  ]

  const counts: Record<string, number> = {}
  for (const status of statuses) {
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(shippingEmails)
      .where(eq(shippingEmails.reviewStatus, status as any))
      .get()
    counts[status] = result?.count ?? 0
  }

  counts.pending = counts.NEEDS_REVIEW ?? 0

  return c.json(counts)
})

// GET /emails/unread-count - Count of unread emails
emailsRouter.get('/emails/unread-count', async (c) => {
  const db = c.get('db')
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(shippingEmails)
    .where(eq(shippingEmails.isRead, false))
    .get()
  return c.json({ unread: result?.count ?? 0 })
})

// PATCH /emails/:id/read - Mark email as read
emailsRouter.patch('/emails/:id/read', async (c) => {
  const db = c.get('db')
  const { id } = c.req.param()
  await db
    .update(shippingEmails)
    .set({ isRead: true })
    .where(eq(shippingEmails.id, id))
  return c.json({ ok: true })
})

// GET /emails/:id - Single email
emailsRouter.get('/emails/:id', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')
  const email = await db.select().from(shippingEmails).where(eq(shippingEmails.id, id)).get()
  if (!email) return c.json({ error: 'Email not found' }, 404)
  return c.json(email)
})

// POST /emails - Manually ingest an email (for testing the pipeline)
emailsRouter.post('/emails', async (c) => {
  const db = c.get('db')
  const body = await c.req.json()

  const id = crypto.randomUUID()

  await db.insert(shippingEmails).values({
    id,
    messageId: body.messageId ?? null,
    subject: body.subject,
    sender: body.sender,
    receivedAt: body.receivedAt ? new Date(body.receivedAt) : new Date(),
    bodyText: body.bodyText ?? null,
    bodyHtml: body.bodyHtml ?? null,
    emailType: body.emailType ?? 'OTHER',
    extractedData: body.extractedData ? JSON.stringify(body.extractedData) : null,
    extractionConfidence: body.extractionConfidence ?? null,
    shipmentId: body.shipmentId ?? null,
    isMatched: body.isMatched ?? false,
    processingStatus: 'PENDING',
  })

  const created = await db.select().from(shippingEmails).where(eq(shippingEmails.id, id)).get()
  return c.json(created, 201)
})

// POST /emails/process - Process a raw email through the AI pipeline
// Accepts: { subject, sender, bodyText, bodyHtml?, receivedAt?, messageId?, useAI? }
// Returns: PipelineResult with classification, extraction, matching, and alert info
emailsRouter.post('/emails/process', async (c) => {
  const db = c.get('db')
  const body = await c.req.json()

  // Validate required fields
  if (!body.subject || !body.sender || !body.bodyText) {
    return c.json(
      { error: 'Missing required fields: subject, sender, bodyText' },
      400
    )
  }

  try {
    const result = await processEmail(
      db,
      {
        subject: body.subject,
        sender: body.sender,
        bodyText: body.bodyText,
        bodyHtml: body.bodyHtml,
        receivedAt: body.receivedAt ? new Date(body.receivedAt) : new Date(),
        messageId: body.messageId,
      },
      { useAI: body.useAI }
    )

    return c.json(result, 201)
  } catch (err) {
    console.error('Pipeline error:', err)
    return c.json(
      {
        error: 'Pipeline processing failed',
        detail: err instanceof Error ? err.message : String(err),
      },
      500
    )
  }
})

// POST /emails/process-batch - Process multiple emails through the pipeline
emailsRouter.post('/emails/process-batch', async (c) => {
  const db = c.get('db')
  const body = await c.req.json()

  if (!Array.isArray(body.emails) || body.emails.length === 0) {
    return c.json({ error: 'Expected { emails: [...] } array' }, 400)
  }

  if (body.emails.length > 50) {
    return c.json({ error: 'Maximum 50 emails per batch' }, 400)
  }

  const results = []
  for (const email of body.emails) {
    if (!email.subject || !email.sender || !email.bodyText) {
      results.push({
        error: 'Missing required fields',
        subject: email.subject ?? '(missing)',
      })
      continue
    }

    try {
      const result = await processEmail(
        db,
        {
          subject: email.subject,
          sender: email.sender,
          bodyText: email.bodyText,
          bodyHtml: email.bodyHtml,
          receivedAt: email.receivedAt ? new Date(email.receivedAt) : new Date(),
          messageId: email.messageId,
        },
        { useAI: body.useAI }
      )
      results.push(result)
    } catch (err) {
      results.push({
        error: err instanceof Error ? err.message : String(err),
        subject: email.subject,
      })
    }
  }

  const succeeded = results.filter((r: any) => !r.error).length
  const failed = results.filter((r: any) => r.error).length

  return c.json({ results, summary: { total: body.emails.length, succeeded, failed } })
})

// PATCH /emails/:id/review - Review an email (approve, correct, or reject)
// Body: { action: 'approve' | 'correct' | 'reject', reviewedBy: string, notes?: string, corrections?: { extractedData?, shipmentId?, emailType? } }
emailsRouter.patch('/emails/:id/review', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')
  const body = await c.req.json()

  const email = await db
    .select()
    .from(shippingEmails)
    .where(eq(shippingEmails.id, id))
    .get()

  if (!email) {
    return c.json({ error: 'Email not found' }, 404)
  }

  if (!body.action || !body.reviewedBy) {
    return c.json({ error: 'Missing required fields: action, reviewedBy' }, 400)
  }

  const now = new Date()
  const updates: Record<string, any> = {
    reviewedBy: body.reviewedBy,
    reviewedAt: now,
    reviewNotes: body.notes ?? null,
  }

  switch (body.action) {
    case 'approve':
      updates.reviewStatus = 'REVIEWED_OK'
      break

    case 'correct':
      updates.reviewStatus = 'REVIEWED_CORRECTED'
      // Apply corrections to the email record
      if (body.corrections) {
        if (body.corrections.extractedData) {
          // Preserve original extracted data before overwriting
          if (email.extractedData && !email.originalExtractedData) {
            updates.originalExtractedData = email.extractedData
          }
          updates.extractedData = JSON.stringify(body.corrections.extractedData)
        }
        if (body.corrections.emailType) {
          updates.emailType = body.corrections.emailType
        }
        if (body.corrections.shipmentId !== undefined) {
          updates.shipmentId = body.corrections.shipmentId
          updates.isMatched = body.corrections.shipmentId ? true : false
        }
      }

      // ── Propagate corrected extracted data to linked shipment ──
      if (body.corrections?.extractedData && email.shipmentId) {
        const ext = body.corrections.extractedData as Record<string, any>

        // Map extraction fields → shipment columns
        const shipmentUpdates: Record<string, any> = {}
        const dateFields: Record<string, string> = {
          etd: 'etd',
          eta: 'eta',
          crd: 'crd',
          cfs_cutoff: 'cfsCutoff',
          warehouse_start_date: 'warehouseStartDate',
          warehouse_end_date: 'warehouseEndDate',
          in_dc_date: 'inDcDate',
        }
        const textFields: Record<string, string> = {
          vessel: 'vesselName',
          voyage_number: 'voyageNumber',
          hbl_number: 'hblNumber',
          mbl_number: 'mblNumber',
          container_no: 'containerNo',
          booking_no: 'bookingNo',
          so_number: 'soNumber',
          item_style_no: 'itemStyleNo',
          consignee_name: 'consigneeName',
          consignee_address: 'consigneeAddress',
          warehouse_address: 'warehouseAddress',
          route: 'route',
        }
        const quantityFields: Record<string, string> = {
          quantity: 'quantityShipped',
          quantity_unit: 'quantityUnit',
        }

        for (const [extKey, shipCol] of Object.entries(dateFields)) {
          if (ext[extKey] !== undefined) {
            shipmentUpdates[shipCol] = ext[extKey] ? new Date(ext[extKey]) : null
          }
        }
        for (const [extKey, shipCol] of Object.entries(textFields)) {
          if (ext[extKey] !== undefined) {
            shipmentUpdates[shipCol] = ext[extKey] || null
          }
        }
        for (const [extKey, shipCol] of Object.entries(quantityFields)) {
          if (ext[extKey] !== undefined) {
            shipmentUpdates[shipCol] = ext[extKey] ?? null
          }
        }

        // Update PO numbers on the shipment record
        if (ext.po_numbers !== undefined) {
          const poArray = Array.isArray(ext.po_numbers) ? ext.po_numbers : [ext.po_numbers]
          const poStr = poArray.filter(Boolean)
          if (poStr.length > 0) {
            shipmentUpdates.poNumbers = JSON.stringify(poStr)
          }
        }

        // Apply shipment updates with audit trail
        if (Object.keys(shipmentUpdates).length > 0) {
          await trackShipmentUpdate(db, email.shipmentId, shipmentUpdates, {
            sourceType: 'manual',
            sourceId: id,
            changedBy: body.reviewedBy,
            notes: body.notes ?? 'Manual correction during email review',
          })
        }

        // ── Sync PO records and links ──
        if (ext.po_numbers !== undefined) {
          const poArray = (Array.isArray(ext.po_numbers) ? ext.po_numbers : [ext.po_numbers]).filter(Boolean) as string[]

          // Look up customer from shipment for PO creation
          const currentShipment = await db.select().from(shipments).where(eq(shipments.id, email.shipmentId)).get()

          for (const poNum of poArray) {
            // Find or create PO record
            let po = await db.select().from(purchaseOrders).where(eq(purchaseOrders.poNumber, poNum)).get()
            if (!po) {
              const poId = `po-corr-${crypto.randomUUID().slice(0, 8)}`
              await db.insert(purchaseOrders).values({
                id: poId,
                poNumber: poNum,
                customerId: currentShipment?.customerId ?? null,
                vendorId: currentShipment?.vendorId ?? null,
                totalQuantity: ext.quantity ?? null,
                quantityUnit: ext.quantity_unit ?? null,
                notes: `Created from email correction (${id})`,
                createdAt: now,
                updatedAt: now,
              })
              po = { id: poId }
            }

            // Ensure shipment↔PO link exists
            const existingLink = await db
              .select()
              .from(shipmentPos)
              .where(and(eq(shipmentPos.shipmentId, email.shipmentId), eq(shipmentPos.poId, po.id)))
              .get()

            if (!existingLink) {
              await db.insert(shipmentPos).values({
                id: `sp-corr-${crypto.randomUUID().slice(0, 8)}`,
                shipmentId: email.shipmentId,
                poId: po.id,
                quantity: ext.quantity ?? null,
                createdAt: now,
              })
            }
          }
        }

        // ── Sync customer name if changed ──
        if (ext.customer) {
          const currentShipment = await db.select().from(shipments).where(eq(shipments.id, email.shipmentId)).get()
          if (currentShipment?.customerId) {
            await db.update(customers)
              .set({ name: ext.customer })
              .where(eq(customers.id, currentShipment.customerId))
          }
        }

        // ── Sync forwarder name if changed ──
        if (ext.forwarder) {
          const currentShipment = await db.select().from(shipments).where(eq(shipments.id, email.shipmentId)).get()
          if (currentShipment?.forwarderId) {
            await db.update(forwarders)
              .set({ name: ext.forwarder })
              .where(eq(forwarders.id, currentShipment.forwarderId))
          }
        }
      }
      break

    case 'reject':
      updates.reviewStatus = 'REJECTED'
      // Unlink from shipment if linked
      if (email.shipmentId) {
        updates.shipmentId = null
        updates.isMatched = false
      }
      break

    default:
      return c.json(
        { error: 'Invalid action. Expected: approve, correct, or reject' },
        400
      )
  }

  await db.update(shippingEmails).set(updates).where(eq(shippingEmails.id, id))
  const updated = await db
    .select()
    .from(shippingEmails)
    .where(eq(shippingEmails.id, id))
    .get()

  return c.json(updated)
})

// GET /emails/:id/attachments - List attachments for an email
emailsRouter.get('/emails/:id/attachments', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')

  const email = await db.select().from(shippingEmails).where(eq(shippingEmails.id, id)).get()
  if (!email) return c.json({ error: 'Email not found' }, 404)

  const attachments = await db
    .select()
    .from(emailAttachments)
    .where(eq(emailAttachments.emailId, id))

  // Return metadata only (omit content blob from listing)
  const result = attachments.map((a: any) => ({
    id: a.id,
    emailId: a.emailId,
    filename: a.filename,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    createdAt: a.createdAt,
  }))

  return c.json({ attachments: result })
})

// GET /attachments/:id/download - Download attachment content
emailsRouter.get('/attachments/:id/download', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')

  const attachment = await db
    .select()
    .from(emailAttachments)
    .where(eq(emailAttachments.id, id))
    .get()

  if (!attachment) return c.json({ error: 'Attachment not found' }, 404)

  if (!attachment.content) {
    // No file content stored (mock data) — return a placeholder response
    return c.json({
      id: attachment.id,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      message: 'File content not available — mock attachment (no base64 stored)',
    })
  }

  // Decode base64 content and return as binary
  const buffer = Buffer.from(attachment.content, 'base64')
  return new Response(buffer, {
    headers: {
      'Content-Type': attachment.mimeType,
      'Content-Disposition': `attachment; filename="${attachment.filename}"`,
      'Content-Length': String(buffer.byteLength),
    },
  })
})

export default emailsRouter
