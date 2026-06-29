import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import type { ReactNode } from 'react'
import { api } from '../lib/api'

interface User {
  id: string
  name: string
  email: string
  role: 'COORDINATOR' | 'MANAGER' | 'ADMIN'
  avatarInitials: string
}

interface AuthContextValue {
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => void
}

const TOKEN_KEY = 'cobalt_token'
const AuthContext = createContext<AuthContextValue | null>(null)

function initials(name: string, email: string): string {
  const src = (name || email || '').trim()
  const parts = src.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return src.slice(0, 2).toUpperCase()
}

function normalize(u: { id: string; name?: string; email: string; role?: string; avatarInitials?: string }): User {
  return {
    id: u.id,
    name: u.name ?? u.email,
    email: u.email,
    role: (u.role as User['role']) ?? 'COORDINATOR',
    avatarInitials: u.avatarInitials || initials(u.name ?? '', u.email),
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  // Restore the session on mount (cookie or stored token → /auth/me).
  useEffect(() => {
    api
      .get<{ user: User }>('/auth/me')
      .then((r) => setUser(normalize(r.user)))
      .catch(() => {
        try {
          localStorage.removeItem(TOKEN_KEY)
        } catch {
          /* ignore */
        }
        setUser(null)
      })
      .finally(() => setLoading(false))
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.post<{ token: string; user: User }>('/auth/login', { email, password })
    try {
      if (res?.token) localStorage.setItem(TOKEN_KEY, res.token)
    } catch {
      /* ignore */
    }
    const me = await api.get<{ user: User }>('/auth/me')
    setUser(normalize(me.user))
  }, [])

  const logout = useCallback(() => {
    api.post('/auth/logout', {}).catch(() => {})
    try {
      localStorage.removeItem(TOKEN_KEY)
    } catch {
      /* ignore */
    }
    setUser(null)
  }, [])

  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}
