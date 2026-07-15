import { useState, type FormEvent, type ReactNode } from 'react'
import { Card } from '../ui/Card'
import { cn } from '../../lib/utils'
import { Plus, Pencil, Ban, RotateCcw, Check, X } from 'lucide-react'
import {
  useResolutionFacts, useProposals, useUnmatchedMasters,
  useCreateFact, usePatchFact, useDeactivateFact, useReactivateFact,
  useApproveProposal, useRejectProposal,
} from '../../hooks/use-resolution'
import { usePageAccess } from '../../hooks/use-page-access'

/** Create-form options: API kind code + human label (never show raw column names like lhs/rhs). */
const KIND_OPTIONS: { value: string; label: string; hint: string }[] = [
  { value: 'customer_vendor', label: 'Customer ↔ vendor', hint: 'Buyer code → related factory/vendor code' },
  { value: 'consignee_for_customer', label: 'Consignee for customer', hint: 'Customer code → default consignee' },
  { value: 'customer_group', label: 'Customer group', hint: 'Customer code → buyer group (e.g. SEH → PRIMARK)' },
  { value: 'customer_role', label: 'Customer role', hint: 'Customer code → bill-to / importer / booking entity' },
  { value: 'vendor_group', label: 'Vendor group', hint: 'Vendor code → vendor group' },
  { value: 'prior_correction', label: 'Prior correction', hint: 'Observed name or domain → master code (matcher boost)' },
  { value: 'port_abbreviation', label: 'Port abbreviation', hint: 'Short port label → UN/LOCODE' },
  { value: 'port_alias', label: 'Port alias', hint: 'Alternate port name → UN/LOCODE' },
  { value: 'port_iata', label: 'Port IATA', hint: 'Airport IATA → UN/LOCODE' },
  { value: 'port_fragment', label: 'Port name fragment', hint: 'Name fragment → UN/LOCODE' },
  { value: 'forwarder_alias', label: 'Forwarder alias', hint: 'Raw forwarder name → master code (exact, committer)' },
  { value: 'platform_not_forwarder', label: 'Not a forwarder (platform)', hint: 'Portal/notification name pattern (never link as forwarder)' },
  { value: 'genuine_short_brand', label: 'Genuine short brand', hint: 'Short brand codes that are real brands (not customer echoes)' },
  { value: 'self_identity', label: 'Our company name', hint: 'Pattern for Cobalt / self identity in party text' },
]

const KIND_LABEL: Record<string, string> = Object.fromEntries([
  ...KIND_OPTIONS.map((k) => [k.value, k.label] as const),
  // retired kinds still appear in the list as audit history
  ['vendor_alias', 'Vendor alias (retired)'],
  ['vendor_name_marker', 'Vendor name marker (retired)'],
  ['forwarder_ref', 'Forwarder reference (retired)'],
  ['customer_canonical', 'Customer canonical (retired)'],
])

function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind.replace(/_/g, ' ')
}

const SOURCE_LABEL: Record<string, string> = {
  seed: 'Seed',
  ops: 'Ops',
  curator: 'Curator',
}

/** Alias kinds retired after the LLM Master Matcher — list-only audit; create form does not offer them. */
const RETIRED_KINDS = new Set([
  'vendor_alias',
  'vendor_name_marker',
  'forwarder_ref',
  'customer_canonical',
])

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
  const [editReason, setEditReason] = useState<{ id: string; label: string; reason: string } | null>(null)
  const [confirmDeactivate, setConfirmDeactivate] = useState<{ id: string; label: string } | null>(null)
  const unmatched = useUnmatchedMasters()

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-text-primary">Resolution Rules</h2>
          <p className="text-sm text-text-secondary">
            Curated mappings for the parser and committer (groups, ports, brands). App-owned — not ERP
            masters. Changes take effect immediately for both ShipTrack and the queue.
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

      {/* Unmatched raw values — teach via port_alias / forwarder_alias above (#145) */}
      <Card className="overflow-x-auto p-0">
        <div className="border-b border-border px-4 py-2.5 text-xs font-medium text-text-muted">
          Unmatched values on live legs
          {unmatched.data ? ` (${unmatched.data.length})` : ''} — add a Port alias or Forwarder alias rule to resolve
        </div>
        {unmatched.isLoading ? (
          <p className="px-4 py-3 text-sm text-text-muted">Loading unmatched…</p>
        ) : unmatched.isError ? (
          <p className="px-4 py-3 text-sm text-status-critical">Could not load unmatched values.</p>
        ) : !unmatched.data?.length ? (
          <p className="px-4 py-3 text-sm text-text-muted">No unmatched forwarder/port raw values.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-900/50 text-left text-[11px] text-text-muted">
                <th className="px-4 py-2 font-medium">Field</th>
                <th className="px-4 py-2 font-medium">Value</th>
                <th className="px-4 py-2 font-medium text-right">Legs affected</th>
              </tr>
            </thead>
            <tbody>
              {unmatched.data.map((row) => (
                <tr key={`${row.field}:${row.value}`} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-2 text-text-secondary">{row.field}</td>
                  <td className="px-4 py-2 font-mono text-text-primary">{row.value}</td>
                  <td className="px-4 py-2 text-right font-mono text-text-secondary">{row.legsAffected}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {proposals && proposals.length > 0 && (
        <Card className="overflow-x-auto p-0">
          <div className="border-b border-border px-4 py-2.5 text-xs font-medium text-text-muted">
            Pending proposals ({proposals.length}) — suggested from evidence
          </div>
          <table className="w-full text-sm">
            <tbody>
              {proposals.map((p) => (
                <tr key={p.id} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-2.5 text-text-secondary">{kindLabel(p.kind)}</td>
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
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">From</th>
                <th className="px-4 py-3 font-medium">To</th>
                <th className="px-4 py-3 font-medium">Reason</th>
                <th className="px-4 py-3 font-medium">Source</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {facts.map((f) => (
                <tr key={f.id} className={cn('border-b border-border/60 last:border-0', !f.active && 'opacity-50')}>
                  <td className="px-4 py-3 text-text-secondary">
                    <span className="inline-flex flex-wrap items-center gap-1.5">
                      {kindLabel(f.kind)}
                      {RETIRED_KINDS.has(f.kind) && (
                        <span
                          title="Retired after LLM Master Matcher — kept for audit; not offered in Add rule"
                          className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400"
                        >
                          Retired
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-medium text-text-primary">{f.lhs}</td>
                  <td className="px-4 py-3 text-text-secondary">{f.rhs ?? '—'}</td>
                  <td className="px-4 py-3 text-text-muted">
                    {f.reason ?? '—'}
                    {!f.active && (
                      <span className="ml-2 rounded-full bg-surface-600 px-2 py-0.5 text-[11px] font-medium text-text-muted">Inactive</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-surface-700 px-2 py-0.5 text-[11px] font-medium text-text-muted">
                      {SOURCE_LABEL[f.source] ?? f.source}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button title="Edit reason" aria-label={`Edit reason for ${f.lhs}`}
                        onClick={() => setEditReason({
                          id: f.id,
                          label: `${kindLabel(f.kind)} · ${f.lhs}`,
                          reason: f.reason ?? '',
                        })}
                        className="rounded-md p-1.5 text-text-muted hover:bg-surface-700 hover:text-text-primary"><Pencil size={15} /></button>
                      {f.active ? (
                        <button title="Deactivate" aria-label={`Deactivate ${f.lhs}`}
                          onClick={() => setConfirmDeactivate({
                            id: f.id,
                            label: `${kindLabel(f.kind)} · ${f.lhs}`,
                          })}
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

      {editReason && (
        <EditReasonModal
          label={editReason.label}
          initialReason={editReason.reason}
          pending={patch.isPending}
          onClose={() => setEditReason(null)}
          onSubmit={(reason) => {
            patch.mutate(
              { id: editReason.id, reason },
              { onSuccess: () => setEditReason(null) },
            )
          }}
        />
      )}

      {confirmDeactivate && (
        <ConfirmModal
          title="Deactivate rule?"
          body={
            <>
              <span className="font-medium text-text-primary">{confirmDeactivate.label}</span>
              {' '}will stop being used by the parser and committer. You can reactivate it later.
            </>
          }
          confirmLabel={deactivate.isPending ? 'Deactivating…' : 'Deactivate'}
          pending={deactivate.isPending}
          danger
          onClose={() => setConfirmDeactivate(null)}
          onConfirm={() => {
            deactivate.mutate(confirmDeactivate.id, {
              onSuccess: () => setConfirmDeactivate(null),
            })
          }}
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
  const [kind, setKind] = useState(KIND_OPTIONS[0]!.value)
  const [lhs, setLhs] = useState('')
  const [rhs, setRhs] = useState('')
  const [reason, setReason] = useState('')
  const selected = KIND_OPTIONS.find((k) => k.value === kind) ?? KIND_OPTIONS[0]!

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
        <div>
          <label className="mb-1 block text-xs text-text-muted">Type</label>
          <select aria-label="Type" value={kind} onChange={(e) => setKind(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface-800 px-3 py-2 text-sm text-text-primary focus:border-cobalt-primary focus:outline-none">
            {KIND_OPTIONS.map((k) => (
              <option key={k.value} value={k.value}>{k.label}</option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-text-muted">{selected.hint}</p>
        </div>
        <div>
          <label className="mb-1 block text-xs text-text-muted">From</label>
          <input required value={lhs} onChange={(e) => setLhs(e.target.value)}
            placeholder="Observed text, code, or pattern"
            className="w-full rounded-lg border border-border bg-surface-800 px-3 py-2 text-sm text-text-primary focus:border-cobalt-primary focus:outline-none" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-text-muted">To</label>
          <input value={rhs} onChange={(e) => setRhs(e.target.value)}
            placeholder="Resolved code or group (optional for some types)"
            className="w-full rounded-lg border border-border bg-surface-800 px-3 py-2 text-sm text-text-primary focus:border-cobalt-primary focus:outline-none" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-text-muted">Reason</label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional note"
            className="w-full rounded-lg border border-border bg-surface-800 px-3 py-2 text-sm text-text-primary focus:border-cobalt-primary focus:outline-none" />
        </div>
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

function EditReasonModal(props: {
  label: string
  initialReason: string
  pending: boolean
  onClose: () => void
  onSubmit: (reason: string) => void
}) {
  const [reason, setReason] = useState(props.initialReason)

  function submit(e: FormEvent) {
    e.preventDefault()
    props.onSubmit(reason.trim())
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Edit reason"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={props.onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit}
        className="w-full max-w-sm space-y-3 rounded-xl border border-border bg-surface-900 p-5">
        <h3 className="text-sm font-semibold text-text-primary">Edit reason</h3>
        <p className="text-xs text-text-muted">{props.label}</p>
        <input
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Optional note"
          className="w-full rounded-lg border border-border bg-surface-800 px-3 py-2 text-sm text-text-primary focus:border-cobalt-primary focus:outline-none"
        />
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={props.onClose}
            className="rounded-lg border border-border px-3 py-2 text-sm text-text-secondary hover:text-text-primary">Cancel</button>
          <button type="submit" disabled={props.pending}
            className="rounded-lg bg-cobalt-primary px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
            {props.pending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  )
}

function ConfirmModal(props: {
  title: string
  body: ReactNode
  confirmLabel: string
  pending?: boolean
  danger?: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <div role="dialog" aria-modal="true" aria-label={props.title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={props.onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm space-y-3 rounded-xl border border-border bg-surface-900 p-5">
        <h3 className="text-sm font-semibold text-text-primary">{props.title}</h3>
        <p className="text-sm text-text-secondary">{props.body}</p>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={props.onClose}
            className="rounded-lg border border-border px-3 py-2 text-sm text-text-secondary hover:text-text-primary">Cancel</button>
          <button
            type="button"
            disabled={props.pending}
            onClick={props.onConfirm}
            className={cn(
              'rounded-lg px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50',
              props.danger ? 'bg-status-critical' : 'bg-cobalt-primary',
            )}
          >
            {props.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
