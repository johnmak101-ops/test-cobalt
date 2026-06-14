import { useState } from 'react'
import { Trash2, UserPlus } from 'lucide-react'
import { useUsers, useCreateUser, useUpdateUser, useDeleteUser } from '../hooks/use-users'
import { useAuth } from '../hooks/use-auth'
import { Card } from '../components/ui/Card'

const ALL_ROLES = ['VIEWER', 'EDITOR', 'ADMIN', 'SUPERADMIN']

export default function UsersPage() {
  const { user } = useAuth()
  const { data: users = [] } = useUsers()
  const create = useCreateUser()
  const update = useUpdateUser()
  const del = useDeleteUser()
  const [form, setForm] = useState({ email: '', name: '', role: 'VIEWER', password: '' })
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)

  // user management is SUPERADMIN-only
  if (user?.role !== 'SUPERADMIN') {
    return (
      <Card>
        <div className="muted">Superadmins only.</div>
      </Card>
    )
  }

  const submit = () =>
    create.mutate(form, { onSuccess: () => setForm({ email: '', name: '', role: 'VIEWER', password: '' }) })

  return (
    <div className="space-y-6">
      <h1 className="page-title">Users</h1>

      <Card>
        <h2 className="mb-3 flex items-center gap-2 section-title">
          <UserPlus size={16} /> Add user
        </h2>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-6">
          <input placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="input md:col-span-2" />
          <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input" />
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="input">
            {ALL_ROLES.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          <input placeholder="Password" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="input md:col-span-2" />
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={submit}
            disabled={create.isPending || !form.email || !form.name || form.password.length < 4}
            className="btn btn-primary"
          >
            Create user
          </button>
          {create.isError && (
            <span className="text-sm text-status-critical">Could not create the user — that email may already be in use.</span>
          )}
        </div>
      </Card>

      <Card padding={false}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td className="text-text-primary">{u.name}</td>
                <td className="font-mono text-text-secondary">{u.email}</td>
                <td>
                  <select
                    value={u.role}
                    onChange={(e) => update.mutate({ id: u.id, role: e.target.value })}
                    className="rounded-md border border-border bg-surface-800 px-2 py-1 text-xs"
                  >
                    {ALL_ROLES.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <button
                    onClick={() => update.mutate({ id: u.id, active: !u.active })}
                    className={u.active ? 'text-status-success' : 'text-text-muted'}
                  >
                    {u.active ? 'Active' : 'Disabled'}
                  </button>
                </td>
                <td className="text-right">
                  {pendingDelete === u.id ? (
                    <span className="inline-flex items-center gap-2 text-xs">
                      <span className="text-text-muted">Delete?</span>
                      <button
                        onClick={() => {
                          del.mutate(u.id)
                          setPendingDelete(null)
                        }}
                        className="font-semibold text-status-critical hover:underline"
                      >
                        Yes
                      </button>
                      <button onClick={() => setPendingDelete(null)} className="text-text-muted hover:text-text-primary">
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      onClick={() => setPendingDelete(u.id)}
                      disabled={u.id === user?.id}
                      title={u.id === user?.id ? 'You cannot delete yourself' : 'Delete user'}
                      className="text-text-muted hover:text-status-critical disabled:opacity-30"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
