import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/use-auth'
import { CobaltLogo } from '../components/ui/CobaltLogo'

const quick = [
  { email: 'viewer@cobalt.hk', role: 'Viewer' },
  { email: 'editor@cobalt.hk', role: 'Editor' },
  { email: 'admin@cobalt.hk', role: 'Admin' },
]

export default function LoginPage() {
  const { login } = useAuth()
  const nav = useNavigate()
  const [email, setEmail] = useState('editor@cobalt.hk')
  const [password, setPassword] = useState('cobalt')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: string, p: string) => {
    setBusy(true)
    setError('')
    try {
      await login(e, p)
      nav('/')
    } catch {
      setError('Invalid credentials')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-bg">
      <div className="w-80 space-y-6">
        <div className="flex items-center justify-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-cobalt-primary">
            <CobaltLogo size={22} color="white" />
          </div>
          <div className="text-lg font-bold">
            COBALT <span className="text-sm font-medium text-text-muted">ShipTrack</span>
          </div>
        </div>

        <form
          onSubmit={(ev) => {
            ev.preventDefault()
            submit(email, password)
          }}
          className="space-y-3"
        >
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="w-full rounded-lg border border-border bg-surface-800 px-3 py-2 text-sm text-text-primary outline-none focus:border-cobalt-primary"
          />
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            placeholder="Password"
            className="w-full rounded-lg border border-border bg-surface-800 px-3 py-2 text-sm text-text-primary outline-none focus:border-cobalt-primary"
          />
          {error && <div className="text-sm text-status-critical">{error}</div>}
          <button
            disabled={busy}
            className="w-full rounded-lg bg-cobalt-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div className="space-y-1.5">
          <div className="text-center text-xs text-text-muted">Quick sign-in (dev · password "cobalt")</div>
          <div className="flex gap-2">
            {quick.map((q) => (
              <button
                key={q.email}
                onClick={() => submit(q.email, 'cobalt')}
                className="flex-1 rounded-lg border border-border bg-surface-800 py-1.5 text-xs text-text-secondary hover:text-text-primary"
              >
                {q.role}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
