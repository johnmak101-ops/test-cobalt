import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import { api } from '../../lib/api'
import { Card } from '../ui/Card'

type Level = 'none' | 'view' | 'edit'
interface PageRow {
  id: string
  label: string
  levels: Record<string, Level>
}

// UI labels for the backend roles (VIEWER→Coordinator, EDITOR→Manager). SUPERADMIN is shown locked.
const ROLES = [
  { key: 'VIEWER', label: 'Coordinator' },
  { key: 'EDITOR', label: 'Manager' },
  { key: 'ADMIN', label: 'Admin' },
]
const LEVELS: Level[] = ['none', 'view', 'edit']
const LEVEL_LABEL: Record<Level, string> = { none: 'No access', view: 'View only', edit: 'Edit' }

/** Superadmin-only editor for the config-page access matrix (page × role → None/View/Edit). */
export function AccessControlSettings() {
  const { data, isLoading } = useQuery<{ pages: PageRow[] }>({
    queryKey: ['pageAccess', 'matrix'],
    queryFn: () => api.get('/page-access'),
  })
  const qc = useQueryClient()
  const [rows, setRows] = useState<PageRow[]>([])
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (data?.pages) {
      setRows(data.pages)
      setDirty(false)
    }
  }, [data])

  const save = useMutation({
    mutationFn: () => {
      const overrides: Record<string, Record<string, Level>> = {}
      for (const p of rows) overrides[p.id] = { ...p.levels }
      return api.put('/page-access', { overrides })
    },
    // invalidate the whole pageAccess tree so this matrix AND every user's /me refetch
    onSuccess: () => {
      setDirty(false)
      qc.invalidateQueries({ queryKey: ['pageAccess'] })
    },
  })

  if (isLoading) return <p className="text-sm text-text-secondary">Loading…</p>

  const setLevel = (pageId: string, role: string, level: Level) => {
    setRows((rs) => rs.map((p) => (p.id === pageId ? { ...p, levels: { ...p.levels, [role]: level } } : p)))
    setDirty(true)
  }

  return (
    <Card>
      <h2 className="text-base font-semibold text-text-primary">Access Control</h2>
      <p className="mt-1 text-sm text-text-secondary">
        Control who can open and edit each config page. Superadmin always has full access.
      </p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-text-muted">
              <th className="py-2 pr-4 font-medium">Page</th>
              {ROLES.map((r) => (
                <th key={r.key} className="px-3 py-2 font-medium">
                  {r.label}
                </th>
              ))}
              <th className="px-3 py-2 font-medium">Superadmin</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="border-t border-surface-700">
                <td className="py-2 pr-4 text-text-primary">{p.label}</td>
                {ROLES.map((r) => (
                  <td key={r.key} className="px-3 py-2">
                    <select
                      aria-label={`${p.label} — ${r.label}`}
                      value={p.levels[r.key] ?? 'none'}
                      onChange={(e) => setLevel(p.id, r.key, e.target.value as Level)}
                      className="rounded border border-surface-700 bg-surface-800 px-2 py-1 text-text-primary"
                    >
                      {LEVELS.map((l) => (
                        <option key={l} value={l}>
                          {LEVEL_LABEL[l]}
                        </option>
                      ))}
                    </select>
                  </td>
                ))}
                <td className="px-3 py-2 text-text-muted">Edit</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        disabled={!dirty || save.isPending}
        onClick={() => save.mutate()}
        className="mt-4 rounded-lg bg-cobalt-primary px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {save.isPending ? 'Saving…' : 'Save'}
      </button>
    </Card>
  )
}
