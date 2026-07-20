import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import { toast } from '../components/ui/Toast'

/** mirrors backend MeshMissRow — keep in sync */
interface Row {
  type: string
  rawName: string
  normalizedName: string
  shipmentIds: string[]
  count: number
  firstSeen: string
  lastSeen: string
  status: 'open' | 'acked' | 'recurred'
}

/** Shared with backend MESH_MISS_DEFAULT_DAYS */
const MESH_MISS_DAYS = 30

function csvCell(raw: string): string {
  let s = raw.replace(/"/g, '""')
  // Formula neutralization (defense-in-depth — EDITOR can post unhardened criticReview)
  if (/^[=+\-@]/.test(s)) s = `'${s}`
  return `"${s}"`
}

function shipmentTooltip(ids: string[]): string {
  if (ids.length <= 10) return ids.join(', ')
  return `${ids.slice(0, 10).join(', ')} +${ids.length - 10} more`
}

export default function AdminMeshMissesPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [includeAcked, setIncludeAcked] = useState(false)
  const [typeFilter, setTypeFilter] = useState<'all' | 'vendor' | 'forwarder' | 'customer'>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.get<Row[]>(
        `/admin/mesh-misses?days=${MESH_MISS_DAYS}&includeAcked=${includeAcked ? 'true' : 'false'}`,
      )
      setRows(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [includeAcked])

  useEffect(() => {
    void load()
  }, [load])

  const view = useMemo(
    () => rows.filter((r) => typeFilter === 'all' || r.type === typeFilter),
    [rows, typeFilter],
  )

  const filtered = typeFilter !== 'all' || includeAcked

  const ack = async (r: Row) => {
    try {
      await api.post('/admin/mesh-misses/ack', {
        type: r.type,
        normalizedName: r.normalizedName,
      })
      toast('Marked as in Mesh')
      void load()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Ack failed')
    }
  }

  const exportCsv = () => {
    const head = 'type,rawName,count,firstSeen,lastSeen,status'
    // UTF-8 BOM so Excel opens CJK names correctly
    const bom = '\uFEFF'
    const csv =
      bom +
      [head, ...view.map((r) => [r.type, csvCell(r.rawName), r.count, r.firstSeen, r.lastSeen, r.status].join(','))].join(
        '\n',
      )
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `mesh-misses-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const statusClass = (s: Row['status']) => {
    if (s === 'recurred') return 'rounded-full border border-status-warning/40 bg-status-warning/15 px-2 py-0.5 text-[11px] font-semibold text-status-warning'
    if (s === 'acked') return 'rounded-full border border-border bg-surface-800 px-2 py-0.5 text-[11px] text-text-muted'
    return 'rounded-full border border-border bg-surface-800 px-2 py-0.5 text-[11px] text-text-secondary'
  }

  const typeTabs = [
    { id: 'all' as const, label: 'All types' },
    { id: 'vendor' as const, label: 'Vendors' },
    { id: 'forwarder' as const, label: 'Forwarders' },
    { id: 'customer' as const, label: 'Customers' },
  ]

  return (
    <div className="space-y-4 p-1">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold text-text-primary">Mesh misses</h1>
        {/* Horizontal type sub-cats (was a select dropdown) */}
        <div
          role="tablist"
          aria-label="Mesh miss type"
          className="inline-flex flex-wrap overflow-hidden rounded-lg border border-border"
        >
          {typeTabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={typeFilter === t.id}
              onClick={() => setTypeFilter(t.id)}
              className={
                typeFilter === t.id
                  ? 'bg-cobalt-primary px-3 py-1.5 text-xs font-medium text-white'
                  : 'bg-surface-800 px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-700 hover:text-text-primary'
              }
            >
              {t.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-sm text-text-secondary">
          <input
            type="checkbox"
            checked={includeAcked}
            onChange={(e) => setIncludeAcked(e.target.checked)}
            className="rounded border-border"
          />
          Show acked
        </label>
        <button
          type="button"
          className="ml-auto rounded-lg border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-surface-700 hover:text-text-primary"
          onClick={exportCsv}
        >
          Export CSV
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-text-muted">Loading…</p>
      ) : error ? (
        <p className="text-sm text-status-critical">{error}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-900/50 text-left text-text-muted">
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Shipments</th>
                <th className="px-3 py-2">First seen</th>
                <th className="px-3 py-2">Last seen</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {view.map((r) => (
                <tr key={`${r.type}:${r.normalizedName}`} className="border-t border-border">
                  <td className="px-3 py-2 font-medium text-text-primary">{r.rawName}</td>
                  <td className="px-3 py-2 capitalize text-text-secondary">{r.type}</td>
                  <td className="px-3 py-2 text-text-secondary" title={shipmentTooltip(r.shipmentIds)}>
                    {r.count}
                  </td>
                  <td className="px-3 py-2 text-text-muted">{r.firstSeen.slice(0, 10)}</td>
                  <td className="px-3 py-2 text-text-muted">{r.lastSeen.slice(0, 10)}</td>
                  <td className="px-3 py-2">
                    <span className={statusClass(r.status)}>
                      {r.status === 'recurred' ? 'recurred after ack' : r.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {r.status !== 'acked' && (
                      <button
                        type="button"
                        className="rounded border border-border px-2 py-0.5 text-xs hover:bg-surface-700"
                        onClick={() => void ack(r)}
                      >
                        已入 Mesh
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {view.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-text-muted">
                    {filtered
                      ? 'No Mesh misses match these filters.'
                      : `No open Mesh misses in the last ${MESH_MISS_DAYS} days.`}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
