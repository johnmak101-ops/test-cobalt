import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import crypto from 'node:crypto'
import { users, sessions } from '../db/schema.js'

type Env = { Variables: { db: any } }

const authRouter = new Hono<Env>()

// POST /auth/login — Login by user ID (quick-switch for MVP)
authRouter.post('/auth/login', async (c) => {
  const db = c.get('db')
  const body = await c.req.json()
  const userId = body.userId

  if (!userId) {
    return c.json({ error: 'userId is required' }, 400)
  }

  const user = await db.select().from(users).where(eq(users.id, userId)).get()
  if (!user) {
    return c.json({ error: 'User not found' }, 404)
  }

  // Create session (30 days expiry)
  const sessionId = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

  await db.insert(sessions).values({
    id: sessionId,
    userId: user.id,
    expiresAt,
  })

  setCookie(c, 'session', sessionId, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: 30 * 24 * 60 * 60,
  })

  return c.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      avatarInitials: user.avatarInitials,
    },
  })
})

// GET /auth/me — Get current user from session cookie
authRouter.get('/auth/me', async (c) => {
  const db = c.get('db')
  const sessionId = getCookie(c, 'session')

  if (!sessionId) {
    return c.json({ user: null }, 401)
  }

  const session = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .get()

  if (!session || new Date(session.expiresAt) < new Date()) {
    deleteCookie(c, 'session', { path: '/' })
    return c.json({ user: null }, 401)
  }

  const user = await db
    .select()
    .from(users)
    .where(eq(users.id, session.userId))
    .get()

  if (!user) {
    deleteCookie(c, 'session', { path: '/' })
    return c.json({ user: null }, 401)
  }

  return c.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      avatarInitials: user.avatarInitials,
    },
  })
})

// POST /auth/logout
authRouter.post('/auth/logout', async (c) => {
  const db = c.get('db')
  const sessionId = getCookie(c, 'session')

  if (sessionId) {
    await db.delete(sessions).where(eq(sessions.id, sessionId))
    deleteCookie(c, 'session', { path: '/' })
  }

  return c.json({ success: true })
})

// GET /auth/users — List all users (for login page persona cards)
authRouter.get('/auth/users', async (c) => {
  const db = c.get('db')
  const allUsers = await db.select().from(users)

  return c.json({
    users: allUsers.map((u: any) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      avatarInitials: u.avatarInitials,
    })),
  })
})

export default authRouter
