import { Paperclip, FileText } from 'lucide-react'
import { useEmailBody, useEmailAttachments } from '../../hooks/use-emails'
import { Badge } from '../ui/Badge'

export interface RelatedEmail {
  id: string
  subject: string
  sender: string
  receivedAt: string | null
  emailType?: string | null
}

/** Read-only Outlook-style reader for a single related email. The real HTML body is rendered inside a
 *  fully-sandboxed iframe (sandbox="" → no scripts, no same-origin, no navigation), which both isolates
 *  any untrusted markup and reproduces the email's own formatting the way Outlook's reading pane does.
 *  To/Cc come from the stored queue_message columns when captured; otherwise the header falls back to the
 *  "Cobalt ShipTrack (ingest mailbox)" recipient line. */

// "Display Name <addr@x.com>" → { name, addr }
export function parseSender(raw: string): { name: string; addr: string } {
  const m = (raw ?? '').match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/)
  if (m) return { name: (m[1] || m[2]).trim(), addr: m[2].trim() }
  const t = (raw ?? '').trim()
  return { name: t || 'Unknown sender', addr: t.includes('@') ? t : '' }
}

export function initials(name: string): string {
  const parts = name.replace(/[<>"]/g, '').trim().split(/[\s@._-]+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?'
}

const AVATAR_COLORS = ['#0f6cbd', '#8764b8', '#c239b3', '#0b6a0b', '#038387', '#8e562e', '#a4262c', '#005b70']
export function avatarColor(s: string): string {
  let h = 0
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!
}

export function fullDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

/** Wrap the stored email HTML in a minimal Outlook-reading-pane document (white pane, Segoe UI, links
 *  blue, images clamped). `<base target="_blank">` keeps any link out of the sandbox; sandbox="" blocks it
 *  from navigating anyway — the point is faithful rendering, not interactivity. */
export function emailSrcDoc(html: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><base target="_blank"><style>
    html,body{margin:0;padding:0}
    body{padding:20px;background:#fff;color:#201f1e;font-family:'Segoe UI',-apple-system,'Helvetica Neue',Arial,sans-serif;font-size:14px;line-height:1.5;word-wrap:break-word;overflow-wrap:anywhere}
    img{max-width:100%;height:auto}table{max-width:100%}
    a{color:#0f6cbd}
    blockquote{margin:0 0 0 12px;padding-left:12px;border-left:2px solid #e1dfdd;color:#605e5c}
    *{box-sizing:border-box}
  </style></head><body>${html}</body></html>`
}

/** The From/To/Cc + subject + date + type-badge header, shared by the modal and the pop-up window. */
export function EmailHeader({
  email,
  toRecipients,
  ccRecipients,
}: {
  email: RelatedEmail
  toRecipients?: string | null
  ccRecipients?: string | null
}) {
  const { name, addr } = parseSender(email.sender)
  const to = toRecipients?.trim() || null
  const cc = ccRecipients?.trim() || null

  return (
    <div className="flex items-center gap-3 border-b border-border px-6 py-3">
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
        style={{ backgroundColor: avatarColor(email.sender || 'x') }}
      >
        {initials(name)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm font-semibold text-text-primary">{name}</span>
          {addr && <span className="truncate text-xs text-text-muted">&lt;{addr}&gt;</span>}
        </div>
        <div className="truncate text-xs text-text-muted">
          To: {to ?? 'Cobalt ShipTrack (ingest mailbox)'}
        </div>
        {cc && <div className="truncate text-xs text-text-muted">Cc: {cc}</div>}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <span className="whitespace-nowrap text-xs text-text-muted">{fullDate(email.receivedAt)}</span>
        {email.emailType && <Badge variant="emailType" value={email.emailType} />}
      </div>
    </div>
  )
}

/** The sandboxed reading pane: renders the real HTML body, or a text fallback, or an empty-state line. */
export function EmailBodyPane({
  subject,
  html,
  text,
  isLoading,
}: {
  subject: string
  html: string | null
  text: string | null
  isLoading: boolean
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      {isLoading ? (
        <p className="p-6 text-sm text-[#605e5c]">Loading…</p>
      ) : html ? (
        <iframe
          title={`Email: ${subject}`}
          sandbox=""
          className="min-h-0 w-full flex-1 border-0 bg-white"
          srcDoc={emailSrcDoc(html)}
        />
      ) : text ? (
        <pre className="flex-1 overflow-auto whitespace-pre-wrap break-words p-6 font-sans text-sm leading-relaxed text-[#201f1e]">
          {text}
        </pre>
      ) : (
        <p className="p-6 text-sm italic text-[#605e5c]">(No body content was captured for this email.)</p>
      )}
    </div>
  )
}

/** Attachment chips row. */
export function EmailAttachments({
  attachments,
}: {
  attachments: { id: string; filename: string; sizeBytes: number }[]
}) {
  if (attachments.length === 0) return null
  return (
    <div className="border-t border-border bg-surface-800 px-6 py-3">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-text-muted">
        <Paperclip size={12} /> {attachments.length} attachment{attachments.length > 1 ? 's' : ''}
      </p>
      <div className="flex flex-wrap gap-2">
        {attachments.map((a) => (
          <div
            key={a.id}
            className="flex items-center gap-2 rounded-lg border border-border bg-surface-700 px-3 py-1.5 text-xs text-text-secondary"
          >
            <FileText size={13} className="shrink-0 text-text-muted" />
            <span className="max-w-[220px] truncate">{a.filename}</span>
            {a.sizeBytes ? <span className="text-text-muted">{Math.round(a.sizeBytes / 1024)} KB</span> : null}
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * The full Outlook reading-pane body for one email: header (From/To/Cc/date/type), the sandboxed body
 * pane, and the attachment chips. Fetches the body + attachments itself so both the in-page modal and the
 * standalone pop-up window can render identical content from just a RelatedEmail.
 */
export function EmailContent({ email }: { email: RelatedEmail }) {
  const { data: body, isLoading } = useEmailBody(email.id)
  const { data: atts } = useEmailAttachments(email.id)

  const html = body?.bodyHtml?.trim() || null
  const text = body?.bodyText?.trim() || null
  const attachments = atts?.attachments ?? []

  return (
    <>
      <EmailHeader email={email} toRecipients={body?.toRecipients} ccRecipients={body?.ccRecipients} />
      <EmailBodyPane subject={email.subject} html={html} text={text} isLoading={isLoading} />
      <EmailAttachments attachments={attachments} />
    </>
  )
}
