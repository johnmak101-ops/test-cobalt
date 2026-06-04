import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { customers } from '../db/schema.js'
import crypto from 'node:crypto'

type Env = { Variables: { db: any } }

const customersRouter = new Hono<Env>()

// GET /customers
customersRouter.get('/customers', async (c) => {
  const db = c.get('db')
  const results = await db.select().from(customers)
  return c.json({ customers: results })
})

// POST /customers
customersRouter.post('/customers', async (c) => {
  const db = c.get('db')
  const body = await c.req.json()
  const id = crypto.randomUUID()

  await db.insert(customers).values({
    id,
    name: body.name,
    code: body.code,
  })

  const created = await db.select().from(customers).where(eq(customers.id, id)).get()
  return c.json(created, 201)
})

export default customersRouter
