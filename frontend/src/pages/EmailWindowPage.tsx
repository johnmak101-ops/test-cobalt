import { useParams, useSearchParams } from 'react-router-dom'
import { useEmailBody } from '../hooks/use-emails'
import {
  EmailHeader,
  EmailBodyPane,
  EmailAttachments,
  type RelatedEmail,
} from '../components/shipments/EmailContent'
import { useEmailAttachments } from '../hooks/use-emails'

/**
 * Chrome-less, full-window rendering of a single email — opened via window.open() as a real pop-up so a
 * reviewer can read the original side-by-side with the shipment. No app sidebar/nav: the whole window is
 * the Outlook reading pane. Subject/sender/date come from the fetched body; the email-type badge comes
 * from the ?type= query param (the caller already knows it and it isn't stored on queue_message).
 */
export default function EmailWindowPage() {
  const { id } = useParams<{ id: string }>()
  const [params] = useSearchParams()
  const emailType = params.get('type')?.trim() || null

  const { data: body, isLoading } = useEmailBody(id)
  const { data: atts } = useEmailAttachments(id)

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
      <div className="flex items-start justify-between gap-3 border-b border-border px-6 py-4">
        <h2 className="text-lg font-semibold leading-snug text-text-primary">
          {body?.subject || (isLoading ? 'Loading…' : '(no subject)')}
        </h2>
      </div>

      <EmailHeader email={email} toRecipients={body?.toRecipients} ccRecipients={body?.ccRecipients} />
      <EmailBodyPane subject={email.subject} html={html} text={text} isLoading={isLoading} />
      <EmailAttachments attachments={attachments} />
    </div>
  )
}
