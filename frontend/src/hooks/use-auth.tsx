import { createContext, useContext, useState, useEffect, useCallback } from 'react'
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
  login: (userId: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  // Check session on mount
  useEffect(() => {
    api
      .get<{ user: User | null }>('/auth/me')
      .then((data) => setUser(data.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false))
  }, [])

  const login = useCallback(async (userId: string) => {
    const data = await api.post<{ user: User }>('/auth/login', { userId })
    setUser(data.user)
  }, [])

  const logout = useCallback(async () => {
    await api.post('/auth/logout', {})
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}
