import { useState } from 'react'
import { Plus, Save } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { useAuth } from '../hooks/use-auth'
import {
  useCustomers,
  useVendors,
  useForwarders,
  usePorts,
  useConsignees,
  useCreateMaster,
  useUpdateMaster,
  type EditableKind,
} from '../hooks/use-masters'

type Opt = { value: string; label: string }
interface Col {
  key: string
  label: string
  type?: 'text' | 'select'
  options?: Opt[]
  required?: boolean
  createOnly?: boolean // editable on create, immutable after (e.g. the UN/LOCODE key)
  placeholder?: string
}

const TABS = ['customers', 'vendors', 'forwarders', 'ports', 'consignees'] as const
type Tab = (typeof TABS)[number]
const RANK: Record<string, number> = { VIEWER: 0, EDITOR: 1, ADMIN: 2, SUPERADMIN: 3 }

type Row = Record<string, unknown>

function FieldInput({ col, value, onChange, compact }: { col: Col; value: string; onChange: (v: string) => void; compact?: boolean }) {
  const cls = compact ? 'w-full rounded-md border border-border bg-surface-800 px-2 py-1 text-xs' : 'input'
  if (col.type === 'select') {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} className={cls}>
        {(col.options ?? []).map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    )
  }
  return <input value={value} placeholder={col.placeholder ?? col.label} onChange={(e) => onChange(e.target.value)} className={cls} />
}

function ReadOnlyTable<T extends { id: string }>({ note, cols, rows }: { note: string; cols: Col[]; rows: readonly T[] }) {
  return (
    <Card padding={false}>
      <div className="flex items-center justify-between px-5 py-3">
        <span className="text-xs font-medium uppercase tracking-wide text-text-muted">{note}</span>
        <span className="text-xs text-text-muted">{rows.length}</span>
      </div>
      <table className="data-table">
        <thead>
          <tr>{cols.map((c) => <th key={c.key}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id ?? i}>
              {cols.map((c) => {
                const val = (r as Row)[c.key]
                return (
                  <td key={c.key} className={c.key === 'code' ? 'font-mono text-text-secondary' : 'text-text-primary'}>
                    {val != null && val !== '' ? String(val) : '—'}
                  </td>
                )
              })}
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={cols.length} className="muted">None.</td>
            </tr>
          )}
        </tbody>
      </table>
    </Card>
  )
}

function EditRow<T extends { id: string }>({ row, cols, onSave, saving }: { row: T; cols: Col[]; onSave: (patch: Record<string, string>) => void; saving: boolean }) {
  const r = row as Row
  const initial = Object.fromEntries(cols.map((c) => [c.key, r[c.key] == null ? '' : String(r[c.key])]))
  const [v, setV] = useState<Record<string, string>>(initial)
  const dirty = cols.some((c) => !c.createOnly && (v[c.key] ?? '') !== (initial[c.key] ?? ''))
  const save = () => {
    const patch: Record<string, string> = {}
    for (const c of cols) if (!c.createOnly && v[c.key] !== initial[c.key]) patch[c.key] = v[c.key]
    onSave(patch)
  }
  return (
    <tr>
      {cols.map((c) => (
        <td key={c.key}>
          {c.createOnly ? (
            <span className="font-mono text-text-secondary">{initial[c.key] || '—'}</span>
          ) : (
            <FieldInput col={c} value={v[c.key] ?? ''} onChange={(val) => setV((s) => ({ ...s, [c.key]: val }))} compact />
          )}
        </td>
      ))}
      <td className="text-right">
        <button onClick={save} disabled={!dirty || saving} className="inline-flex items-center gap-1 text-xs text-cobalt-primary disabled:opacity-30">
          <Save size={13} /> Save
        </button>
      </td>
    </tr>
  )
}

function EditableTable<T extends { id: string }>({ kind, cols, rows }: { kind: EditableKind; cols: Col[]; rows: readonly T[] }) {
  const create = useCreateMaster(kind)
  const update = useUpdateMaster(kind)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const requiredOk = cols.filter((c) => c.required).every((c) => (draft[c.key] ?? '').trim())
  const singular = kind.slice(0, -1)

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="mb-3 flex items-center gap-2 capitalize section-title">
          <Plus size={16} /> Add {singular}
        </h2>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
          {cols.map((c) => (
            <FieldInput key={c.key} col={c} value={draft[c.key] ?? ''} onChange={(val) => setDraft((d) => ({ ...d, [c.key]: val }))} />
          ))}
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button onClick={() => create.mutate(draft, { onSuccess: () => setDraft({}) })} disabled={create.isPending || !requiredOk} className="btn btn-primary">
            Add
          </button>
          {create.isError && <span className="text-sm text-status-critical">Could not add — check for a duplicate code / UN-LOCODE.</span>}
        </div>
      </Card>

      <Card padding={false}>
        <table className="data-table">
          <thead>
            <tr>
              {cols.map((c) => <th key={c.key}>{c.label}</th>)}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <EditRow
                // re-key on the row's values so a successful save (refetch) remounts with a clean, not-dirty state
                key={`${r.id}:${cols.map((c) => (r as Row)[c.key]).join('|')}`}
                row={r}
                cols={cols}
                saving={update.isPending}
                onSave={(patch) => update.mutate({ id: r.id as string, ...patch })}
              />
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={cols.length + 1} className="muted">None yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  )
}

export default function MastersPage() {
  const { user } = useAuth()
  const [tab, setTab] = useState<Tab>('forwarders')
  const customers = useCustomers()
  const vendors = useVendors()
  const forwarders = useForwarders()
  const ports = usePorts()
  const consignees = useConsignees()

  if ((RANK[user?.role ?? ''] ?? -1) < 2) {
    return (
      <Card>
        <div className="muted">Admins only.</div>
      </Card>
    )
  }

  const customerOpts: Opt[] = [
    { value: '', label: '— none —' },
    ...(customers.data ?? []).map((c) => ({ value: c.id, label: `${c.name} (${c.code})` })),
  ]

  const editableCols: Record<EditableKind, Col[]> = {
    forwarders: [
      { key: 'code', label: 'Code', placeholder: 'GFS' },
      { key: 'name', label: 'Name', required: true, placeholder: 'Global Forwarding Solutions' },
    ],
    ports: [
      { key: 'unlocode', label: 'UN/LOCODE', required: true, createOnly: true, placeholder: 'CNSHA' },
      { key: 'name', label: 'Name', required: true, placeholder: 'Shanghai' },
      { key: 'country', label: 'Country', placeholder: 'CN' },
      { key: 'mode', label: 'Mode', type: 'select', options: [{ value: 'sea', label: 'Sea' }, { value: 'air', label: 'Air' }] },
    ],
    consignees: [
      { key: 'name', label: 'Name', required: true },
      { key: 'address', label: 'Address' },
      { key: 'mapsToCustomerId', label: 'Maps to customer', type: 'select', options: customerOpts },
    ],
  }

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="page-title">Master data</h1>
        <span className="text-xs text-text-muted">customers &amp; vendors are an ERP mirror · forwarders / ports / consignees are Ops-maintained</span>
      </div>

      <div className="flex flex-wrap gap-1">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium capitalize transition-colors ${
              tab === t ? 'bg-cobalt-primary/15 text-cobalt-primary' : 'text-text-secondary hover:bg-surface-700'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'customers' && (
        <ReadOnlyTable note="ERP-synced · read-only" cols={[{ key: 'code', label: 'Code' }, { key: 'name', label: 'Name' }]} rows={customers.data ?? []} />
      )}
      {tab === 'vendors' && (
        <ReadOnlyTable
          note="ERP-synced · read-only"
          cols={[{ key: 'code', label: 'Code' }, { key: 'name', label: 'Name' }, { key: 'type', label: 'Type' }, { key: 'location', label: 'Location' }]}
          rows={vendors.data ?? []}
        />
      )}
      {tab === 'forwarders' && <EditableTable kind="forwarders" cols={editableCols.forwarders} rows={forwarders.data ?? []} />}
      {tab === 'ports' && <EditableTable kind="ports" cols={editableCols.ports} rows={ports.data ?? []} />}
      {tab === 'consignees' && <EditableTable kind="consignees" cols={editableCols.consignees} rows={consignees.data ?? []} />}
    </div>
  )
}
