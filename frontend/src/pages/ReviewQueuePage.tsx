import { useState } from 'react'
import { useReviewQueue, useReviewCounts, useReviewEmail } from '../hooks/use-review-queue'
import { useAuth } from '../hooks/use-auth'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { cn, formatRelativeTime } from '../lib/utils'
import {
  CheckCircle,
  XCircle,
  Edit3,
  Mail,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'

const statusTabs = [
  { key: undefined, label: 'Pending Review' },
  { key: 'NEEDS_REVIEW', label: 'Needs Review' },
  { key: 'FLAGGED', label: 'Flagged' },
  { key: 'REVIEWED_OK', label: 'Approved' },
  { key: 'REVIEWED_CORRECTED', label: 'Corrected' },
  { key: 'REJECTED', label: 'Rejected' },
]

export default function ReviewQueuePage() {
  const [activeTab, setActiveTab] = useState<string | undefined>(undefined)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const { data: queueData, isLoading } = useReviewQueue(activeTab)
  const { data: counts } = useReviewCounts()
  const reviewMutation = useReviewEmail()
  const { user } = useAuth()

  const emails = queueData?.emails ?? []

  const handleReview = (emailId: string, action: 'approve' | 'correct' | 'reject') => {
    if (!user) return
    reviewMutation.mutate({
      emailId,
      action,
      reviewedBy: user.id,
    })
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-text-primary">Review Queue</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Review AI-extracted email data that needs manual verification
        </p>
      </div>

      {/* Summary badges */}
      {counts && (
        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-2 rounded-lg bg-status-warning/10 px-3 py-2">
            <AlertTriangle size={14} className="text-status-warning" />
            <span className="text-sm font-medium text-status-warning">
              {counts.pending} pending review
            </span>
          </div>
          <div className="flex items-center gap-2 rounded-lg bg-surface-700 px-3 py-2">
            <span className="text-xs text-text-muted">NEEDS_REVIEW</span>
            <span className="font-mono text-sm text-text-primary">{counts.NEEDS_REVIEW}</span>
          </div>
          <div className="flex items-center gap-2 rounded-lg bg-surface-700 px-3 py-2">
            <span className="text-xs text-text-muted">FLAGGED</span>
            <span className="font-mono text-sm text-text-primary">{counts.FLAGGED}</span>
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-1 rounded-lg bg-surface-900 p-1">
        {statusTabs.map((tab) => (
          <button
            key={tab.key ?? 'all'}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              activeTab === tab.key
                ? 'bg-cobalt-primary text-white'
                : 'text-text-muted hover:text-text-primary'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Email list */}
      {isLoading ? (
        <div className="flex h-32 items-center justify-center text-sm text-text-muted">
          Loading review queue...
        </div>
      ) : emails.length === 0 ? (
        <div className="flex h-32 flex-col items-center justify-center text-text-muted">
          <CheckCircle size={24} className="mb-2 opacity-50" />
          <p className="text-sm">No emails to review</p>
        </div>
      ) : (
        <div className="space-y-3">
          {emails.map((email) => {
            const isExpanded = expandedId === email.id
            const confidence = email.extractionConfidence ?? 0
            let extractedData: Record<string, unknown> = {}
            try {
              extractedData = email.extractedData ? JSON.parse(email.extractedData) : {}
            } catch {
              // skip
            }

            return (
              <Card key={email.id} className="overflow-hidden">
                {/* Header row */}
                <div
                  className="flex cursor-pointer items-start justify-between gap-4"
                  onClick={() => setExpandedId(isExpanded ? null : email.id)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Mail size={14} className="shrink-0 text-text-muted" />
                      <span className="truncate text-sm font-medium text-text-primary">
                        {email.subject}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-text-muted">
                      <span>{email.sender}</span>
                      <span>·</span>
                      <span>{formatRelativeTime(email.receivedAt)}</span>
                      {email.emailType && (
                        <>
                          <span>·</span>
                          <Badge variant="emailType" value={email.emailType} />
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-3">
                    {/* Confidence bar */}
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-20 overflow-hidden rounded-full bg-surface-600">
                        <div
                          className={cn(
                            'h-full rounded-full transition-all',
                            confidence >= 0.9
                              ? 'bg-status-success'
                              : confidence >= 0.7
                                ? 'bg-status-warning'
                                : 'bg-status-critical'
                          )}
                          style={{ width: `${confidence * 100}%` }}
                        />
                      </div>
                      <span className="font-mono text-xs text-text-muted">
                        {(confidence * 100).toFixed(0)}%
                      </span>
                    </div>

                    {/* Review status badge */}
                    <ReviewStatusBadge status={email.reviewStatus} />

                    {isExpanded ? (
                      <ChevronUp size={14} className="text-text-muted" />
                    ) : (
                      <ChevronDown size={14} className="text-text-muted" />
                    )}
                  </div>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="mt-4 border-t border-border pt-4">
                    <div className="grid gap-6 lg:grid-cols-2">
                      {/* Left: Email body excerpt */}
                      <div>
                        <h5 className="mb-2 text-xs font-semibold text-text-muted">
                          EMAIL BODY
                        </h5>
                        <div className="max-h-48 overflow-y-auto rounded-lg bg-surface-900 p-3 text-xs leading-relaxed text-text-secondary">
                          {email.bodyText?.slice(0, 1000) ?? '(no text content)'}
                        </div>
                      </div>

                      {/* Right: Extracted data */}
                      <div>
                        <h5 className="mb-2 text-xs font-semibold text-text-muted">
                          EXTRACTED DATA
                        </h5>
                        <ExtractedDataDisplay data={extractedData} />

                        {/* Linked shipment info */}
                        {email.shipment && (
                          <div className="mt-3 rounded-lg bg-cobalt-primary/10 p-2">
                            <span className="text-[10px] font-semibold text-cobalt-primary">
                              LINKED SHIPMENT
                            </span>
                            <p className="mt-0.5 font-mono text-xs text-text-primary">
                              {email.shipment.poNumbers} — {email.shipment.status}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Action buttons */}
                    {(email.reviewStatus === 'NEEDS_REVIEW' ||
                      email.reviewStatus === 'FLAGGED') && (
                      <div className="mt-4 flex items-center justify-end gap-2 border-t border-border pt-3">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleReview(email.id, 'reject')
                          }}
                          disabled={reviewMutation.isPending}
                          className="flex items-center gap-1.5 rounded-lg border border-status-critical/30 px-3 py-1.5 text-xs font-medium text-status-critical hover:bg-status-critical/10 disabled:opacity-50"
                        >
                          <XCircle size={13} />
                          Reject
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleReview(email.id, 'correct')
                          }}
                          disabled={reviewMutation.isPending}
                          className="flex items-center gap-1.5 rounded-lg border border-status-warning/30 px-3 py-1.5 text-xs font-medium text-status-warning hover:bg-status-warning/10 disabled:opacity-50"
                        >
                          <Edit3 size={13} />
                          Correct
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleReview(email.id, 'approve')
                          }}
                          disabled={reviewMutation.isPending}
                          className="flex items-center gap-1.5 rounded-lg bg-status-success px-3 py-1.5 text-xs font-medium text-white hover:bg-status-success/90 disabled:opacity-50"
                        >
                          <CheckCircle size={13} />
                          Approve
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ReviewStatusBadge({ status }: { status: string | null }) {
  if (!status) return null

  const styles: Record<string, string> = {
    NEEDS_REVIEW: 'bg-status-warning/15 text-status-warning border-status-warning/30',
    FLAGGED: 'bg-status-info/15 text-status-info border-status-info/30',
    AUTO_ACCEPTED: 'bg-status-success/15 text-status-success border-status-success/30',
    REVIEWED_OK: 'bg-status-success/15 text-status-success border-status-success/30',
    REVIEWED_CORRECTED: 'bg-cobalt-primary/15 text-cobalt-primary border-cobalt-primary/30',
    REJECTED: 'bg-status-critical/15 text-status-critical border-status-critical/30',
  }

  const labels: Record<string, string> = {
    NEEDS_REVIEW: 'REVIEW',
    FLAGGED: 'FLAGGED',
    AUTO_ACCEPTED: 'AUTO',
    REVIEWED_OK: 'OK',
    REVIEWED_CORRECTED: 'CORRECTED',
    REJECTED: 'REJECTED',
  }

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide',
        styles[status] ?? 'bg-surface-700 text-text-muted border-border'
      )}
    >
      {labels[status] ?? status}
    </span>
  )
}

// Mapping from extraction keys to human-readable labels
const FIELD_LABELS: Record<string, string> = {
  po_numbers: 'Customer PO',
  customer: 'Customer',
  forwarder: 'Forwarder',
  route: 'Route',
  crd: 'Cargo Ready Date',
  cfs_cutoff: 'CFS Cut-off',
  hbl_number: 'HBL / AWB / FCR No.',
  vessel: 'Vessel',
  voyage_number: 'Voyage No.',
  etd: 'ETD',
  eta: 'ETA',
  warehouse_address: 'Warehouse',
  quantity: 'Qty',
  quantity_unit: 'Unit',
  quantity_raw: 'Qty (raw)',
  booking_no: 'Booking No.',
  so_number: 'SO#',
  item_style_no: 'Item / Style No.',
  consignee_name: 'Consignee Name',
  consignee_address: 'Consignee Address',
  mbl_number: 'MBL',
  container_no: 'Container No.',
  warehouse_start_date: 'WH Start Date',
  warehouse_end_date: 'WH End Date',
  in_dc_date: 'In DC Date',
}

// Group fields into logical sections
const FIELD_SECTIONS: Record<string, string[]> = {
  'Order Info': ['po_numbers', 'customer', 'forwarder', 'route', 'booking_no', 'so_number', 'item_style_no'],
  'Cargo & Logistics': ['quantity', 'quantity_unit', 'quantity_raw', 'container_no', 'hbl_number', 'mbl_number', 'warehouse_address'],
  'Shipping Parties': ['consignee_name', 'consignee_address', 'vessel', 'voyage_number'],
  'Dates': ['crd', 'cfs_cutoff', 'warehouse_start_date', 'warehouse_end_date', 'etd', 'eta', 'in_dc_date'],
}

function ExtractedDataDisplay({ data }: { data: Record<string, unknown> }) {
  if (Object.keys(data).length === 0) {
    return <p className="text-xs italic text-text-muted">No data extracted</p>
  }

  return (
    <div className="space-y-3">
      {Object.entries(FIELD_SECTIONS).map(([sectionTitle, fields]) => {
        const sectionData = fields.filter((f) => data[f] !== undefined && data[f] !== null && data[f] !== '')
        if (sectionData.length === 0) return null
        return (
          <div key={sectionTitle}>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
              {sectionTitle}
            </div>
            <div className="space-y-1">
              {sectionData.map((field) => (
                <div key={field} className="flex justify-between gap-2 text-xs">
                  <span className="text-text-muted">{FIELD_LABELS[field] ?? field}</span>
                  <span className="font-mono text-text-primary text-right">
                    {formatExtractedValue(data[field])}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function formatExtractedValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (Array.isArray(value)) return value.join(', ') || '—'
  if (typeof value === 'number') return String(value)
  // Date-like strings
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    try {
      return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    } catch {
      return value
    }
  }
  return String(value)
}
