import { useEffect, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { Mail, Paperclip, FileText, FileSpreadsheet, FileArchive, File as FileIcon, Image as ImageIcon, Download } from 'lucide-react'
import { api } from '../lib/api'
import { cn } from '../lib/utils'

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
  /** office doc whose original wasn't retained — only the parsed text is available */
  parsedOnly?: boolean
}

const fmtSize = (n: number) =>
  n < 1024 ? `${n} B` : n < 1_048_576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1_048_576).toFixed(1)} MB`

/** Download the attachment as a real file so a human can open it locally (Excel / Word / a viewer),
 *  instead of eyeballing extracted text/HTML in the browser. `base64` is the ORIGINAL document
 *  (office binary, image, or pdf). The `text` branch is only the rare purged/text-native fallback,
 *  handed back with the matching extension (.html / .csv / .txt). */
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

/** File-type icon + colour + short label, à la Outlook's attachment chips. */
function kindMeta(a: Attachment): { Icon: typeof FileText; color: string; type: string } {
  const mime = a.mime ?? ''
  const k = a.kind ?? ''
  if (mime.startsWith('image/')) return { Icon: ImageIcon, color: 'text-cobalt-teal', type: 'Image' }
  if (k === 'xlsx' || k === 'xls' || k === 'csv') return { Icon: FileSpreadsheet, color: 'text-status-success', type: k === 'csv' ? 'CSV' : 'Excel' }
  if (k === 'docx' || k === 'doc' || k === 'rtf') return { Icon: FileText, color: 'text-cobalt-primary', type: 'Word' }
  if (k === 'text_pdf' || k === 'scanned_pdf' || mime.includes('pdf')) return { Icon: FileIcon, color: 'text-status-critical', type: 'PDF' }
  if (k === 'zip') return { Icon: FileArchive, color: 'text-status-warning', type: 'Zip' }
  if (k === 'html' || k === 'text') return { Icon: FileText, color: 'text-text-muted', type: k === 'html' ? 'HTML' : 'Text' }
  return { Icon: FileIcon, color: 'text-text-muted', type: '' }
}

/** An Outlook-style attachment chip — click to download the original and open it locally. */
function AttachmentChip({ a }: { a: Attachment }) {
  const { Icon, color, type } = kindMeta(a)
  const hasContent = !!a.base64 || a.text != null
  const meta = a.parsedOnly ? 'original not retained' : [type, fmtSize(a.sizeBytes)].filter(Boolean).join(' · ')
  const body = (
    <>
      <Icon size={26} className={`shrink-0 ${color}`} />
      <div className="min-w-0 flex-1 text-left">
        <div className="truncate text-sm font-medium text-text-primary" title={a.filename}>{a.filename}</div>
        <div className={`truncate text-xs ${a.parsedOnly ? 'text-status-warning' : 'text-text-muted'}`}>{meta}</div>
      </div>
      {hasContent ? (
        <Download size={15} className="shrink-0 text-text-muted transition-colors group-hover:text-cobalt-primary" />
      ) : (
        <span className="shrink-0 text-xs text-text-muted">{a.tooLarge ? 'too large' : 'no copy'}</span>
      )}
    </>
  )
  const cls = 'flex w-[280px] items-center gap-3 rounded-lg border border-border bg-surface-800 px-3 py-2'
  return hasContent ? (
    <button onClick={() => downloadAttachment(a)} title={`Download ${a.filename}`} className={`group ${cls} text-left transition-colors hover:border-cobalt-primary/50 hover:bg-surface-700`}>
      {body}
    </button>
  ) : (
    <div className={`${cls} opacity-70`}>{body}</div>
  )
}

const HEADER_RE = /^\s*(发件人|发送时间|收件人|抄送|主题|From|Sent|To|Cc|Subject)\s*[:：]/
const REPLY_RE = /^\s*(发件人|From)\s*[:：]/

/** Wrap case-insensitive matches of `term` in <mark data-hl> so a traced value pops on the page. */
function highlightParts(text: string, term: string): ReactNode {
  if (!term) return text
  const lower = text.toLowerCase()
  const t = term.toLowerCase()
  if (!lower.includes(t)) return text
  const out: ReactNode[] = []
  let i = 0
  let idx = lower.indexOf(t)
  while (idx !== -1) {
    if (idx > i) out.push(text.slice(i, idx))
    out.push(
      <mark key={idx} data-hl className="rounded bg-yellow-200 px-0.5 text-gray-900">
        {text.slice(idx, idx + term.length)}
      </mark>,
    )
    i = idx + term.length
    idx = lower.indexOf(t, i)
  }
  if (i < text.length) out.push(text.slice(i))
  return out
}

/**
 * Outlook-style reading pane for plain-text email (the .msg corpus has no HTML body). Renders on a
 * themed (dark) pane in a sans-serif face, preserves the source line breaks, bolds the reply headers
 * (发件人/收件人/主题 · From/Sent/To/Cc/Subject) and rules off each quoted reply — so a flattened
 * thread reads like Outlook instead of a monospace wall.
 */
function EmailThread({ text, highlight }: { text: string; highlight?: string }) {
  const cleaned = text
    .replace(/\r\n/g, '\n')
    .replace(/^.*ZjQcmQRYFpfptBanner(?:Start|End).*$/gm, '') // strip the phishing-banner sentinels
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  const lines = cleaned.split('\n')

  // scroll to the first highlighted value once the pane has rendered
  useEffect(() => {
    if (!highlight) return
    document.querySelector('mark[data-hl]')?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [highlight, cleaned])

  const term = (highlight ?? '').trim()

  return (
    <div className="max-h-[640px] overflow-auto rounded-lg border border-border bg-surface-900 px-6 py-5">
      <div className="mx-auto max-w-[680px] font-sans text-[13px] leading-relaxed text-text-secondary">
        {lines.map((ln, i) =>
          ln.trim() === '' ? (
            <div key={i} className="h-2.5" aria-hidden />
          ) : (
            <p
              key={i}
              className={cn(
                'whitespace-pre-wrap break-words',
                REPLY_RE.test(ln) && i > 0 && 'mt-5 border-t border-border pt-4',
                HEADER_RE.test(ln) && 'font-semibold text-text-primary',
              )}
            >
              {highlightParts(ln, term)}
            </p>
          ),
        )}
      </div>
    </div>
  )
}

/** Standalone "view original" window — opened in a new tab; renders the email + its attachments. */
export default function EmailViewPage() {
  const [params] = useSearchParams()
  const messageId = params.get('messageId') ?? ''
  const highlight = params.get('highlight') ?? ''

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
            {/* Outlook-style reading-pane header: subject, sender/date, then the attachments row */}
            <div className="rounded-lg border border-border bg-surface-800">
              <div className="space-y-1 p-4">
                <h1 className="text-xl font-semibold">{highlightParts(email.subject || '(no subject)', highlight.trim())}</h1>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-text-secondary">
                  <span><span className="text-text-muted">From:</span> {email.from || '—'}</span>
                  <span className="text-text-muted">·</span>
                  <span>{email.receivedDateTime ? new Date(email.receivedDateTime).toLocaleString() : '—'}</span>
                </div>
                {email.sourceFile && <div className="break-all font-mono text-xs text-text-muted">{email.sourceFile}</div>}
              </div>

              {att?.attachments?.length ? (
                <div className="border-t border-border px-4 py-3">
                  <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">
                    <Paperclip size={12} /> {att.attachments.length} attachment{att.attachments.length > 1 ? 's' : ''}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {att.attachments.map((a, i) => (
                      <AttachmentChip key={i} a={a} />
                    ))}
                  </div>
                </div>
              ) : email.hasAttachments ? (
                <div className="border-t border-border px-4 py-3 text-sm text-text-muted">
                  Attachments aren't available in this environment.
                </div>
              ) : null}
            </div>

            {/* email body — HTML in a sandboxed iframe; plain-text in an Outlook-style reading pane */}
            <div className="rounded-lg border border-border bg-surface-800 p-4">
              {email.bodyHtml ? (
                <iframe title="email-body" sandbox="" srcDoc={email.bodyHtml} className="h-[640px] w-full rounded border border-border bg-white" />
              ) : email.bodyText ? (
                <EmailThread text={email.bodyText} highlight={highlight} />
              ) : (
                <div className="text-sm text-text-muted">—</div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
