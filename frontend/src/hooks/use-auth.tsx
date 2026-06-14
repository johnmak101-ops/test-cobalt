import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, setToken, getToken, clearToken } from '../lib/api'

export interface AuthUser {
  id: string
  email: string
  name: string
  role: string
}

interface AuthContextValue {
  user: AuthUser | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue>(null as unknown as AuthContextValue)
export const useAuth = () => useContext(AuthContext)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!getToken()) {
      setLoading(false)
      return
    }
    api
      .get<AuthUser>('/auth/me')
      .then(setUser)
      .catch(() => clearToken())
      .finally(() => setLoading(false))
  }, [])

  const login = async (email: string, password: string) => {
    const res = await api.post<{ token: string; user: AuthUser }>('/auth/login', { email, password })
    setToken(res.token)
    setUser(res.user)
  }

  const logout = () => {
    clearToken()
    setUser(null)
  }

  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>
}
