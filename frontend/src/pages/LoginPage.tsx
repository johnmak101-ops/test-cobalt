import { useState } from 'react'
import { useAuth } from '../hooks/use-auth'
import { CobaltLogo } from '../components/ui/CobaltLogo'
import { cn } from '../lib/utils'
import { LogIn } from 'lucide-react'

const DEV_USERS = [
  { id: 'user-sunny', name: 'Sunny', role: 'COORDINATOR', initials: 'SC', color: 'bg-cobalt-teal' },
  { id: 'user-amon', name: 'Amon', role: 'MANAGER', initials: 'AL', color: 'bg-cobalt-primary' },
  { id: 'user-admin', name: 'Admin', role: 'ADMIN', initials: 'AD', color: 'bg-state-sailed' },
]

export default function LoginPage() {
  const { login } = useAuth()
  const [loadingId, setLoadingId] = useState<string | null>(null)

  const handleLogin = async (userId: string) => {
    setLoadingId(userId)
    try {
      await login(userId)
    } catch {
      setLoadingId(null)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm">
        {/* Logo + title */}
        <div className="mb-8 text-center">
          <div className="mb-4 flex items-center justify-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-cobalt-primary">
              <CobaltLogo size={28} color="white" />
            </div>
          </div>
          <h1 className="text-xl font-semibold text-text-primary">ShipTrack</h1>
          <p className="mt-1 text-sm text-text-muted">Sign in to continue</p>
        </div>

        {/* Quick login buttons */}
        <div className="space-y-2">
          {DEV_USERS.map((user) => (
            <button
              key={user.id}
              onClick={() => handleLogin(user.id)}
              disabled={loadingId !== null}
              className={cn(
                'flex w-full items-center gap-3 rounded-lg border border-border bg-surface-800 px-4 py-3 text-left transition-all',
                'hover:border-cobalt-primary/40 hover:bg-surface-700',
                'disabled:opacity-50',
              )}
            >
              <div
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white',
                  user.color,
                )}
              >
                {user.initials}
              </div>
              <div className="min-w-0 flex-1">
                <span className="text-sm font-medium text-text-primary">{user.name}</span>
                <span className="ml-2 text-[10px] font-medium uppercase tracking-wider text-text-muted">
                  {user.role}
                </span>
              </div>
              {loadingId === user.id ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-cobalt-primary border-t-transparent" />
              ) : (
                <LogIn size={14} className="text-text-muted" />
              )}
            </button>
          ))}
        </div>

        <p className="mt-6 text-center text-[11px] text-text-muted">
          Cobalt Fashion Holding Limited
        </p>
      </div>
    </div>
  )
}