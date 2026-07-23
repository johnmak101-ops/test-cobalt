import { useState } from 'react'
import { useAuth } from '../hooks/use-auth'
import { CobaltLogo } from '../components/ui/CobaltLogo'
import { LogIn } from 'lucide-react'

export default function LoginPage() {
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function doLogin() {
    setBusy(true)
    setError(null)
    try {
      await login(email, password)
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
      </div>
    </div>
  )
}
