/**
 * Where a proposed value came from — the email, with the value highlighted, and the files that came
 * with it.
 *
 * The desk could already open a source email, but in a chrome-less POP-UP window: the operator left
 * the card to read it and then had to hold the value in their head on the way back. And it opened at
 * the top of the mail with no indication of which line the value came off.
 *
 * Two things make this cheap, both measured on the dev DB before building it:
 *   - every stored email carries `body_text` (189/189), so nothing new has to be captured, and
 *   - 58 of 86 candidate values (67%) appear VERBATIM in their source email's body — so highlighting
 *     is a plain text search. No character offsets, no parser changes.
 *
 * The other 33% came off an attachment, and for those the honest answer is a named list rather than a
 * highlight: nothing records WHICH file a value was read from, so saying "one of these" is better
 * than silently showing a body with no match in it.
 *
 * The list is now OPENABLE. It was inert text on the original reasoning that ShipTrack stored
 * attachment metadata but never the bytes — which has since stopped being true. Re-measured on the
 * dev DB: 611 attachments, 96 carrying raw_bytes. So naming the proof and refusing to show it was
 * denying the operator a file the system was holding all along.
 *
 * It is a partial fix and the UI says so per row rather than in aggregate: the remaining 515 have no
 * local copy, and with 0 rows carrying a graph_attachment_id the Graph re-fetch cannot even be
 * attempted for them. Those rows fail with the backend's ATTACHMENT_UNAVAILABLE reason shown inline
 * — an operator who knows the bytes were never captured can go to the mailbox; one staring at inert
 * text cannot tell that from a UI that simply forgot to be clickable.
 */
import { useMemo, useState } from 'react'
import { Download, FileText, Loader2, Mail, X } from 'lucide-react'
import { useEmailAttachments, useEmailBody } from '../../hooks/use-emails'
import { useAttachmentDownload } from '../../hooks/use-attachment-download'
import { parseSender } from '../../lib/email-sender'
import { cn, formatDateTime } from '../../lib/utils'

export interface EvidencePanelProps {
  /** Our email uuid (not the Graph id). */
  emailId: string
  /** The proposed value to find in the body. */
  value: string
  onClose: () => void
}

/** Case-insensitive literal split — the value is data, never a pattern. */
export function splitOnValue(body: string, value: string): { text: string; hit: boolean }[] {
  const needle = value.trim()
  if (!needle) return [{ text: body, hit: false }]
  const out: { text: string; hit: boolean }[] = []
  const hay = body.toLowerCase()
  const nee = needle.toLowerCase()
  let i = 0
  for (;;) {
    const at = hay.indexOf(nee, i)
    if (at < 0) {
      if (i < body.length) out.push({ text: body.slice(i), hit: false })
      break
    }
    if (at > i) out.push({ text: body.slice(i, at), hit: false })
    out.push({ text: body.slice(at, at + needle.length), hit: true })
    i = at + needle.length
  }
  return out
}

const KB = 1024
function fileSize(bytes: number): string {
  if (bytes >= KB * KB) return `${(bytes / (KB * KB)).toFixed(1)} MB`
  if (bytes >= KB) return `${Math.round(bytes / KB)} KB`
  return `${bytes} B`
}

/** Short type chip from the filename — the mime is often a generic octet-stream. */
function fileKind(filename: string, mime: string): { label: string; cls: string } {
  const ext = (filename.split('.').pop() ?? '').toLowerCase()
  if (['xlsx', 'xls', 'csv'].includes(ext)) return { label: ext.toUpperCase(), cls: 'border-status-success/30 bg-status-success/15 text-status-success' }
  if (ext === 'pdf' || mime.includes('pdf')) return { label: 'PDF', cls: 'border-status-critical/30 bg-status-critical/15 text-status-critical' }
  if (['doc', 'docx'].includes(ext)) return { label: ext.toUpperCase(), cls: 'border-cobalt-primary/30 bg-cobalt-primary/15 text-cobalt-primary-light' }
  if (['png', 'jpg', 'jpeg', 'gif', 'bmp', 'tif', 'tiff'].includes(ext)) return { label: 'IMG', cls: 'border-border bg-surface-700 text-text-secondary' }
  return { label: ext ? ext.toUpperCase().slice(0, 4) : 'FILE', cls: 'border-border bg-surface-700 text-text-secondary' }
}

const TAB = 'flex items-center gap-1.5 rounded-t-lg border border-b-0 px-2.5 py-1 text-[11.5px] font-medium transition-colors'

export function EvidencePanel({ emailId, value, onClose }: EvidencePanelProps) {
  const body = useEmailBody(emailId)
  const files = useEmailAttachments(emailId)
  const [tab, setTab] = useState<'body' | 'files'>('body')

  const parts = useMemo(
    () => splitOnValue(body.data?.bodyText ?? '', value),
    [body.data?.bodyText, value],
  )
  const hits = parts.filter((p) => p.hit).length
  const attachments = files.data?.attachments ?? []

  // Nothing to find in the body but files rode along → say which files, rather than showing a body
  // with no match and letting the operator hunt.
  const cameFromAFile = !body.isLoading && hits === 0 && attachments.length > 0
  const shown = cameFromAFile && tab === 'body' ? 'files' : tab

  return (
    <div
      className="mt-2 overflow-hidden rounded-xl border border-cobalt-primary/30"
      data-testid="evidence-panel"
    >
      <div className="flex items-start gap-2.5 border-b border-cobalt-primary/20 bg-cobalt-primary/5 px-3 py-2.5">
        <Mail size={14} className="mt-0.5 shrink-0 text-text-muted" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-text-primary">
            {body.data?.subject || (body.isLoading ? 'Loading…' : '(no subject)')}
          </p>
          {body.data && (
            <p className="field-value text-[11px] text-text-muted">
              {parseSender(body.data.sender).name} ·{' '}
              <span className="font-mono">{formatDateTime(body.data.receivedAt)}</span>
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close evidence"
          className="shrink-0 rounded p-0.5 text-text-muted hover:bg-surface-700 hover:text-text-primary"
        >
          <X size={14} />
        </button>
      </div>

      <div className="flex gap-1 border-b border-border bg-surface-900 px-3 pt-2">
        <button
          type="button"
          onClick={() => setTab('body')}
          data-testid="evidence-tab-body"
          className={cn(TAB, shown === 'body' ? 'border-border bg-surface-800 text-text-primary' : 'border-transparent text-text-muted')}
        >
          <Mail size={12} /> Email body
          <span className="font-mono text-[10px] text-text-muted">
            {body.isLoading ? '…' : `${hits} hit${hits === 1 ? '' : 's'}`}
          </span>
        </button>
        {attachments.length > 0 && (
          <button
            type="button"
            onClick={() => setTab('files')}
            data-testid="evidence-tab-files"
            className={cn(TAB, shown === 'files' ? 'border-border bg-surface-800 text-text-primary' : 'border-transparent text-text-muted')}
          >
            <FileText size={12} /> Attachments
            <span className="font-mono text-[10px] text-text-muted">{attachments.length}</span>
          </button>
        )}
      </div>

      {cameFromAFile && (
        <p
          className="border-b border-status-warning/20 bg-status-warning/5 px-3 py-2 text-xs text-status-warning"
          data-testid="evidence-from-file"
        >
          <span className="field-value font-mono font-semibold">{value}</span> is not in the email
          body — it came from one of these files.
        </p>
      )}

      {shown === 'body' ? (
        <div className="max-h-60 overflow-auto bg-surface-800 px-3 py-2.5">
          {body.isLoading ? (
            <p className="flex items-center gap-2 text-xs text-text-muted">
              <Loader2 size={12} className="animate-spin" /> Loading the email…
            </p>
          ) : body.isError || !body.data?.bodyText ? (
            <p className="text-xs text-text-muted">
              The body of this email is not in the store — re-ingest to read it here.
            </p>
          ) : (
            <pre
              className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-text-secondary"
              data-testid="evidence-body"
            >
              {/* The hit keeps amber (as `evidence-hit`) while the review grid moved to slate: this
                  highlight's job is finding a token in a wall of email text, which needs the
                  attention weight the third column deliberately gave up. */}
              {parts.map((p, i) =>
                p.hit ? (
                  <mark
                    key={i}
                    className="rounded-sm bg-evidence-hit/25 px-0.5 text-evidence-hit ring-1 ring-evidence-hit/40"
                  >
                    {p.text}
                  </mark>
                ) : (
                  <span key={i}>{p.text}</span>
                ),
              )}
            </pre>
          )}
        </div>
      ) : (
        <ul className="space-y-1.5 bg-surface-800 px-3 py-2.5" data-testid="evidence-files">
          {files.isLoading && (
            <li className="flex items-center gap-2 text-xs text-text-muted">
              <Loader2 size={12} className="animate-spin" /> Loading attachments…
            </li>
          )}
          {attachments.map((a) => (
            <EvidenceFileRow key={a.id} attachment={a} />
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * One attachment on the review desk — openable.
 *
 * This list used to render the filename as inert text. On a leg where 33% of the extracted values
 * came off an attachment, that named the proof and then refused to show it: the operator could see
 * `packing-list.xlsx` was the source and had no way to check what it said. The download route and
 * `downloadAttachment` both already existed; only the affordance was missing.
 *
 * Failure is surfaced, not swallowed — bytes may never have been stored locally and the Graph
 * re-fetch can fail, so the row goes red and keeps the reason. Clicking again retries.
 */
function EvidenceFileRow({
  attachment,
}: {
  attachment: { id: string; filename: string; mimeType: string; sizeBytes: number }
}) {
  const { status, error, download } = useAttachmentDownload()
  const kind = fileKind(attachment.filename, attachment.mimeType)
  return (
    <li>
      <button
        type="button"
        onClick={() => void download(attachment.id, attachment.filename)}
        disabled={status === 'loading'}
        aria-busy={status === 'loading'}
        title={
          status === 'loading'
            ? `Opening ${attachment.filename}…`
            : status === 'error'
              ? (error ?? 'Download failed — click to retry')
              : `Open ${attachment.filename}`
        }
        className={cn(
          'flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors disabled:cursor-wait',
          status === 'error'
            ? 'border-status-critical/50 hover:border-status-critical'
            : 'border-border hover:border-cobalt-primary hover:bg-surface-700',
        )}
      >
        <span className={cn('shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold', kind.cls)}>
          {kind.label}
        </span>
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-text-primary" title={attachment.filename}>
          {attachment.filename}
        </span>
        {status === 'loading' ? (
          <Loader2 size={12} className="shrink-0 animate-spin text-text-muted" />
        ) : (
          <Download size={12} className="shrink-0 text-text-muted" />
        )}
        <span className="shrink-0 font-mono text-[11px] text-text-muted">
          {fileSize(attachment.sizeBytes)}
        </span>
      </button>
      {/* The reason, not just a red edge: "no local copy and Graph re-fetch failed" is actionable;
          a silent failure sends the operator hunting through the mailbox by hand. */}
      {status === 'error' && error && (
        <p className="mt-1 px-2.5 text-[11px] text-status-critical">{error}</p>
      )}
    </li>
  )
}
