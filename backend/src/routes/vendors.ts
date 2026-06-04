import { Hono } from 'hono'
import { eq, desc } from 'drizzle-orm'
import { vendors } from '../db/schema.js'
import crypto from 'node:crypto'

type Env = { Variables: { db: any } }

const vendorsRouter = new Hono<Env>()

// GET /vendors - List all vendors
vendorsRouter.get('/vendors', async (c) => {
  const db = c.get('db')
  const type = c.req.query('type')

  let results
  if (type) {
    results = await db
      .select()
      .from(vendors)
      .where(eq(vendors.type, type as any))
      .orderBy(desc(vendors.updatedAt))
  } else {
    results = await db
      .select()
      .from(vendors)
      .orderBy(desc(vendors.updatedAt))
  }

  return c.json({ vendors: results })
})

// GET /vendors/:id - Single vendor
vendorsRouter.get('/vendors/:id', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')
  const vendor = await db.select().from(vendors).where(eq(vendors.id, id)).get()
  if (!vendor) return c.json({ error: 'Vendor not found' }, 404)
  return c.json(vendor)
})

// POST /vendors - Create a new vendor
vendorsRouter.post('/vendors', async (c) => {
  const db = c.get('db')
  const body = await c.req.json()

  if (!body.name) {
    return c.json({ error: 'Missing required field: name' }, 400)
  }

  const id = crypto.randomUUID()
  const now = new Date()

  await db.insert(vendors).values({
    id,
    name: body.name,
    type: body.type ?? 'factory',
    location: body.location ?? null,
    contactEmail: body.contactEmail ?? null,
    contactPhone: body.contactPhone ?? null,
    notes: body.notes ?? null,
    createdAt: now,
    updatedAt: now,
  })

  const created = await db.select().from(vendors).where(eq(vendors.id, id)).get()
  return c.json(created, 201)
})

// PATCH /vendors/:id - Update a vendor
vendorsRouter.patch('/vendors/:id', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')
  const body = await c.req.json()

  const existing = await db.select().from(vendors).where(eq(vendors.id, id)).get()
  if (!existing) {
    return c.json({ error: 'Vendor not found' }, 404)
  }

  const updates: Record<string, any> = { updatedAt: new Date() }
  if (body.name !== undefined) updates.name = body.name
  if (body.type !== undefined) updates.type = body.type
  if (body.location !== undefined) updates.location = body.location
  if (body.contactEmail !== undefined) updates.contactEmail = body.contactEmail
  if (body.contactPhone !== undefined) updates.contactPhone = body.contactPhone
  if (body.notes !== undefined) updates.notes = body.notes

  await db.update(vendors).set(updates).where(eq(vendors.id, id))
  const updated = await db.select().from(vendors).where(eq(vendors.id, id)).get()
  return c.json(updated)
})

// DELETE /vendors/:id - Delete a vendor
vendorsRouter.delete('/vendors/:id', async (c) => {
  const db = c.get('db')
  const id = c.req.param('id')

  const existing = await db.select().from(vendors).where(eq(vendors.id, id)).get()
  if (!existing) {
    return c.json({ error: 'Vendor not found' }, 404)
  }

  await db.delete(vendors).where(eq(vendors.id, id))
  return c.json({ success: true })
})

// POST /vendors/import-csv - Import vendors from CSV text
// Expects: { csv: "name,type,location,contactEmail,contactPhone,notes\n..." }
// CSV columns: name (required), type, location, contactEmail, contactPhone, notes
vendorsRouter.post('/vendors/import-csv', async (c) => {
  const db = c.get('db')
  const body = await c.req.json()

  if (!body.csv || typeof body.csv !== 'string') {
    return c.json({ error: 'Missing required field: csv (string)' }, 400)
  }

  const lines = body.csv.trim().split('\n')
  if (lines.length < 2) {
    return c.json({ error: 'CSV must have a header row and at least one data row' }, 400)
  }

  // Parse header
  const header = lines[0].split(',').map((h: string) => h.trim().toLowerCase())
  const nameIdx = header.indexOf('name')
  if (nameIdx === -1) {
    return c.json({ error: 'CSV must have a "name" column' }, 400)
  }

  const typeIdx = header.indexOf('type')
  const locationIdx = header.indexOf('location')
  const emailIdx = header.findIndex((h: string) =>
    h === 'contactemail' || h === 'contact_email' || h === 'email'
  )
  const phoneIdx = header.findIndex((h: string) =>
    h === 'contactphone' || h === 'contact_phone' || h === 'phone'
  )
  const notesIdx = header.indexOf('notes')

  const imported: any[] = []
  const errors: Array<{ line: number; error: string }> = []

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    // Simple CSV parse (no quoted fields with commas)
    const cols = line.split(',').map((c: string) => c.trim())

    const name = cols[nameIdx]
    if (!name) {
      errors.push({ line: i + 1, error: 'Missing name' })
      continue
    }

    const rawType = typeIdx >= 0 ? cols[typeIdx] : ''
    const vendorType =
      rawType === 'factory' || rawType === 'subcontractor' || rawType === 'agent'
        ? rawType
        : 'factory'

    const id = crypto.randomUUID()
    const now = new Date()

    try {
      await db.insert(vendors).values({
        id,
        name,
        type: vendorType,
        location: locationIdx >= 0 ? cols[locationIdx] || null : null,
        contactEmail: emailIdx >= 0 ? cols[emailIdx] || null : null,
        contactPhone: phoneIdx >= 0 ? cols[phoneIdx] || null : null,
        notes: notesIdx >= 0 ? cols[notesIdx] || null : null,
        createdAt: now,
        updatedAt: now,
      })

      imported.push({ id, name, type: vendorType })
    } catch (err: any) {
      errors.push({
        line: i + 1,
        error: err.message?.includes('UNIQUE')
          ? `Duplicate vendor: ${name}`
          : err.message ?? 'Unknown error',
      })
    }
  }

  return c.json({
    imported: imported.length,
    errors: errors.length,
    details: { imported, errors },
  })
})

export default vendorsRouter
