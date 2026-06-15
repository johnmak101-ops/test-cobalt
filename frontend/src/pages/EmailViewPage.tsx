import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { Mail, Paperclip, FileText, Image as ImageIcon } from 'lucide-react'
import { api } from '../lib/api'

interface OriginalEmail {
  available: boolean
  source: string
  messageId: string
  sourceFile?: string | null
  subject?: string | null
  from?: string | null
  receivedDateTime?: string | null
  bodyText?: string | null
  bodyHtml?: string | null
  hasAttachments?: boolean
}

interface Attachment {
  filename: string
  label: string | null
  kind: string | null
  mime: string | null
  sizeBytes: number
  text?: string | null
  base64?: string | null
  tooLarge?: boolean
}

const fmtSize = (n: number) =>
  n < 1024 ? `${n} B` : n < 1_048_576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1_048_576).toFixed(1)} MB`

function AttachmentView({ a }: { a: Attachment }) {
  const mime = a.mime ?? ''
  const dataUri = a.base64 ? `data:${mime || 'application/octet-stream'};base64,${a.base64}` : null
  const isImg = mime.startsWith('image/') && !!dataUri
  const isPdf = mime.includes('pdf') && !!dataUri
  return (
    <div className="rounded-lg border border-border bg-surface-800">
      <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {isImg ? <ImageIcon size={14} className="shrink-0 text-text-muted" /> : <FileText size={14} className="shrink-0 text-text-muted" />}
          <span className="truncate text-sm" title={a.filename}>{a.filename}</span>
          {a.label && <span className="shrink-0 text-xs text-text-muted">· {a.label}</span>}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="text-xs text-text-muted">{fmtSize(a.sizeBytes)}</span>
          {dataUri && (
            <a href={dataUri} download={a.filename} className="text-xs text-cobalt-primary hover:underline">
              Download
            </a>
          )}
        </div>
      </div>
      <div className="p-3">
        {isImg && <img src={dataUri!} alt={a.filename} className="max-h-[600px] rounded border border-border" />}
        {isPdf && <iframe src={dataUri!} title={a.filename} className="h-[600px] w-full rounded border border-border" />}
        {!isImg && !isPdf && a.text != null && (
          <pre className="max-h-[400px] overflow-auto whitespace-pre-wrap text-xs text-text-secondary">{a.text}</pre>
        )}
        {!isImg && !isPdf && a.text == null && (
          <div className="text-xs text-text-muted">
            {a.tooLarge ? `Attachment too large to preview (${fmtSize(a.sizeBytes)}).` : 'No preview available.'}
          </div>
        )}
      </div>
    </div>
  )
}

/** Standalone "view original" window — opened in a new tab; renders the email + its attachments. */
export default function EmailViewPage() {
  const [params] = useSearchParams()
  const messageId = params.get('messageId') ?? ''

  const { data: email, isLoading } = useQuery({
    queryKey: ['email-original', messageId],
    queryFn: () => api.get<OriginalEmail>(`/emails/original?messageId=${encodeURIComponent(messageId)}`),
    enabled: !!messageId,
  })
  const { data: att } = useQuery({
    queryKey: ['email-attachments', messageId],
    queryFn: () => api.get<{ available: boolean; attachments: Attachment[] }>(`/emails/attachments?messageId=${encodeURIComponent(messageId)}`),
    enabled: !!messageId,
  })

  return (
    <div className="min-h-screen bg-bg text-text-primary">
      <div className="mx-auto max-w-4xl space-y-5 p-6">
        <div className="flex items-center gap-2 text-text-muted">
          <Mail size={18} />
          <span className="font-semibold">Original email</span>
        </div>

        {isLoading ? (
          <div className="text-sm text-text-muted">Loading…</div>
        ) : !email?.available ? (
          <div className="rounded-lg border border-border bg-surface-800 p-4 text-sm text-text-secondary">
            {email?.source === 'corpus' ? (
              <>
                This email is a labelled corpus pointer with no live copy to display.
                <div className="mt-1 break-all font-mono text-xs text-text-muted">{email.sourceFile}</div>
              </>
            ) : email?.source === 'unconfigured' ? (
              "Original-email viewing isn't configured here (no Microsoft Graph credentials)."
            ) : (
              "Couldn't load the original email."
            )}
          </div>
        ) : (
          <>
            <div className="space-y-1 rounded-lg border border-border bg-surface-800 p-4">
              <h1 className="text-lg font-semibold">{email.subject || '(no subject)'}</h1>
              <div className="text-sm text-text-secondary">
                <span className="text-text-muted">From:</span> {email.from || '—'}
              </div>
              <div className="text-sm text-text-secondary">
                <span className="text-text-muted">Received:</span>{' '}
                {email.receivedDateTime ? new Date(email.receivedDateTime).toLocaleString() : '—'}
              </div>
              {email.sourceFile && <div className="break-all font-mono text-xs text-text-muted">{email.sourceFile}</div>}
            </div>

            <div className="rounded-lg border border-border bg-surface-800 p-4">
              {email.bodyHtml ? (
                <iframe title="email-body" sandbox="" srcDoc={email.bodyHtml} className="h-[420px] w-full rounded border border-border bg-white" />
              ) : (
                <pre className="whitespace-pre-wrap break-words text-sm text-text-secondary">{email.bodyText || '—'}</pre>
              )}
            </div>

            {att?.attachments?.length ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Paperclip size={14} /> Attachments ({att.attachments.length})
                </div>
                {att.attachments.map((a, i) => (
                  <AttachmentView key={i} a={a} />
                ))}
              </div>
            ) : email.hasAttachments ? (
              <div className="text-sm text-text-muted">Attachments aren't available in this environment.</div>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}
