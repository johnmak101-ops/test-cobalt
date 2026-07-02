import { useMemo, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { useShipment } from '../hooks/use-shipments'
import { useConfirmShipment, useCorrectShipment } from '../hooks/use-review-queue'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { cn, formatDateTime, parsePONumbers } from '../lib/utils'
import {
  EDITABLE_FIELDS,
  buildCorrections,
  conflictColumns,
  toInputValue,
  type EditableField,
} from '../lib/review-fields'
import {
  ArrowLeft,
  AlertTriangle,
  CheckCircle,
  ExternalLink,
  Loader2,
  Mail,
  NotebookPen,
  Save,
} from 'lucide-react'

const SECTIONS: EditableField['section'][] = ['Order Info', 'Cargo', 'Shipping IDs', 'Key Dates']

/**
 * Review cockpit for one provisional shipment: shipment-detail-like layout where the fields are
 * EDITABLE. Conflicted fields (from the "why review?" reasons) are highlighted; a notes box feeds
 * the audit trail (harvested later to improve the agent soul). Corrections lock fields human-wins.
 */
export default function ReviewShipmentPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: shipment, isLoading } = useShipment(id!)
  const confirmMutation = useConfirmShipment()
  const correctMutation = useCorrectShipment()

  const [edits, setEdits] = useState<Record<string, string>>({})
  const [note, setNote] = useState('')

  const conflicts = useMemo(
    () => new Set(conflictColumns(shipment?.reviewReasons ?? [])),
    [shipment?.reviewReasons],
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
  const dirty = buildCorrections(
    original,
    Object.fromEntries(EDITABLE_FIELDS.map((f) => [f.uiKey, valueOf(f)])),
  )
  const dirtyCount = Object.keys(dirty).length
  const busy = confirmMutation.isPending || correctMutation.isPending

  const done = () => navigate('/review-queue')

  const handleApprove = () => {
    if (!id) return
    confirmMutation.mutate({ shipmentId: id, note }, { onSuccess: done })
  }

  const handleCorrectAndApprove = () => {
    if (!id || dirtyCount === 0) return
    correctMutation.mutate({ shipmentId: id, fields: dirty, reason: note }, { onSuccess: done })
  }

  const poTitle = parsePONumbers(shipment.poNumbers).join(', ')
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
            <div className="flex items-center gap-3">
              <h1 className="font-mono text-xl font-semibold text-text-primary">{title}</h1>
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
          <div className="mt-3 flex flex-wrap gap-1.5">
            {shipment.reviewReasons!.map((r, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 rounded-md bg-status-warning/15 px-2 py-1 text-[11px] font-medium text-status-warning"
              >
                <AlertTriangle size={10} className="shrink-0" />
                {r}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Editable field sections */}
      {SECTIONS.map((section) => (
        <Card key={section}>
          <h4 className="mb-4 text-sm font-semibold text-text-primary">{section}</h4>
          <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            {EDITABLE_FIELDS.filter((f) => f.section === section).map((f) => {
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
      ))}

      {/* Reviewer notes — audited, harvested to improve the agent soul */}
      <Card>
        <h4 className="mb-1 flex items-center gap-2 text-sm font-semibold text-text-primary">
          <NotebookPen size={14} className="text-text-muted" />
          Notes for the agent
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
          className="w-full rounded-lg border border-border bg-surface-900 p-3 text-sm text-text-primary placeholder:text-text-muted"
        />
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
      <div className="sticky bottom-4 flex items-center justify-end gap-2 rounded-xl border border-border bg-surface-800/95 p-3 shadow-lg backdrop-blur">
        {dirtyCount > 0 && (
          <span className="mr-auto text-xs text-text-muted">
            {dirtyCount} field{dirtyCount !== 1 ? 's' : ''} edited — corrections lock the field so
            the agent can never overwrite it
          </span>
        )}
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
          disabled={busy || dirtyCount === 0}
          className="inline-flex items-center gap-1.5 rounded-lg bg-cobalt-primary px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-cobalt-primary-light disabled:cursor-not-allowed disabled:opacity-50"
        >
          {correctMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
          Save corrections & Approve
        </button>
      </div>
    </div>
  )
}
