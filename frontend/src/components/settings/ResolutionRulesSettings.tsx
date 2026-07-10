import { useState, type FormEvent } from 'react'
import { Card } from '../ui/Card'
import { cn } from '../../lib/utils'
import { Plus, Pencil, Ban, RotateCcw, Check, X } from 'lucide-react'
import {
  useResolutionFacts, useProposals,
  useCreateFact, usePatchFact, useDeactivateFact, useReactivateFact,
  useApproveProposal, useRejectProposal,
} from '../../hooks/use-resolution'
import { usePageAccess } from '../../hooks/use-page-access'

// Kinds offered in the CREATE form. The four retired alias kinds (vendor_alias / vendor_name_marker /
// forwarder_ref / customer_canonical) are hidden here — nothing reads them for resolution since the
// LLM Master Matcher landed (existing rows stay visible in the list as audit history).
const KINDS = [
  'customer_vendor', 'consignee_for_customer', 'customer_group', 'customer_role', 'vendor_group',
  // retrieval signal for the matcher: raw name/domain → boosted master code (the LLM still decides)
  'prior_correction',
  // port resolution tiers (data home for the committer's portByCodeOrName)
  'port_abbreviation', 'port_alias', 'port_iata', 'port_fragment',
]

export function ResolutionRulesSettings() {
  const { data: facts, isLoading, isError } = useResolutionFacts()
  const { data: proposals } = useProposals()
  const create = useCreateFact()
  const patch = usePatchFact()
  const deactivate = useDeactivateFact()
  const reactivate = useReactivateFact()
  const approve = useApproveProposal()
  const reject = useRejectProposal()
  const { canEdit: canEditPage } = usePageAccess()
  const canEdit = canEditPage('resolution_rules') // Access Control matrix; backend @PageWrite is authoritative
  const [showCreate, setShowCreate] = useState(false)

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-text-primary">Resolution Rules</h2>
          <p className="text-sm text-text-secondary">
            Curated alias / group / canonical facts served to the parser &amp; committer. App-owned (not ERP
            masters) — changes take effect immediately.
          </p>
        </div>
        {canEdit ? (
          <button
            onClick={() => setShowCreate(true)}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-cobalt-primary px-3 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            <Plus size={14} /> Add rule
          </button>
        ) : (
          <span className="shrink-0 text-xs text-text-muted">View-only access</span>
        )}
      </div>

      {proposals && proposals.length > 0 && (
        <Card className="overflow-x-auto p-0">
          <div className="border-b border-border px-4 py-2.5 text-xs font-medium text-text-muted">
            Pending proposals ({proposals.length}) — suggested by the curator from evidence
          </div>
          <table className="w-full text-sm">
            <tbody>
              {proposals.map((p) => (
                <tr key={p.id} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-2.5 text-text-secondary">{p.kind}</td>
                  <td className="px-4 py-2.5 text-text-primary">{p.lhs} → {p.rhs ?? '—'}</td>
                  <td className="px-4 py-2.5 text-text-muted">{p.reason}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      <button title="Approve" aria-label={`Approve ${p.lhs}`} onClick={() => approve.mutate(p.id)}
                        className="rounded-md p-1.5 text-text-muted hover:bg-surface-700 hover:text-cobalt-primary"><Check size={15} /></button>
                      <button title="Reject" aria-label={`Reject ${p.lhs}`} onClick={() => reject.mutate(p.id)}
                        className="rounded-md p-1.5 text-text-muted hover:bg-surface-700 hover:text-status-critical"><X size={15} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {isLoading && <div className="text-sm text-text-muted">Loading rules...</div>}
      {isError && <div className="text-sm text-status-critical">Failed to load rules. Try again.</div>}

      {facts && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-text-muted">
                <th className="px-4 py-3 font-medium">Kind</th>
                <th className="px-4 py-3 font-medium">From (lhs)</th>
                <th className="px-4 py-3 font-medium">To (rhs)</th>
                <th className="px-4 py-3 font-medium">Reason</th>
                <th className="px-4 py-3 font-medium">Source</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {facts.map((f) => (
                <tr key={f.id} className={cn('border-b border-border/60 last:border-0', !f.active && 'opacity-50')}>
                  <td className="px-4 py-3 text-text-secondary">{f.kind}</td>
                  <td className="px-4 py-3 font-medium text-text-primary">{f.lhs}</td>
                  <td className="px-4 py-3 text-text-secondary">{f.rhs ?? '—'}</td>
                  <td className="px-4 py-3 text-text-muted">
                    {f.reason ?? '—'}
                    {!f.active && (
                      <span className="ml-2 rounded-full bg-surface-600 px-2 py-0.5 text-[11px] font-medium text-text-muted">Inactive</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-surface-700 px-2 py-0.5 text-[11px] font-medium text-text-muted">{f.source}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button title="Edit reason" aria-label={`Edit reason for ${f.lhs}`}
                        onClick={() => {
                          const reason = window.prompt(`Reason for ${f.kind} ${f.lhs}:`, f.reason ?? '')
                          if (reason !== null) patch.mutate({ id: f.id, reason })
                        }}
                        className="rounded-md p-1.5 text-text-muted hover:bg-surface-700 hover:text-text-primary"><Pencil size={15} /></button>
                      {f.active ? (
                        <button title="Deactivate" aria-label={`Deactivate ${f.lhs}`}
                          onClick={() => { if (window.confirm(`Deactivate ${f.kind} ${f.lhs}? Consumers stop seeing it.`)) deactivate.mutate(f.id) }}
                          className="rounded-md p-1.5 text-text-muted hover:bg-surface-700 hover:text-status-critical"><Ban size={15} /></button>
                      ) : (
                        <button title="Reactivate" aria-label={`Reactivate ${f.lhs}`}
                          onClick={() => reactivate.mutate(f.id)}
                          className="rounded-md p-1.5 text-text-muted hover:bg-surface-700 hover:text-cobalt-primary"><RotateCcw size={15} /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {facts.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-sm text-text-muted">No rules yet. Add one to get started.</td></tr>
              )}
            </tbody>
          </table>
        </Card>
      )}

      {showCreate && (
        <CreateFactModal
          pending={create.isPending}
          onClose={() => setShowCreate(false)}
          onSubmit={(input) => create.mutate(input, { onSuccess: () => setShowCreate(false) })}
        />
      )}
    </div>
  )
}

function CreateFactModal(props: {
  pending: boolean
  onClose: () => void
  onSubmit: (input: { kind: string; lhs: string; rhs?: string; reason?: string }) => void
}) {
  const [kind, setKind] = useState('customer_group')
  const [lhs, setLhs] = useState('')
  const [rhs, setRhs] = useState('')
  const [reason, setReason] = useState('')

  function submit(e: FormEvent) {
    e.preventDefault()
    props.onSubmit({ kind, lhs: lhs.trim(), rhs: rhs.trim() || undefined, reason: reason.trim() || undefined })
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Add rule"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={props.onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit}
        className="w-full max-w-sm space-y-3 rounded-xl border border-border bg-surface-900 p-5">
        <h3 className="text-sm font-semibold text-text-primary">Add resolution rule</h3>
        <select aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value)}
          className="w-full rounded-lg border border-border bg-surface-800 px-3 py-2 text-sm text-text-primary focus:border-cobalt-primary focus:outline-none">
          {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <input required value={lhs} onChange={(e) => setLhs(e.target.value)} placeholder="From — observed text / code (lhs)"
          className="w-full rounded-lg border border-border bg-surface-800 px-3 py-2 text-sm text-text-primary focus:border-cobalt-primary focus:outline-none" />
        <input value={rhs} onChange={(e) => setRhs(e.target.value)} placeholder="To — resolved code / group (rhs)"
          className="w-full rounded-lg border border-border bg-surface-800 px-3 py-2 text-sm text-text-primary focus:border-cobalt-primary focus:outline-none" />
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)"
          className="w-full rounded-lg border border-border bg-surface-800 px-3 py-2 text-sm text-text-primary focus:border-cobalt-primary focus:outline-none" />
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={props.onClose}
            className="rounded-lg border border-border px-3 py-2 text-sm text-text-secondary hover:text-text-primary">Cancel</button>
          <button type="submit" disabled={props.pending}
            className="rounded-lg bg-cobalt-primary px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
            {props.pending ? 'Adding...' : 'Add rule'}
          </button>
        </div>
      </form>
    </div>
  )
}
