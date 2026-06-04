import { Hono } from 'hono'
import { eq, desc, and, inArray, isNull, sql } from 'drizzle-orm'
import { shippingEmails, shipments, users } from '../db/schema.js'
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
// Returns: emails with NEEDS_REVIEW or FLAGGED status, ordered by received date
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
    // Default: show NEEDS_REVIEW and FLAGGED
    results = await db
      .select()
      .from(shippingEmails)
      .where(
        inArray(shippingEmails.reviewStatus, ['NEEDS_REVIEW', 'FLAGGED'])
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
    'FLAGGED',
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

  counts.total = Object.values(counts).reduce((a, b) => a + b, 0)
  counts.pending = (counts.NEEDS_REVIEW ?? 0) + (counts.FLAGGED ?? 0)

  return c.json(counts)
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

      // If corrections include shipment field updates, track them
      if (body.corrections?.shipmentUpdates && email.shipmentId) {
        await trackShipmentUpdate(
          db,
          body.corrections.shipmentId ?? email.shipmentId,
          body.corrections.shipmentUpdates,
          {
            sourceType: 'manual',
            sourceId: id,
            changedBy: body.reviewedBy,
            notes: `Manual correction during email review`,
          }
        )
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

export default emailsRouter
