import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Card } from '../ui/Card'
import { cn } from '../../lib/utils'
import { UserPlus, KeyRound, Ban, RotateCcw } from 'lucide-react'
import {
  useUsers, useCreateUser, useUpdateUser, useDeactivateUser,
  type CreateUserInput,
} from '../../hooks/use-users'

const ROLES = ['VIEWER', 'EDITOR', 'ADMIN', 'SUPERADMIN']
const ROLE_LABEL: Record<string, string> = { VIEWER: 'Coordinator', EDITOR: 'Manager', ADMIN: 'Admin', SUPERADMIN: 'Superadmin' }

export function UsersSettings() {
  const { data: users, isLoading, isError } = useUsers()
  const create = useCreateUser()
  const update = useUpdateUser()
  const deactivate = useDeactivateUser()
  const [showCreate, setShowCreate] = useState(false)

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-text-primary">Users</h2>
          <p className="text-sm text-text-secondary">
            Manage who can sign in. New users get a temporary password and must set their own on first login.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-cobalt-primary px-3 py-2 text-sm font-semibold text-white hover:opacity-90"
        >
          <UserPlus size={14} /> Add User
        </button>
      </div>

      {isLoading && <div className="text-sm text-text-muted">Loading users...</div>}
      {isError && <div className="text-sm text-status-critical">Failed to load users. Try again.</div>}

      {users && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-text-muted">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-3 text-text-primary">{u.name}</td>
                  <td className="px-4 py-3 text-text-secondary">{u.email}</td>
                  <td className="px-4 py-3">
                    <select
                      aria-label={`Role for ${u.email}`}
                      value={u.role}
                      onChange={(e) => update.mutate({ id: u.id, patch: { role: e.target.value } })}
                      className="rounded-md border border-border bg-surface-700 px-2 py-1 text-xs text-text-primary focus:border-cobalt-primary focus:outline-none"
                    >
                      {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium',
                      u.active ? 'bg-cobalt-primary/15 text-cobalt-primary' : 'bg-surface-600 text-text-muted')}>
                      {u.active ? 'Active' : 'Inactive'}
                    </span>
                    {u.mustReset && (
                      <span className="ml-1 rounded-full border border-status-warning/30 bg-status-warning/15 px-2 py-0.5 text-[11px] font-medium text-status-warning">
                        Must reset
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        title="Reset password"
                        aria-label={`Reset password for ${u.email}`}
                        onClick={() => {
                          const pw = window.prompt(`Temporary password for ${u.email} (min 8 chars):`)
                          if (pw) update.mutate({ id: u.id, patch: { password: pw } })
                        }}
                        className="rounded-md p-1.5 text-text-muted hover:bg-surface-700 hover:text-text-primary"
                      ><KeyRound size={15} /></button>
                      {u.active ? (
                        <button
                          type="button"
                          title="Deactivate"
                          aria-label={`Deactivate ${u.email}`}
                          onClick={() => { if (window.confirm(`Deactivate ${u.email}?`)) deactivate.mutate(u.id) }}
                          className="rounded-md p-1.5 text-text-muted hover:bg-surface-700 hover:text-status-critical"
                        ><Ban size={15} /></button>
                      ) : (
                        <button
                          type="button"
                          title="Reactivate"
                          aria-label={`Reactivate ${u.email}`}
                          onClick={() => update.mutate({ id: u.id, patch: { active: true } })}
                          className="rounded-md p-1.5 text-text-muted hover:bg-surface-700 hover:text-cobalt-primary"
                        ><RotateCcw size={15} /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {showCreate && (
        <CreateUserModal
          pending={create.isPending}
          onClose={() => setShowCreate(false)}
          onSubmit={(input) => create.mutate(input, { onSuccess: () => setShowCreate(false) })}
        />
      )}
    </div>
  )
}

function CreateUserModal(props: { pending: boolean; onClose: () => void; onSubmit: (input: CreateUserInput) => void }) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState('VIEWER')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // jsdom lacks HTMLDialogElement.showModal/close — fall back to the open attribute.
    if (!el.open) {
      if (typeof el.showModal === 'function') el.showModal()
      else el.setAttribute('open', '')
    }
    const onCancel = (e: Event) => {
      e.preventDefault()
      props.onClose()
    }
    el.addEventListener('cancel', onCancel)
    return () => {
      el.removeEventListener('cancel', onCancel)
      if (el.open) {
        if (typeof el.close === 'function') el.close()
        else el.removeAttribute('open')
      }
    }
  }, [props.onClose])

  function submit(e: FormEvent) {
    e.preventDefault()
    if (password.length < 8) { setError('Temporary password must be at least 8 characters'); return }
    props.onSubmit({ email: email.trim().toLowerCase(), name: name.trim(), role, password })
  }

  return (
    <dialog
      ref={ref}
      aria-label="Add user"
      className="w-full max-w-sm space-y-3 rounded-xl border border-border bg-surface-900 p-5 text-text-primary shadow-xl open:fixed open:inset-0 open:m-auto open:max-h-[90vh] backdrop:bg-black/50"
    >
      <form onSubmit={submit} className="space-y-3">
        <h3 className="text-sm font-semibold text-text-primary">Add User</h3>
        <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email"
          className="w-full rounded-lg border border-border bg-surface-800 px-3 py-2 text-sm text-text-primary focus:border-cobalt-primary focus:outline-none" />
        <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name"
          className="w-full rounded-lg border border-border bg-surface-800 px-3 py-2 text-sm text-text-primary focus:border-cobalt-primary focus:outline-none" />
        <select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value)}
          className="w-full rounded-lg border border-border bg-surface-800 px-3 py-2 text-sm text-text-primary focus:border-cobalt-primary focus:outline-none">
          {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </select>
        <input required type="text" value={password} onChange={(e) => setPassword(e.target.value)}
          placeholder="Temporary password (min 8)"
          className="w-full rounded-lg border border-border bg-surface-800 px-3 py-2 text-sm text-text-primary focus:border-cobalt-primary focus:outline-none" />
        {error && <p className="text-xs text-status-critical">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={props.onClose}
            className="rounded-lg border border-border px-3 py-2 text-sm text-text-secondary hover:text-text-primary">Cancel</button>
          <button type="submit" disabled={props.pending}
            className="rounded-lg bg-cobalt-primary px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
            {props.pending ? 'Creating...' : 'Create'}
          </button>
        </div>
      </form>
    </dialog>
  )
}
