import { useState, useCallback } from 'react'
import { useReviewQueue, useReviewCounts, useReviewEmail } from '../hooks/use-review-queue'
import { useAuth } from '../hooks/use-auth'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Pagination, usePagination, PageSizeSelect } from '../components/ui/Pagination'
import { cn, formatRelativeTime } from '../lib/utils'
import { useEmailAttachments } from '../hooks/use-emails'
import { useQueryClient } from '@tanstack/react-query'
import {
  CheckCircle,
  Edit3,
  X,
  Save,
  Mail,
  AlertTriangle,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Paperclip,
  FileText,
  FileSpreadsheet,
  File,
  Download,
} from 'lucide-react'

const statusTabs = [
  { key: undefined, label: 'Pending Review' },
  { key: 'REVIEWED_OK', label: 'Approved' },
  { key: 'REVIEWED_CORRECTED', label: 'Corrected' },
]

export default function ReviewQueuePage() {
  const [activeTab, setActiveTab] = useState<string | undefined>(undefined)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [correctingId, setCorrectingId] = useState<string | null>(null)
  const [correctedData, setCorrectedData] = useState<Record<string, unknown>>({})
  const [correctionNotes, setCorrectionNotes] = useState('')
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(25)
  const { data: queueData, isLoading } = useReviewQueue(activeTab)
  const { data: counts } = useReviewCounts()
  const reviewMutation = useReviewEmail()
  const { user } = useAuth()
  const qc = useQueryClient()

  const emails = queueData?.emails ?? []
  const { totalItems, totalPages, pageSize, getPage } = usePagination(emails, perPage)
  const pageEmails = getPage(page)

  const handleApprove = (emailId: string) => {
    if (!user) return
    reviewMutation.mutate({
      emailId,
      action: 'approve',
      reviewedBy: user.id,
    })
  }

  const startCorrecting = useCallback((emailId: string, extractedData: Record<string, unknown>) => {
    setCorrectingId(emailId)
    setCorrectedData({ ...extractedData })
    setCorrectionNotes('')
  }, [])

  const cancelCorrecting = useCallback(() => {
    setCorrectingId(null)
    setCorrectedData({})
    setCorrectionNotes('')
  }, [])

  const submitCorrection = useCallback(() => {
    if (!user || !correctingId) return
    // Build final data — convert po_numbers string back to array
    const finalData = { ...correctedData }
    if (typeof finalData.po_numbers === 'string') {
      finalData.po_numbers = (finalData.po_numbers as string)
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean)
    }
    reviewMutation.mutate(
      {
        emailId: correctingId,
        action: 'correct',
        reviewedBy: user.id,
        notes: correctionNotes.trim() || 'Manual correction',
        corrections: { extractedData: finalData },
      },
      {
        onSuccess: () => {
          setCorrectingId(null)
          setCorrectedData({})
          setCorrectionNotes('')
        },
      }
    )
  }, [user, correctingId, correctedData, correctionNotes, reviewMutation])

  const handleFieldChange = useCallback((field: string, value: string) => {
    setCorrectedData((prev) => ({ ...prev, [field]: value }))
  }, [])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">Review Queue</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Review AI-extracted email data that needs manual verification
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              qc.invalidateQueries({ queryKey: ['review-queue'] })
              qc.invalidateQueries({ queryKey: ['review-counts'] })
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-surface-700 px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-600 hover:text-text-primary"
          >
            <RefreshCw size={14} />
            Refresh
          </button>
          <PageSizeSelect value={perPage} onChange={(size) => { setPerPage(size); setPage(1) }} />
        </div>
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
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-1 rounded-lg bg-surface-900 p-1">
        {statusTabs.map((tab) => (
          <button
            key={tab.key ?? 'all'}
            onClick={() => {
              setActiveTab(tab.key)
              setPage(1)
            }}
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
          {pageEmails.map((email) => {
            const isExpanded = expandedId === email.id
            const confidence = email.extractionConfidence ?? 0
            let extractedData: Record<string, unknown> = {}
            try {
              extractedData = email.extractedData ? JSON.parse(email.extractedData) : {}
            } catch {
              // skip
            }
            let originalData: Record<string, unknown> | null = null
            try {
              originalData = email.originalExtractedData ? JSON.parse(email.originalExtractedData) : null
            } catch {
              // skip
            }
            const isCorrected = email.reviewStatus === 'REVIEWED_CORRECTED' && originalData !== null

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
                    {/* Confidence level */}
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-20 overflow-hidden rounded-full bg-surface-600">
                        <div
                          className={cn(
                            'h-full rounded-full transition-all',
                            confidence >= 0.8
                              ? 'bg-status-success'
                              : confidence >= 0.5
                                ? 'bg-status-warning'
                                : 'bg-status-critical'
                          )}
                          style={{ width: `${confidence * 100}%` }}
                        />
                      </div>
                      <span
                        className={cn(
                          'text-[10px] font-semibold',
                          confidence >= 0.8
                            ? 'text-status-success'
                            : confidence >= 0.5
                              ? 'text-status-warning'
                              : 'text-status-critical'
                        )}
                      >
                        {confidence >= 0.8 ? 'HIGH' : confidence >= 0.5 ? 'MED' : 'LOW'}
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
                          {correctingId === email.id
                            ? 'EDIT EXTRACTED DATA'
                            : isCorrected
                              ? 'CORRECTED DATA'
                              : 'EXTRACTED DATA'}
                        </h5>
                        {correctingId === email.id ? (
                          <EditableExtractedDataDisplay
                            data={correctedData}
                            onChange={handleFieldChange}
                          />
                        ) : isCorrected ? (
                          <CorrectionDiffDisplay
                            original={originalData!}
                            corrected={extractedData}
                            reviewNotes={email.reviewNotes}
                            reviewedBy={email.reviewedBy}
                            reviewedAt={email.reviewedAt}
                          />
                        ) : (
                          <ExtractedDataDisplay data={extractedData} />
                        )}

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

                    {/* Attachments */}
                    <AttachmentsSection emailId={email.id} />

                    {/* Action buttons */}
                    {correctingId === email.id ? (
                      <div className="mt-4 border-t border-border pt-3">
                        <div className="mb-3">
                          <label className="mb-1 block text-xs font-semibold text-text-muted">
                            CORRECTION NOTES (optional)
                          </label>
                          <textarea
                            value={correctionNotes}
                            onChange={(e) => setCorrectionNotes(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            placeholder="Explain what was changed and why..."
                            rows={2}
                            className="w-full rounded-lg border border-border bg-surface-900 px-3 py-2 text-xs text-text-primary placeholder:text-text-muted outline-none resize-none focus:border-cobalt-primary"
                          />
                        </div>
                        {reviewMutation.isError && (
                          <div className="mb-3 rounded-lg bg-status-critical/10 border border-status-critical/30 px-3 py-2 text-xs text-status-critical">
                            Error: {reviewMutation.error?.message ?? 'Failed to submit correction'}
                          </div>
                        )}
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              cancelCorrecting()
                            }}
                            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-muted hover:bg-surface-700 hover:text-text-primary"
                          >
                            <X size={13} />
                            Cancel
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              submitCorrection()
                            }}
                            disabled={reviewMutation.isPending}
                            className="flex items-center gap-1.5 rounded-lg bg-cobalt-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-cobalt-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <Save size={13} />
                            {reviewMutation.isPending ? 'Submitting...' : 'Submit Edit'}
                          </button>
                        </div>
                      </div>
                    ) : (email.reviewStatus === 'NEEDS_REVIEW' ||
                      email.reviewStatus === 'FLAGGED') && (
                      <div className="mt-4 flex items-center justify-end gap-2 border-t border-border pt-3">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            startCorrecting(email.id, extractedData)
                          }}
                          disabled={reviewMutation.isPending}
                          className="flex items-center gap-1.5 rounded-lg border border-status-warning/30 px-3 py-1.5 text-xs font-medium text-status-warning hover:bg-status-warning/10 disabled:opacity-50"
                        >
                          <Edit3 size={13} />
                          Edit
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleApprove(email.id)
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
          <Pagination
            currentPage={page}
            totalPages={totalPages}
            totalItems={totalItems}
            pageSize={pageSize}
            onPageChange={setPage}
          />
        </div>
      )}
    </div>
  )
}

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

function AttachmentsSection({ emailId }: { emailId: string }) {
  const { data } = useEmailAttachments(emailId)
  const attachments = data?.attachments ?? []

  if (attachments.length === 0) return null

  return (
    <div className="mt-4">
      <h5 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-text-muted">
        <Paperclip size={12} />
        ATTACHMENTS ({attachments.length})
      </h5>
      <div className="space-y-1.5">
        {attachments.map((att) => {
          const Icon = getFileIcon(att.mimeType)
          return (
            <div
              key={att.id}
              className="flex items-center justify-between rounded-lg bg-surface-900 px-3 py-2"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Icon size={14} className="shrink-0 text-cobalt-primary-light" />
                <a
                  href={`/api/attachments/${att.id}/download`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="truncate text-xs text-text-primary hover:text-cobalt-primary-light hover:underline cursor-pointer"
                  title={`Open ${att.filename}`}
                >
                  {att.filename}
                </a>
                <span className="shrink-0 text-[10px] text-text-muted">
                  {formatFileSize(att.sizeBytes)}
                </span>
              </div>
              <a
                href={`/api/attachments/${att.id}/download`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="shrink-0 rounded p-1 text-text-muted hover:bg-surface-700 hover:text-cobalt-primary-light"
                title={`Download ${att.filename}`}
              >
                <Download size={13} />
              </a>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ReviewStatusBadge({ status }: { status: string | null }) {
  if (!status) return null

  const styles: Record<string, string> = {
    NEEDS_REVIEW: 'bg-status-warning/15 text-status-warning border-status-warning/30',
    AUTO_ACCEPTED: 'bg-status-success/15 text-status-success border-status-success/30',
    REVIEWED_OK: 'bg-status-success/15 text-status-success border-status-success/30',
    REVIEWED_CORRECTED: 'bg-cobalt-primary/15 text-cobalt-primary border-cobalt-primary/30',
  }

  const labels: Record<string, string> = {
    NEEDS_REVIEW: 'PENDING',
    AUTO_ACCEPTED: 'AUTO',
    REVIEWED_OK: 'APPROVED',
    REVIEWED_CORRECTED: 'CORRECTED',
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

function formatRawValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.join(', ')
  return String(value)
}

function EditableExtractedDataDisplay({
  data,
  onChange,
}: {
  data: Record<string, unknown>
  onChange: (field: string, value: string) => void
}) {
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
            <div className="space-y-1.5">
              {sectionData.map((field) => (
                <div key={field} className="flex items-center gap-2 text-xs">
                  <label className="w-28 shrink-0 text-text-muted">
                    {FIELD_LABELS[field] ?? field}
                  </label>
                  <input
                    type="text"
                    value={formatRawValue(data[field])}
                    onChange={(e) => onChange(field, e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    className="flex-1 rounded border border-cobalt-primary/30 bg-surface-900 px-2 py-1 font-mono text-xs text-text-primary outline-none focus:border-cobalt-primary focus:ring-1 focus:ring-cobalt-primary/30"
                  />
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function CorrectionDiffDisplay({
  original,
  corrected,
  reviewNotes,
  reviewedBy,
  reviewedAt,
}: {
  original: Record<string, unknown>
  corrected: Record<string, unknown>
  reviewNotes: string | null
  reviewedBy?: string | null
  reviewedAt?: string | null
}) {
  // Collect all fields present in either original or corrected
  const allFields = new Set([...Object.keys(original), ...Object.keys(corrected)])

  // Determine which fields changed
  const changedFields = new Set<string>()
  for (const field of allFields) {
    const origVal = formatExtractedValue(original[field])
    const corrVal = formatExtractedValue(corrected[field])
    if (origVal !== corrVal) changedFields.add(field)
  }

  const changedCount = changedFields.size

  if (Object.keys(corrected).length === 0 && Object.keys(original).length === 0) {
    return <p className="text-xs italic text-text-muted">No data extracted</p>
  }

  return (
    <div className="space-y-3">
      {/* Summary badge */}
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />
          {changedCount} field{changedCount !== 1 ? 's' : ''} corrected
        </span>
      </div>

      {/* Field-by-field diff grouped by section */}
      {Object.entries(FIELD_SECTIONS).map(([sectionTitle, fields]) => {
        const sectionFields = fields.filter(
          (f) =>
            (original[f] !== undefined && original[f] !== null && original[f] !== '') ||
            (corrected[f] !== undefined && corrected[f] !== null && corrected[f] !== '')
        )
        if (sectionFields.length === 0) return null

        return (
          <div key={sectionTitle}>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
              {sectionTitle}
            </div>
            <div className="space-y-1">
              {sectionFields.map((field) => {
                const origVal = formatExtractedValue(original[field])
                const corrVal = formatExtractedValue(corrected[field])
                const isChanged = changedFields.has(field)

                return (
                  <div key={field} className="flex items-start gap-2 text-xs">
                    <span className="w-28 shrink-0 text-text-muted">
                      {FIELD_LABELS[field] ?? field}
                    </span>
                    {isChanged ? (
                      <div className="flex-1 space-y-0.5">
                        <div className="flex items-center gap-1.5">
                          <span className="rounded bg-red-500/15 px-1.5 py-0.5 font-mono text-red-400 line-through">
                            {origVal || '(empty)'}
                          </span>
                          <span className="text-text-muted">→</span>
                          <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-emerald-400">
                            {corrVal || '(empty)'}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <span className="flex-1 font-mono text-text-secondary">
                        {corrVal}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}

      {/* Review notes */}
      {reviewNotes && (
        <div className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-400">
              Correction Notes
            </span>
            {reviewedBy && (
              <span className="text-[10px] text-text-muted">
                by {reviewedBy}
                {reviewedAt && ` · ${new Date(reviewedAt).toLocaleDateString()}`}
              </span>
            )}
          </div>
          <p className="text-xs leading-relaxed text-text-secondary">{reviewNotes}</p>
        </div>
      )}
    </div>
  )
}
