import { useState } from 'react'
import { useAuth } from '../hooks/use-auth'
import { CobaltLogo } from '../components/ui/CobaltLogo'
import { cn } from '../lib/utils'
import { LogIn } from 'lucide-react'

// Dev-only quick sign-in — never rendered in a production build (gated on import.meta.env.DEV below).
// These are the seeded accounts; they start on the placeholder password and are forced to reset on first login.
const DEV_PASSWORD = 'cobalt-change-me'
const DEV_USERS = [
  { email: 'super@cobalt.hk', name: 'Super', role: 'SUPERADMIN', initials: 'SU', color: 'bg-state-sailed' },
  { email: 'admin@cobalt.hk', name: 'Admin', role: 'ADMIN', initials: 'AD', color: 'bg-cobalt-primary' },
]

export default function LoginPage() {
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function doLogin(e?: string, p?: string) {
    setBusy(true)
    setError(null)
    try {
      await login(e ?? email, p ?? password)
    } catch {
      setError('Invalid email or password')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mb-4 flex items-center justify-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-cobalt-primary">
              <CobaltLogo size={28} color="white" />
            </div>
          </div>
          <h1 className="text-xl font-semibold text-text-primary">ShipTrack</h1>
          <p className="mt-1 text-sm text-text-muted">Sign in to continue</p>
        </div>

        <form
          onSubmit={(ev) => {
            ev.preventDefault()
            void doLogin()
          }}
          className="space-y-3"
        >
          <input
            type="email"
            value={email}
            onChange={(ev) => setEmail(ev.target.value)}
            placeholder="Email"
            autoComplete="username"
            className="w-full rounded-lg border border-border bg-surface-800 px-4 py-2.5 text-sm text-text-primary outline-none focus:border-cobalt-primary/40"
          />
          <input
            type="password"
            value={password}
            onChange={(ev) => setPassword(ev.target.value)}
            placeholder="Password"
            autoComplete="current-password"
            className="w-full rounded-lg border border-border bg-surface-800 px-4 py-2.5 text-sm text-text-primary outline-none focus:border-cobalt-primary/40"
          />
          {error && <p className="text-xs text-status-critical">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-cobalt-primary px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <LogIn size={14} /> {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        {import.meta.env.DEV && (
          <>
            <p className="mb-2 mt-6 text-center text-[11px] text-text-muted">Quick sign-in (dev only)</p>
            <div className="space-y-2">
              {DEV_USERS.map((u) => (
                <button
                  key={u.email}
                  type="button"
                  onClick={() => void doLogin(u.email, DEV_PASSWORD)}
                  disabled={busy}
                  className="flex w-full items-center gap-3 rounded-lg border border-border bg-surface-800 px-4 py-3 text-left transition-all hover:border-cobalt-primary/40 hover:bg-surface-700 disabled:opacity-50"
                >
                  <div
                    className={cn(
                      'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white',
                      u.color,
                    )}
                  >
                    {u.initials}
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="text-sm font-medium text-text-primary">{u.name}</span>
                    <span className="ml-2 text-[10px] font-medium uppercase tracking-wider text-text-muted">{u.role}</span>
                  </div>
                  <LogIn size={14} className="text-text-muted" />
                </button>
              ))}
            </div>
          </>
        )}

        <p className="mt-6 text-center text-[11px] text-text-muted">Cobalt Fashion Holding Limited</p>
      </div>
    </div>
  )
}
