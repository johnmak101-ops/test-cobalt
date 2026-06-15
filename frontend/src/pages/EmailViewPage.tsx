import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { Mail, Paperclip, FileText, Image as ImageIcon, Download } from 'lucide-react'
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

/** Download the attachment as a real file so a human can open it locally (Excel / Word / a viewer),
 *  instead of eyeballing extracted text/HTML in the browser. Images/PDF download as their actual
 *  bytes; docx/xlsx are retained only as their NORMALIZED copy (HTML / CSV), so we hand those back
 *  with the matching extension (.html / .csv) rather than a broken original-binary filename. */
function downloadAttachment(a: Attachment) {
  let blob: Blob
  let name = a.filename || 'attachment'
  if (a.base64) {
    const bin = atob(a.base64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    blob = new Blob([bytes], { type: a.mime || 'application/octet-stream' })
  } else if (a.text != null) {
    const ext = a.kind === 'csv' ? 'csv' : a.kind === 'html' ? 'html' : 'txt'
    const type = a.kind === 'csv' ? 'text/csv' : a.kind === 'html' ? 'text/html' : 'text/plain'
    if (!new RegExp(`\\.${ext}$`, 'i').test(name)) name = `${name.replace(/\.[^.]+$/, '')}.${ext}`
    blob = new Blob([a.text], { type: `${type};charset=utf-8` })
  } else {
    return
  }
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/** Download-only row — no inline preview; the reviewer downloads the file and opens it locally. */
function AttachmentView({ a }: { a: Attachment }) {
  const isImg = (a.mime ?? '').startsWith('image/')
  const hasContent = !!a.base64 || a.text != null
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-800 px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        {isImg ? <ImageIcon size={14} className="shrink-0 text-text-muted" /> : <FileText size={14} className="shrink-0 text-text-muted" />}
        <span className="truncate text-sm" title={a.filename}>{a.filename}</span>
        {a.label && <span className="shrink-0 text-xs text-text-muted">· {a.label}</span>}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="text-xs text-text-muted">{fmtSize(a.sizeBytes)}</span>
        {hasContent ? (
          <button onClick={() => downloadAttachment(a)} className="inline-flex items-center gap-1 text-xs font-medium text-cobalt-primary hover:underline">
            <Download size={12} /> Download
          </button>
        ) : (
          <span className="text-xs text-text-muted">{a.tooLarge ? 'too large' : 'no copy'}</span>
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
