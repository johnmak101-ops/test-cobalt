import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { db } from './db'
import { messages } from './db/schema'

const app = new Hono()

// Middleware
app.use('*', logger())
app.use('*', cors())

// Routes
app.get('/', (c) => {
  return c.json({ message: 'Pave App API' })
})

app.get('/api/hello', async (c) => {
  // Insert a message into the database
  const result = await db.insert(messages).values({
    content: `Hello from the API! Generated at ${new Date().toISOString()}`,
  }).returning()

  return c.json({
    message: result[0].content,
    id: result[0].id,
    createdAt: result[0].createdAt,
  })
})

app.get('/api/messages', async (c) => {
  const allMessages = await db.select().from(messages).orderBy(messages.createdAt)
  return c.json({ messages: allMessages })
})

const port = parseInt(process.env.PORT ?? '3000', 10)

console.log(`🚀 Server is running on http://localhost:${port}`)

serve({
  fetch: app.fetch,
  port,
})
