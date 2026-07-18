import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { EmailContent, type RelatedEmail } from './EmailContent'

export type { RelatedEmail } from './EmailContent'

/** Read-only Outlook-style reader for a single related email, presented as an in-page modal.
 *  The reading-pane rendering (header, sandboxed body, attachments) lives in the shared EmailContent
 *  component so the standalone pop-up window (EmailWindowPage) renders identical content. */
export function EmailViewerModal({ email, onClose }: { email: RelatedEmail | null; onClose: () => void }) {
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
        className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-border bg-surface-800 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Subject bar */}
        <div className="flex items-start justify-between gap-3 border-b border-border px-6 py-4">
          <h2 className="text-lg font-semibold leading-snug text-text-primary">{email.subject || '(no subject)'}</h2>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-1.5 text-text-muted hover:bg-surface-700 hover:text-text-primary"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <EmailContent email={email} />
      </div>
    </div>,
    document.body,
  )
}
