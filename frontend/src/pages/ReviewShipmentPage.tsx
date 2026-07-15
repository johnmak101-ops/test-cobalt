import { Fragment, useMemo, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useShipment, type FieldConflict } from '../hooks/use-shipments'
import { useShipmentHistory, type HistoryEntry } from '../hooks/use-shipment-history'
import {
  useConfirmShipment,
  useCorrectShipment,
  useDismissShipments,
  useRestoreShipment,
  isStaleConflict,
} from '../hooks/use-review-queue'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { ReviewCard } from '../components/review/ReviewCard'
import { cn, formatDateTime, parsePONumbers } from '../lib/utils'
import {
  EDITABLE_FIELDS,
  buildCorrections,
  conflictColumns,
  parseStyleEntries,
  serializeStyleEntries,
  toInputValue,
  type EditableField,
  type StyleEntry,
} from '../lib/review-fields'
import { humanizeReasons } from '../lib/review-reasons'
import {
  ArrowLeft,
  AlertTriangle,
  CheckCircle,
  ExternalLink,
  Loader2,
  Mail,
  NotebookPen,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  XCircle,
} from 'lucide-react'

const SECTIONS: EditableField['section'][] = ['Order Info', 'Cargo', 'Shipping IDs', 'Key Dates']

const openEmailPopup = (emailId: string) =>
  window.open(
    `/email/${emailId}?type=`,
    `email_${emailId}`,
    'popup,width=880,height=940,resizable=yes,scrollbars=yes',
  )

/** History rows carry two vocabularies: camelCase leg columns (per-email replay) and legacy
 *  snake_case audit names — normalize + alias so a conflicted column matches both. */
const AUDIT_ALIASES: Record<string, string> = {
  quantityshipped: 'qty',
  hblnumber: 'hblawbfcrno',
  voyagenumber: 'voyageno',
}
const normField = (f: string | null | undefined) => {
  const n = String(f ?? '').toLowerCase().replace(/_/g, '')
  return AUDIT_ALIASES[n] ?? n
}

/** One line in the evidence card: a competing value + where it came from. */
interface EvidenceEntry {
  key: string
  value: string
  source: string | null // doc type ("Invoice/Billing") or "manual edit" / "system"
  sourceEmailId: string | null // graph id → open the email
  when: string | null
}

/**
 * Per contested field: what each email said — the cross-check trail. Primary source is the
 * backend-computed fieldConflicts (the ≥2 co-current identity values, with their doc type), which works
 * even when the gate's reason is a bare count. Falls back to the audit history for any conflicted field
 * not covered there (e.g. a "backend conflict on gross_weight" naming a non-identity field).
 */
function ConflictEvidence({
  conflicts,
  fieldConflicts,
  history,
}: {
  conflicts: Set<string>
  fieldConflicts: FieldConflict[]
  history: HistoryEntry[]
}) {
  const byColumn = [...conflicts]
    .map((column) => {
      const fc = fieldConflicts.find((c) => c.column === column)
      if (fc) {
        return {
          column,
          label: fc.label,
          entries: fc.values.map((v, i): EvidenceEntry => ({
            key: `${column}-${i}`,
            value: v.value,
            source: v.docType,
            sourceEmailId: v.sourceEmailId,
            when: null,
          })),
        }
      }
      const entries = history
        .filter((h) => normField(h.field) === normField(column))
        .map((e): EvidenceEntry => ({
          key: e.id,
          value: e.newValue ?? '(cleared)',
          source: e.sourceType === 'email' ? e.notes ?? 'source email' : e.sourceType === 'manual' ? 'manual edit' : 'system',
          sourceEmailId: e.sourceType === 'email' ? e.sourceId : null,
          when: e.changedAt,
        }))
      return { column, label: EDITABLE_FIELDS.find((f) => f.column === column)?.label ?? column, entries }
    })
    .filter((g) => g.entries.length > 0)
  if (byColumn.length === 0) return null

  return (
    <Card className="border-status-warning/40">
      <h4 className="mb-1 flex items-center gap-2 text-sm font-semibold text-text-primary">
        <AlertTriangle size={14} className="text-status-warning" />
        Conflicting values — what each email said
      </h4>
      <p className="mb-4 text-xs text-text-muted">
        These fields got different values from different emails. Open a source to cross-check, then
        correct the field below (or approve as-is if the value shown is right).
      </p>
      <div className="space-y-4">
        {byColumn.map((g) => (
          <div key={g.column}>
            <p className="mb-1.5 text-xs font-medium text-status-warning">{g.label}</p>
            <div className="space-y-1">
              {g.entries.map((e) => (
                <div key={e.key} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg bg-surface-900 px-3 py-2">
                  <span className="break-all font-mono text-sm text-text-primary">{e.value || '(blank)'}</span>
                  {e.sourceEmailId ? (
                    <button
                      onClick={() => openEmailPopup(e.sourceEmailId!)}
                      title="Open the source email"
                      className="inline-flex min-w-0 max-w-full items-center gap-1 text-left text-xs text-text-muted hover:text-cobalt-primary-light hover:underline"
                    >
                      <Mail size={11} className="shrink-0" />
                      <span className="truncate">{e.source ?? 'source email'}</span>
                      <ExternalLink size={10} className="shrink-0" />
                    </button>
                  ) : (
                    e.source && <span className="text-xs text-text-muted">{e.source}</span>
                  )}
                  {e.when && <span className="ml-auto font-mono text-[11px] text-text-muted">{formatDateTime(e.when)}</span>}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

/**
 * Review cockpit for one provisional shipment: shipment-detail-like layout where the fields are
 * EDITABLE. Conflicted fields (from the "why review?" reasons) are highlighted; a notes box feeds
 * the audit trail (harvested later to improve the agent soul). Corrections lock fields human-wins.
 */
export default function ReviewShipmentPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: shipment, isLoading, refetch } = useShipment(id!)
  const { data: historyData } = useShipmentHistory(id!)
  const confirmMutation = useConfirmShipment()
  const correctMutation = useCorrectShipment()
  const dismissMutation = useDismissShipments()
  const restoreMutation = useRestoreShipment()

  const [edits, setEdits] = useState<Record<string, string>>({})
  const [styleRows, setStyleRows] = useState<StyleEntry[] | null>(null)
  const [note, setNote] = useState('')
  const [staleBanner, setStaleBanner] = useState<string | null>(null)

  // Contested fields come from two sources: reason strings that NAME fields ("backend conflict on qty,…")
  // and — when the reason is a bare count ("N unresolved field conflict(s)") — the backend-computed
  // fieldConflicts (identity types with ≥2 co-current values). Union both so the field highlights either way.
  const conflicts = useMemo(
    () =>
      new Set([
        ...conflictColumns(shipment?.reviewReasons ?? []),
        ...(shipment?.fieldConflicts ?? []).map((c) => c.column),
      ]),
    [shipment?.reviewReasons, shipment?.fieldConflicts],
  )

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <span className="text-sm text-text-muted">Loading shipment for review...</span>
      </div>
    )
  }

  if (!shipment) {
    return (
      <div className="flex h-64 items-center justify-center">
        <span className="text-sm text-text-muted">Shipment not found</span>
      </div>
    )
  }

  const original = shipment as unknown as Record<string, unknown>
  const valueOf = (f: EditableField) => edits[f.uiKey] ?? toInputValue(original[f.uiKey], f.type)

  // Items/Styles table editor state: rows live locally (so empty just-added rows survive),
  // the serialized value feeds edits['itemStyleNo'] only when it truly differs from the original.
  const baseStyle = toInputValue(original['itemStyleNo'], 'text')
  const rows = styleRows ?? parseStyleEntries(baseStyle)
  const updateStyleRows = (next: StyleEntry[]) => {
    setStyleRows(next)
    const serialized = serializeStyleEntries(next)
    setEdits((prev) => {
      const out = { ...prev }
      if (serialized === serializeStyleEntries(parseStyleEntries(baseStyle))) delete out['itemStyleNo']
      else out['itemStyleNo'] = serialized
      return out
    })
  }
  const dirty = buildCorrections(
    original,
    Object.fromEntries(EDITABLE_FIELDS.map((f) => [f.uiKey, valueOf(f)])),
  )
  const dirtyCount = Object.keys(dirty).length
  const busy = confirmMutation.isPending || correctMutation.isPending || dismissMutation.isPending || restoreMutation.isPending

  const done = () => navigate('/review-queue')

  const handleStale = async (err: unknown) => {
    if (!isStaleConflict(err)) throw err
    setStaleBanner('This shipment was modified elsewhere — reloading so you can retry with the latest values.')
    await refetch()
    void queryClient.invalidateQueries({ queryKey: ['shipment', id] })
  }

  const expectedUpdatedAt = shipment.updatedAt

  const handleApprove = () => {
    if (!id) return
    setStaleBanner(null)
    confirmMutation.mutate(
      { shipmentId: id, note, expectedUpdatedAt },
      {
        onSuccess: done,
        onError: (err) => {
          void handleStale(err).catch(() => setStaleBanner('Approve failed.'))
        },
      },
    )
  }

  // A note is mandatory when saving corrections — it's the feedback harvested for agent-soul iteration.
  const correctBlocked = dirtyCount > 0 && !note.trim()
  const handleCorrectAndApprove = () => {
    if (!id || dirtyCount === 0 || !note.trim()) return
    setStaleBanner(null)
    correctMutation.mutate(
      { shipmentId: id, fields: dirty, reason: note.trim(), expectedUpdatedAt },
      {
        onSuccess: done,
        onError: (err) => {
          void handleStale(err).catch(() => setStaleBanner('Save failed.'))
        },
      },
    )
  }

  const isDismissed = !!shipment.dismissedAt

  const handleDismiss = () => {
    if (!id) return
    dismissMutation.mutate({ shipmentIds: [id], note }, { onSuccess: done })
  }
  const handleRestore = () => {
    if (!id) return
    restoreMutation.mutate({ shipmentId: id })
  }

  const poList = parsePONumbers(shipment.poNumbers)
  const poTitle = poList.slice(0, 3).join(', ') + (poList.length > 3 ? ` +${poList.length - 3} POs` : '')
  const title = shipment.bookingNo ?? shipment.soNumber ?? (poTitle || 'Shipment')

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <button
          onClick={() => navigate('/review-queue')}
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text-primary"
        >
          <ArrowLeft size={14} />
          Back to Review Queue
        </button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-3">
              <h1 className="truncate font-mono text-xl font-semibold text-text-primary">{title}</h1>
              <Badge variant="status" value={shipment.status} />
            </div>
            <p className="mt-1 text-sm text-text-secondary">
              {shipment.customer?.name ?? 'Unknown customer'}
              {shipment.forwarder && ` · ${shipment.forwarder.name}`}
              {shipment.route && ` · ${shipment.route}`}
            </p>
          </div>
          <Link
            to={`/shipments/${shipment.id}`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-surface-700 px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-600 hover:text-text-primary"
          >
            <ExternalLink size={13} />
            Open full shipment
          </Link>
        </div>
        {(shipment.reviewReasons?.length ?? 0) > 0 && (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-text-secondary">
            {humanizeReasons(shipment.reviewReasons!).map(({ raw, text }) => (
              <li key={raw} title={raw}>
                {text}
              </li>
            ))}
          </ul>
        )}
      </div>

      {staleBanner && (
        <div className="rounded-lg border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-xs text-status-warning">
          {staleBanner}
        </div>
      )}

      {/* Critic conflict card — read-only AI triage context (band + AI comment + conflicts). The
          editable field sections below own the single note + approve path, so there is no duplicate
          note/approve on this page. Interactive conflict resolution lives in the Review Queue's inline
          card; the detail page is the deep-edit surface. */}
      {(shipment.criticReview || shipment.reviewStatus === 'provisional') && (
        <ReviewCard
          shipment={shipment}
          criticReview={shipment.criticReview ?? null}
          emails={shipment.emails ?? []}
          defaultExpanded
          readOnly
        />
      )}

      {/* Which fields conflict, what each email said, and where to cross-check */}
      <ConflictEvidence
        conflicts={conflicts}
        fieldConflicts={shipment.fieldConflicts ?? []}
        history={historyData?.history ?? []}
      />

      {/* Editable field sections (Items/Styles table follows Order Info) */}
      {SECTIONS.map((section) => (
        <Fragment key={section}>
        <Card>
          <h4 className="mb-4 text-sm font-semibold text-text-primary">{section}</h4>
          <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            {EDITABLE_FIELDS.filter((f) => f.section === section && f.uiKey !== 'itemStyleNo').map((f) => {
              const contested = conflicts.has(f.column)
              const changed = f.column in dirty
              return (
                <label key={f.uiKey} className="block">
                  <span
                    className={cn(
                      'flex items-center gap-1 text-xs',
                      contested ? 'font-medium text-status-warning' : 'text-text-muted',
                    )}
                  >
                    {contested && <AlertTriangle size={10} />}
                    {f.label}
                    {changed && <span className="text-cobalt-primary-light">· edited</span>}
                  </span>
                  <input
                    type={f.type === 'number' ? 'number' : f.type === 'date' ? 'datetime-local' : 'text'}
                    value={valueOf(f)}
                    onChange={(e) => setEdits((prev) => ({ ...prev, [f.uiKey]: e.target.value }))}
                    className={cn(
                      'mt-1 h-9 w-full rounded-lg border bg-surface-900 px-3 text-sm text-text-primary placeholder:text-text-muted',
                      contested ? 'border-status-warning/60' : 'border-border',
                      changed && 'border-cobalt-primary',
                    )}
                  />
                </label>
              )
            })}
          </div>
        </Card>
        {section === 'Order Info' && (
      <Card className={cn(conflicts.has('itemStyleNo') && 'border-status-warning/60')}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h4
            className={cn(
              'flex items-center gap-1.5 text-sm font-semibold',
              conflicts.has('itemStyleNo') ? 'text-status-warning' : 'text-text-primary',
            )}
          >
            {conflicts.has('itemStyleNo') && <AlertTriangle size={13} />}
            Items / Styles
            {'itemStyleNo' in dirty && <span className="text-xs font-normal text-cobalt-primary-light">· edited</span>}
          </h4>
          <button
            onClick={() => updateStyleRows([...rows, { po: '', style: '' }])}
            className="inline-flex items-center gap-1 rounded-lg bg-surface-700 px-2.5 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-600 hover:text-text-primary"
          >
            <Plus size={12} />
            Add row
          </button>
        </div>
        {rows.length === 0 ? (
          <p className="text-xs text-text-muted">No items/styles recorded — add a row to enter them.</p>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full max-w-2xl text-sm">
            <thead>
              <tr className="text-left text-xs text-text-muted">
                <th className="pb-1.5 pr-3 font-medium">PO No.</th>
                <th className="pb-1.5 pr-3 font-medium">Style / Item No.</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  <td className="py-1 pr-3">
                    <input
                      value={row.po}
                      placeholder="(no PO)"
                      onChange={(e) =>
                        updateStyleRows(rows.map((r, j) => (j === i ? { ...r, po: e.target.value } : r)))
                      }
                      className="h-9 w-full rounded-lg border border-border bg-surface-900 px-3 font-mono text-sm text-text-primary placeholder:text-text-muted"
                    />
                  </td>
                  <td className="py-1 pr-3">
                    <input
                      value={row.style}
                      placeholder="e.g. LKN18360L15"
                      onChange={(e) =>
                        updateStyleRows(rows.map((r, j) => (j === i ? { ...r, style: e.target.value } : r)))
                      }
                      className="h-9 w-full rounded-lg border border-border bg-surface-900 px-3 font-mono text-sm text-text-primary placeholder:text-text-muted"
                    />
                  </td>
                  <td className="py-1">
                    <button
                      onClick={() => updateStyleRows(rows.filter((_, j) => j !== i))}
                      title="Remove row"
                      className="rounded-lg p-2 text-text-muted hover:bg-surface-700 hover:text-status-critical"
                    >
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </Card>
        )}
        </Fragment>
      ))}

      {/* Reviewer notes — audited, harvested to improve the agent soul */}
      <Card>
        <h4 className="mb-1 flex items-center gap-2 text-sm font-semibold text-text-primary">
          <NotebookPen size={14} className="text-text-muted" />
          Notes for the agent
          {dirtyCount > 0 && <span className="text-xs font-normal text-status-warning">· required to save corrections</span>}
        </h4>
        <p className="mb-3 text-xs text-text-muted">
          What did the agent get wrong, and how should it decide next time? Saved to the audit
          trail with your decision — used to improve extraction rules.
        </p>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="e.g. qty came from the wrong 进仓单 column — use the CTNS column, not the pieces column"
          className={cn(
            'w-full rounded-lg border bg-surface-900 p-3 text-sm text-text-primary placeholder:text-text-muted',
            correctBlocked ? 'border-status-warning/60' : 'border-border',
          )}
        />
        {correctBlocked && (
          <p className="mt-1.5 text-xs text-status-warning">
            Add a note to save your {dirtyCount} correction{dirtyCount !== 1 ? 's' : ''}.
          </p>
        )}
      </Card>

      {/* Related emails (evidence) */}
      {shipment.emails && shipment.emails.length > 0 && (
        <Card>
          <h4 className="mb-4 text-sm font-semibold text-text-primary">Related Emails</h4>
          <div className="space-y-2">
            {shipment.emails.map((email) => (
              <div
                key={email.id}
                onClick={() =>
                  window.open(
                    `/email/${email.id}?type=${encodeURIComponent(email.emailType ?? '')}`,
                    `email_${email.id}`,
                    'popup,width=880,height=940,resizable=yes,scrollbars=yes',
                  )
                }
                className="flex cursor-pointer items-center gap-3 rounded-lg bg-surface-900 p-3 transition-colors hover:bg-surface-700"
              >
                <Mail size={14} className="shrink-0 text-text-muted" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-text-primary">{email.subject}</p>
                  <p className="text-xs text-text-muted">
                    {email.sender} · <span className="font-mono">{formatDateTime(email.receivedAt)}</span>
                  </p>
                </div>
                {email.emailType && <Badge variant="emailType" value={email.emailType} />}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Actions */}
      <div className="sticky bottom-4 flex flex-wrap items-center justify-end gap-2 rounded-xl border border-border bg-surface-800/95 p-3 shadow-lg backdrop-blur">
        {isDismissed ? (
          <>
            <span className="mr-auto inline-flex items-center gap-1.5 text-xs text-status-critical">
              <XCircle size={13} />
              Dismissed from review — not a trackable shipment. Restore it to approve or correct.
            </span>
            <button
              onClick={handleRestore}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-surface-700 px-3 py-2 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-600 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {restoreMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
              Restore to queue
            </button>
          </>
        ) : (
          <>
            {dirtyCount > 0 && (
              <span className="mr-auto text-xs text-text-muted">
                {dirtyCount} field{dirtyCount !== 1 ? 's' : ''} edited — corrections lock the field so
                the agent can never overwrite it
              </span>
            )}
            <button
              onClick={handleDismiss}
              disabled={busy}
              title="Not a trackable shipment (portal echo / no carrier move) — removes it from the queue; reversible. Your note is saved to the audit trail."
              className="inline-flex items-center gap-1.5 rounded-lg bg-status-critical/15 px-3 py-2 text-xs font-medium text-status-critical transition-colors hover:bg-status-critical/25 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {dismissMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <XCircle size={13} />}
              Dismiss — not a shipment
            </button>
            <button
              onClick={handleApprove}
              disabled={busy || dirtyCount > 0}
              title={dirtyCount > 0 ? 'You have unsaved corrections — use "Save corrections & Approve"' : undefined}
              className="inline-flex items-center gap-1.5 rounded-lg bg-status-success/15 px-3 py-2 text-xs font-medium text-status-success transition-colors hover:bg-status-success/25 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {confirmMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle size={13} />}
              Approve as-is
            </button>
            <button
              onClick={handleCorrectAndApprove}
              disabled={busy || dirtyCount === 0 || correctBlocked}
              title={correctBlocked ? 'Add a note for the agent before saving corrections' : undefined}
              className="inline-flex items-center gap-1.5 rounded-lg bg-cobalt-primary px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-cobalt-primary-light disabled:cursor-not-allowed disabled:opacity-50"
            >
              {correctMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              Save corrections & Approve
            </button>
          </>
        )}
      </div>
    </div>
  )
}
