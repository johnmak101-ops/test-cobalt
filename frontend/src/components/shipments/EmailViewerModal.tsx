import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, Mail, Paperclip } from 'lucide-react'
import { useEmailBody, useEmailAttachments } from '../../hooks/use-emails'
import { formatDate } from '../../lib/utils'

export interface RelatedEmail {
  id: string
  subject: string
  sender: string
  receivedAt: string | null
  emailType?: string | null
}

/** Read-only viewer for a single email (the shipment-detail "Related Emails" click target).
 *  Body + attachments are lazy-loaded by message id; raw HTML is NOT rendered (XSS) — we show
 *  the extracted plain text. */
export function EmailViewerModal({ email, onClose }: { email: RelatedEmail | null; onClose: () => void }) {
  const { data: body, isLoading } = useEmailBody(email?.id)
  const { data: atts } = useEmailAttachments(email?.id)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!email) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-surface-800 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div className="flex min-w-0 items-start gap-2.5">
            <Mail size={16} className="mt-0.5 shrink-0 text-text-muted" />
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-text-primary">{email.subject}</h3>
              <p className="mt-0.5 text-xs text-text-muted">
                {email.sender}
                {email.receivedAt ? ` · ${formatDate(email.receivedAt)}` : ''}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-lg p-1.5 text-text-muted hover:bg-surface-700 hover:text-text-primary"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-4">
          {isLoading ? (
            <p className="text-sm text-text-muted">Loading…</p>
          ) : body?.bodyText ? (
            <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-text-secondary">
              {body.bodyText}
            </pre>
          ) : body?.bodyHtml ? (
            <p className="text-sm italic text-text-muted">
              (HTML-only email — plain text wasn’t extracted.)
            </p>
          ) : (
            <p className="text-sm italic text-text-muted">(No body content.)</p>
          )}

          {atts?.attachments && atts.attachments.length > 0 && (
            <div className="mt-4 border-t border-border pt-3">
              <p className="mb-2 text-xs font-semibold text-text-muted">Attachments ({atts.attachments.length})</p>
              <div className="space-y-1.5">
                {atts.attachments.map((a) => (
                  <div key={a.id} className="flex items-center gap-2 text-xs text-text-secondary">
                    <Paperclip size={12} className="shrink-0 text-text-muted" />
                    <span className="truncate">{a.filename}</span>
                    <span className="ml-auto shrink-0 text-text-muted">
                      {a.sizeBytes ? `${Math.round(a.sizeBytes / 1024)} KB` : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
