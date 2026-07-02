import { Badge } from '../ui/Badge'
import { formatRelativeTime } from '../../lib/utils'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronUp, Link as LinkIcon, AlertTriangle, Paperclip, FileText, FileSpreadsheet, File, Download } from 'lucide-react'
import { useState, useEffect } from 'react'
import type { ShippingEmail } from '../../hooks/use-emails'
import { useEmailAttachments, useMarkEmailRead } from '../../hooks/use-emails'
import { downloadAttachment } from '../../lib/api'

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function getFileIcon(mimeType: string) {
  if (mimeType === 'application/pdf') return FileText
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType.includes('csv'))
    return FileSpreadsheet
  return File
}

interface EmailCardProps {
  email: ShippingEmail
}

export function EmailCard({ email }: EmailCardProps) {
  const [expanded, setExpanded] = useState(true)
  const { data: attachmentsData } = useEmailAttachments(email.id)
  const markRead = useMarkEmailRead()
  const attachments = attachmentsData?.attachments ?? []

  // Mark as read when expanded
  useEffect(() => {
    if (expanded && !email.isRead) {
      markRead.mutate(email.id)
    }
  }, [expanded, email.isRead, email.id])

  let extracted: Record<string, unknown> | null = null
  if (email.extractedData) {
    try {
      extracted = JSON.parse(email.extractedData)
    } catch {
      // ignore parse errors
    }
  }

  const openEmailWindow = () => {
    window.open(
      `/email/${email.id}?type=${encodeURIComponent(email.emailType ?? '')}`,
      `email_${email.id}`,
      'popup,width=880,height=940,resizable=yes,scrollbars=yes',
    )
  }

  return (
    <div
      onClick={openEmailWindow}
      className="cursor-pointer rounded-xl border border-border bg-surface-800 p-4 transition-colors hover:bg-surface-700"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {!email.isRead && (
              <span className="h-2 w-2 shrink-0 rounded-full bg-cobalt-primary" />
            )}
            <span className="text-sm font-medium text-text-primary">{email.sender}</span>
            {email.emailType && (
              <Badge variant="emailType" value={email.emailType} />
            )}
          </div>
          <p className="mt-1 truncate text-sm text-text-secondary">{email.subject}</p>
        </div>
        <span className="shrink-0 text-xs text-text-muted">
          {formatRelativeTime(email.receivedAt)}
        </span>
      </div>

      {/* AI Extracted section */}
      {extracted && (
        <div className="mt-3">
          <button
            onClick={(e) => {
              e.stopPropagation()
              setExpanded(!expanded)
            }}
            className="flex items-center gap-1.5 text-xs font-medium text-cobalt-primary-light"
          >
            AI EXTRACTED
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
          {expanded && (
            <div className="mt-2 rounded-lg bg-surface-900 p-3">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs md:grid-cols-3">
                {Object.entries(extracted).map(([key, val]) => {
                  if (!val) return null
                  const label = key
                    .replace(/_/g, ' ')
                    .replace(/\b\w/g, (c) => c.toUpperCase())
                  return (
                    <div key={key}>
                      <span className="text-text-muted">{label}: </span>
                      <span className="font-mono text-text-primary">
                        {Array.isArray(val) ? val.join(', ') : String(val)}
                      </span>
                    </div>
                  )
                })}
              </div>
              <div className="mt-3 flex items-center gap-3">
                {email.shipmentId && (
                  <Link
                    to={`/shipments/${email.shipmentId}`}
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-1 text-xs font-medium text-cobalt-primary-light hover:underline"
                  >
                    <LinkIcon size={12} />
                    View Shipment
                  </Link>
                )}
                {!email.isMatched && (
                  <span className="inline-flex items-center gap-1 text-xs text-status-warning">
                    <AlertTriangle size={12} />
                    Unmatched PO
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
      {/* Attachments */}
      {attachments.length > 0 && (
        <div className="mt-3">
          <div className="flex items-center gap-1.5 text-xs font-medium text-text-muted">
            <Paperclip size={12} />
            ATTACHMENTS ({attachments.length})
          </div>
          <div className="mt-2 space-y-1.5">
            {attachments.map((att) => {
              const Icon = getFileIcon(att.mimeType)
              return (
                <div
                  key={att.id}
                  className="flex items-center justify-between rounded-lg bg-surface-900 px-3 py-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Icon size={14} className="shrink-0 text-cobalt-primary-light" />
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        void downloadAttachment(att.id, att.filename)
                      }}
                      className="truncate text-xs text-text-primary hover:text-cobalt-primary-light hover:underline cursor-pointer"
                      title={`Download ${att.filename}`}
                    >
                      {att.filename}
                    </button>
                    <span className="shrink-0 text-[10px] text-text-muted">
                      {formatFileSize(att.sizeBytes)}
                    </span>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      void downloadAttachment(att.id, att.filename)
                    }}
                    className="shrink-0 rounded p-1 text-text-muted hover:bg-surface-700 hover:text-cobalt-primary-light"
                    title={`Download ${att.filename}`}
                  >
                    <Download size={13} />
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
