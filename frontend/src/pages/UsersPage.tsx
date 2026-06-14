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
        <div className="text-sm text-text-muted">Superadmins only.</div>
      </Card>
    )
  }

  const input = 'rounded-lg border border-border bg-surface-800 px-3 py-2 text-sm text-text-primary outline-none focus:border-cobalt-primary'
  const submit = () =>
    create.mutate(form, { onSuccess: () => setForm({ email: '', name: '', role: 'VIEWER', password: '' }) })

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Users</h1>

      <Card>
        <h2 className="mb-3 flex items-center gap-2 font-semibold">
          <UserPlus size={16} /> Add user
        </h2>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-6">
          <input placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={`${input} md:col-span-2`} />
          <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={input} />
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className={input}>
            {ALL_ROLES.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          <input placeholder="Password" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className={`${input} md:col-span-2`} />
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={submit}
            disabled={create.isPending || !form.email || !form.name || form.password.length < 4}
            className="rounded-lg bg-cobalt-primary px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            Create user
          </button>
          {create.isError && <span className="text-sm text-status-critical">Failed — duplicate email?</span>}
        </div>
      </Card>

      <Card padding={false}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-muted">
              <th className="px-5 py-3 font-medium">Name</th>
              <th className="px-5 py-3 font-medium">Email</th>
              <th className="px-5 py-3 font-medium">Role</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-border/50 last:border-0">
                <td className="px-5 py-3 text-text-primary">{u.name}</td>
                <td className="px-5 py-3 font-mono text-text-secondary">{u.email}</td>
                <td className="px-5 py-3">
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
                <td className="px-5 py-3">
                  <button
                    onClick={() => update.mutate({ id: u.id, active: !u.active })}
                    className={u.active ? 'text-status-success' : 'text-text-muted'}
                  >
                    {u.active ? 'Active' : 'Disabled'}
                  </button>
                </td>
                <td className="px-5 py-3 text-right">
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
