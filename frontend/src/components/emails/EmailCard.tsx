import { Badge } from '../ui/Badge'
import { formatRelativeTime } from '../../lib/utils'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronUp, Link as LinkIcon, AlertTriangle } from 'lucide-react'
import { useState } from 'react'
import type { ShippingEmail } from '../../hooks/use-emails'

interface EmailCardProps {
  email: ShippingEmail
}

export function EmailCard({ email }: EmailCardProps) {
  const [expanded, setExpanded] = useState(true)

  let extracted: Record<string, unknown> | null = null
  if (email.extractedData) {
    try {
      extracted = JSON.parse(email.extractedData)
    } catch {
      // ignore parse errors
    }
  }

  return (
    <div className="rounded-xl border border-border bg-surface-800 p-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
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
            onClick={() => setExpanded(!expanded)}
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
    </div>
  )
}
