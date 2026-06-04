import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../hooks/use-auth'
import { api } from '../lib/api'
import { CobaltLogo } from '../components/ui/CobaltLogo'
import { cn } from '../lib/utils'
import { Ship, BarChart3, Shield } from 'lucide-react'

interface UserEntry {
  id: string
  name: string
  email: string
  role: string
  avatarInitials: string
}

const roleConfig: Record<
  string,
  { label: string; description: string; icon: typeof Ship; accent: string }
> = {
  COORDINATOR: {
    label: 'Operations Coordinator',
    description: 'Monitors shipments, processes emails, responds to alerts',
    icon: Ship,
    accent: 'bg-cobalt-teal',
  },
  MANAGER: {
    label: 'Operations Manager',
    description: 'Reviews performance, manages escalations, configures rules',
    icon: BarChart3,
    accent: 'bg-cobalt-primary',
  },
  ADMIN: {
    label: 'IT Administrator',
    description: 'System configuration, user management, API access',
    icon: Shield,
    accent: 'bg-state-sailed',
  },
}

export default function LoginPage() {
  const { login } = useAuth()
  const [loggingIn, setLoggingIn] = useState<string | null>(null)

  const { data } = useQuery<{ users: UserEntry[] }>({
    queryKey: ['auth-users'],
    queryFn: () => api.get('/auth/users'),
  })

  const users = data?.users ?? []

  const handleLogin = async (userId: string) => {
    setLoggingIn(userId)
    try {
      await login(userId)
    } catch {
      setLoggingIn(null)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg px-4">
      {/* Background accent — subtle diagonal lines echoing the logo */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden opacity-[0.03]">
        <div
          className="absolute -left-1/4 -top-1/4 h-[150%] w-[150%]"
          style={{
            backgroundImage:
              'repeating-linear-gradient(45deg, currentColor 0, currentColor 1px, transparent 1px, transparent 18px)',
          }}
        />
      </div>

      {/* Login card */}
      <div className="relative z-10 w-full max-w-md">
        {/* Header */}
        <div className="mb-10 text-center">
          <div className="mb-5 flex items-center justify-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-cobalt-primary">
              <CobaltLogo size={32} color="white" />
            </div>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-text-primary">
            ShipTrack
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Cobalt Knitwear Shipping Operations
          </p>
        </div>

        {/* Persona cards */}
        <div className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-wider text-text-muted">
            Sign in as
          </p>

          {users.map((user) => {
            const config = roleConfig[user.role] ?? roleConfig.COORDINATOR
            const Icon = config.icon
            const isLoading = loggingIn === user.id

            return (
              <button
                key={user.id}
                onClick={() => handleLogin(user.id)}
                disabled={loggingIn !== null}
                className={cn(
                  'group relative flex w-full items-center gap-4 rounded-xl border border-border bg-surface-800 px-5 py-4 text-left transition-all',
                  'hover:border-cobalt-primary/40 hover:bg-surface-700',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt-primary/50',
                  'disabled:opacity-60',
                  isLoading && 'border-cobalt-primary/60 bg-surface-700'
                )}
              >
                {/* Avatar */}
                <div
                  className={cn(
                    'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white transition-transform group-hover:scale-105',
                    config.accent
                  )}
                >
                  {user.avatarInitials}
                </div>

                {/* Info */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-text-primary">
                      {user.name}
                    </span>
                    <span className="rounded-md bg-surface-600 px-1.5 py-0.5 text-[10px] font-medium text-text-muted">
                      {config.label}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-text-muted">{config.description}</p>
                </div>

                {/* Icon */}
                <Icon
                  size={18}
                  className="shrink-0 text-text-muted transition-colors group-hover:text-cobalt-primary"
                />

                {/* Loading spinner overlay */}
                {isLoading && (
                  <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-surface-800/80">
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-cobalt-primary border-t-transparent" />
                  </div>
                )}
              </button>
            )
          })}
        </div>

        {/* Footer */}
        <p className="mt-8 text-center text-[11px] text-text-muted">
          Cobalt Fashion Holding Limited
        </p>
      </div>
    </div>
  )
}
