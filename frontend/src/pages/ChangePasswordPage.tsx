import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/use-auth'
import { CobaltLogo } from '../components/ui/CobaltLogo'
import { KeyRound } from 'lucide-react'

export default function ChangePasswordPage() {
  const { user, changePassword } = useAuth()
  const navigate = useNavigate()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(ev: FormEvent) {
    ev.preventDefault()
    setError(null)
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters')
      return
    }
    if (newPassword === currentPassword) {
      setError('New password must be different from your current password')
      return
    }
    if (newPassword !== confirm) {
      setError('New passwords do not match')
      return
    }
    setBusy(true)
    try {
      await changePassword(currentPassword, newPassword)
      navigate('/', { replace: true })
    } catch {
      setError('Current password is incorrect')
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
          <h1 className="text-xl font-semibold text-text-primary">Set a new password</h1>
          <p className="mt-1 text-sm text-text-muted">
            {user?.mustReset
              ? 'Your account uses a temporary password — choose a new one to continue.'
              : 'Change your password.'}
          </p>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="Current password"
            autoComplete="current-password"
            className="w-full rounded-lg border border-border bg-surface-800 px-4 py-2.5 text-sm text-text-primary outline-none focus:border-cobalt-primary/40"
          />
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="New password (min 8 chars)"
            autoComplete="new-password"
            className="w-full rounded-lg border border-border bg-surface-800 px-4 py-2.5 text-sm text-text-primary outline-none focus:border-cobalt-primary/40"
          />
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Confirm new password"
            autoComplete="new-password"
            className="w-full rounded-lg border border-border bg-surface-800 px-4 py-2.5 text-sm text-text-primary outline-none focus:border-cobalt-primary/40"
          />
          {error && <p className="text-xs text-status-critical">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-cobalt-primary px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <KeyRound size={14} /> {busy ? 'Saving…' : 'Set password'}
          </button>
        </form>
      </div>
    </div>
  )
}
