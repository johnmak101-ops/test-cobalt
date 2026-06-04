import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { forwarders } from '../db/schema.js'
import crypto from 'node:crypto'

type Env = { Variables: { db: any } }

const forwardersRouter = new Hono<Env>()

// GET /forwarders
forwardersRouter.get('/forwarders', async (c) => {
  const db = c.get('db')
  const results = await db.select().from(forwarders)
  return c.json({ forwarders: results })
})

// POST /forwarders
forwardersRouter.post('/forwarders', async (c) => {
  const db = c.get('db')
  const body = await c.req.json()
  const id = crypto.randomUUID()

  await db.insert(forwarders).values({
    id,
    name: body.name,
  })

  const created = await db.select().from(forwarders).where(eq(forwarders.id, id)).get()
  return c.json(created, 201)
})

export default forwardersRouter
