import { useEffect, useEffectEvent } from 'react'
import { createPortal } from 'react-dom'
import { X, FileText, Link2, ExternalLink, Ban, Loader2, Package } from 'lucide-react'
import { useDocument, useDismissDocument, type UnlinkedDocument } from '../../hooks/use-documents'
import { Badge } from '../ui/Badge'
import { formatShortDate } from '../../lib/utils'

function formatQty(qty: number | null, unit: string | null): string {
  if (qty == null) return '—'
  return `${qty.toLocaleString()}${unit ? ` ${unit}` : ''}`
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-b border-border py-2.5 last:border-0">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">{label}</span>
      <div className="text-sm text-text-primary">{children}</div>
    </div>
  )
}

/**
 * Right-side inspect drawer for an unlinked document. Fetches full detail (GET /api/documents/:id)
 * on open, then offers three actions: view the source email pop-up, link to a shipment, or dismiss.
 */
export function DocumentDetailDrawer({
  document: row,
  onClose,
  onLink,
}: {
  document: UnlinkedDocument | null
  onClose: () => void
  onLink: (doc: UnlinkedDocument) => void
}) {
  const { data: detail, isLoading, isError } = useDocument(row?.id ?? null)
  const dismissMutation = useDismissDocument()
  const onCloseEvent = useEffectEvent(onClose)

  // Close on Escape.
  useEffect(() => {
    if (!row) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseEvent()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [row])

  // Reset transient mutation state when a different document is opened.
  useEffect(() => {
    dismissMutation.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.id])

  if (!row) return null

  // Prefer freshly-fetched detail; fall back to the row while the fetch is in flight.
  const customer = detail?.customer ?? row.customer
  const emailType = detail?.emailType ?? row.emailType
  const senderType = detail?.senderType ?? row.senderType
  const poNumbers = detail?.poNumbers ?? row.poNumbers
  const poCount = detail?.poCount ?? row.poCount
  const qty = detail?.qty ?? row.qty
  const qtyUnit = detail?.qtyUnit ?? row.qtyUnit
  const receivedAt = detail?.receivedAt ?? row.receivedAt
  const emailId = detail?.emailId ?? null

  const openSourceEmail = () => {
    if (!emailId) return
    window.open(
      `/email/${emailId}?type=${encodeURIComponent(emailType ?? '')}`,
      `email_${emailId}`,
      'popup,width=880,height=940,resizable=yes,scrollbars=yes',
    )
  }

  const handleDismiss = () => {
    dismissMutation.mutate(row.id, { onSuccess: () => onClose() })
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-md flex-col overflow-hidden border-l border-border bg-surface-800 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div className="flex min-w-0 items-start gap-2.5">
            <FileText size={16} className="mt-0.5 shrink-0 text-text-muted" />
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-text-primary">Document detail</h3>
              <p className="mt-0.5 truncate text-xs text-text-muted">
                {customer ?? 'Unknown customer'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-1.5 text-text-muted hover:bg-surface-700 hover:text-text-primary"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-4">
          {isError ? (
            <div className="rounded-lg border border-status-critical/30 bg-status-critical/10 px-3 py-2 text-xs text-status-critical">
              Failed to load document detail.
            </div>
          ) : (
            <>
              {isLoading && (
                <div className="mb-3 flex items-center gap-2 text-xs text-text-muted">
                  <Loader2 size={13} className="animate-spin" />
                  Loading latest detail…
                </div>
              )}
              <Field label="Customer">{customer ?? '—'}</Field>
              <Field label="Email type">
                {emailType ? <Badge variant="emailType" value={emailType} /> : '—'}
              </Field>
              <Field label="Sender">{senderType ?? '—'}</Field>
              <Field label="PO numbers">
                {poCount > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {poNumbers.map((po) => (
                      <span
                        key={po}
                        className="rounded-md bg-surface-700 px-1.5 py-0.5 font-mono text-[11px] text-cobalt-primary-light"
                      >
                        {po}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="inline-flex items-center gap-1 text-text-muted">
                    <Package size={12} />
                    No POs
                  </span>
                )}
              </Field>
              <Field label="Quantity">{formatQty(qty, qtyUnit)}</Field>
              <Field label="Received">{formatShortDate(receivedAt)}</Field>
            </>
          )}
        </div>

        {/* Actions */}
        <div className="space-y-2 border-t border-border p-4">
          {dismissMutation.isError && (
            <p className="text-xs text-status-critical">Failed to dismiss — please try again.</p>
          )}
          <button
            type="button"
            onClick={openSourceEmail}
            disabled={!emailId}
            title={emailId ? undefined : 'No source email available for this document'}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-surface-700 px-3 py-2 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-600 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ExternalLink size={14} />
            View source email
          </button>
          <button
            type="button"
            onClick={() => onLink(row)}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-cobalt-primary px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-cobalt-primary-light"
          >
            <Link2 size={14} />
            Link to shipment
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            disabled={dismissMutation.isPending}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-status-critical/30 px-3 py-2 text-xs font-medium text-status-critical transition-colors hover:bg-status-critical/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {dismissMutation.isPending ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Ban size={14} />
            )}
            Dismiss (not a shipment)
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
