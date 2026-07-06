import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useEmailBody, useEmailThread } from '../hooks/use-emails'
import {
  EmailHeader,
  EmailBodyPane,
  EmailAttachments,
  type RelatedEmail,
} from '../components/shipments/EmailContent'
import { useEmailAttachments } from '../hooks/use-emails'
import { Mail, Paperclip } from 'lucide-react'
import { formatDateTime } from '../lib/utils'

/**
 * Chrome-less, full-window rendering of a single email — opened via window.open() as a real pop-up so a
 * reviewer can read the original side-by-side with the shipment. No app sidebar/nav: the whole window is
 * the Outlook reading pane. Subject/sender/date come from the fetched body; the email-type badge comes
 * from the ?type= query param (the caller already knows it and it isn't stored on queue_message).
 */
export default function EmailWindowPage() {
  const { id } = useParams<{ id: string }>()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const emailType = params.get('type')?.trim() || null

  const { data: body, isLoading } = useEmailBody(id)
  const { data: atts } = useEmailAttachments(id)
  const { data: thread } = useEmailThread(id)
  const threadMessages = thread?.messages ?? []

  const email: RelatedEmail = {
    id: id ?? '',
    subject: body?.subject ?? '',
    sender: body?.sender ?? '',
    receivedAt: body?.receivedAt ?? null,
    emailType,
  }

  const html = body?.bodyHtml?.trim() || null
  const text = body?.bodyText?.trim() || null
  const attachments = atts?.attachments ?? []

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-surface-800">
      {/* Subject bar */}
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-4 sm:px-6">
        <h2 className="min-w-0 break-words text-lg font-semibold leading-snug text-text-primary">
          {body?.subject || (isLoading ? 'Loading…' : '(no subject)')}
        </h2>
      </div>

      <EmailHeader email={email} toRecipients={body?.toRecipients} ccRecipients={body?.ccRecipients} />
      <EmailBodyPane subject={email.subject} html={html} text={text} isLoading={isLoading} />
      <EmailAttachments attachments={attachments} />

      {/* Conversation panel — a forwarded MIME lumps earlier files onto the latest message, so show
          every ingested email in this thread with ITS OWN attachment count; click to read that one. */}
      {threadMessages.length > 1 && (
        <div className="max-h-64 shrink-0 overflow-y-auto border-t border-border bg-surface-800 px-4 py-3 sm:px-6">
          <p className="mb-2 text-xs font-semibold text-text-muted">
            Conversation ({threadMessages.length} emails)
          </p>
          <div className="space-y-1">
            {threadMessages.map((m) => {
              const current = m.id === id
              return (
                <button
                  key={m.id}
                  onClick={() => !current && navigate(`/email/${m.id}?type=`)}
                  disabled={current}
                  className={
                    current
                      ? 'flex w-full items-start gap-2 rounded-lg bg-surface-700 px-3 py-1.5 text-left text-xs text-text-primary'
                      : 'flex w-full cursor-pointer items-start gap-2 rounded-lg px-3 py-1.5 text-left text-xs text-text-secondary transition-colors hover:bg-surface-700'
                  }
                >
                  <Mail size={12} className="mt-0.5 shrink-0 text-text-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate font-medium">
                        {m.subject || '(no subject)'}
                        {current && <span className="ml-1 font-normal text-cobalt-primary-light">(viewing)</span>}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] text-text-muted">
                        {formatDateTime(m.receivedAt)}
                      </span>
                    </span>
                    <span className="mt-0.5 flex items-center justify-between gap-3 text-[11px] text-text-muted">
                      <span className="min-w-0 truncate">{m.sender}</span>
                      {m.attachmentCount > 0 && (
                        <span className="inline-flex shrink-0 items-center gap-1">
                          <Paperclip size={10} />
                          {m.attachmentCount}
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
