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
  XCircle,
  Save,
  Mail,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Paperclip,
  FileText,
  FileSpreadsheet,
  File,
  Download,
  ArrowRight,
  Ship,
  Bot,
  Sparkles,
} from 'lucide-react'

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

  const handleReject = (emailId: string) => {
    if (!user) return
    reviewMutation.mutate({
      emailId,
      action: 'reject',
      reviewedBy: user.id,
      notes: 'Rejected by reviewer',
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

  // Tab definitions with counts
  const statusTabs = [
    { key: undefined, label: 'Pending Review', count: counts?.pending },
    { key: 'REVIEWED_OK', label: 'Approved', count: counts?.REVIEWED_OK },
    { key: 'REVIEWED_CORRECTED', label: 'Corrected', count: counts?.REVIEWED_CORRECTED },
    { key: 'REJECTED', label: 'Rejected', count: counts?.REJECTED },
  ]

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

      {/* Filter tabs with counts */}
      <div className="flex gap-1 rounded-lg bg-surface-900 p-1">
        {statusTabs.map((tab) => (
          <button
            key={tab.key ?? 'pending'}
            onClick={() => {
              setActiveTab(tab.key)
              setPage(1)
            }}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              activeTab === tab.key
                ? 'bg-cobalt-primary text-white'
                : 'text-text-muted hover:text-text-primary'
            )}
          >
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span
                className={cn(
                  'inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold',
                  activeTab === tab.key
                    ? 'bg-white/20 text-white'
                    : 'bg-surface-600 text-text-muted'
                )}
              >
                {tab.count}
              </span>
            )}
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
            } catch { /* skip */ }
            let suggestedData: Record<string, unknown> | null = null
            try {
              suggestedData = email.suggestedData ? JSON.parse(email.suggestedData) : null
            } catch { /* skip */ }
            let originalData: Record<string, unknown> | null = null
            try {
              originalData = email.originalExtractedData ? JSON.parse(email.originalExtractedData) : null
            } catch { /* skip */ }
            const isCorrected = email.reviewStatus === 'REVIEWED_CORRECTED' && originalData !== null

            // Count diffs for badge on card header
            let diffCount = 0
            if (suggestedData) {
              const allKeys = new Set([...Object.keys(extractedData), ...Object.keys(suggestedData)])
              for (const k of allKeys) {
                if (formatExtractedValue(extractedData[k]) !== formatExtractedValue(suggestedData[k])) diffCount++
              }
            }

            // Parse shipment PO numbers
            let shipmentPOs: string[] = []
            if (email.shipment?.poNumbers) {
              try { shipmentPOs = JSON.parse(email.shipment.poNumbers) } catch { /* skip */ }
            }

            return (
              <Card key={email.id} className="overflow-hidden">
                {/* Header row — redesigned */}
                <div
                  className="flex cursor-pointer items-start justify-between gap-4"
                  onClick={() => setExpandedId(isExpanded ? null : email.id)}
                >
                  {/* Left: email info + shipment context */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Mail size={14} className="shrink-0 text-text-muted" />
                      <span className="truncate text-sm font-medium text-text-primary">
                        {email.subject}
                      </span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
                      <span>{email.sender}</span>
                      <span className="text-border">|</span>
                      <span>{formatRelativeTime(email.receivedAt)}</span>
                      {email.emailType && (
                        <>
                          <span className="text-border">|</span>
                          <Badge variant="emailType" value={email.emailType} />
                        </>
                      )}
                      {/* Linked shipment info */}
                      {email.shipment && (
                        <>
                          <span className="text-border">|</span>
                          <span className="inline-flex items-center gap-1 text-cobalt-primary-light">
                            <Ship size={11} />
                            <span className="font-mono text-[11px]">
                              {shipmentPOs.length > 0 ? shipmentPOs.join(', ') : email.shipment.id}
                            </span>
                            {email.shipment.route && (
                              <span className="text-text-muted">({email.shipment.route})</span>
                            )}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Right: confidence + status + diff indicator */}
                  <div className="flex shrink-0 items-center gap-3">
                    {/* Confidence */}
                    <div className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          'inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold',
                          confidence >= 0.8
                            ? 'bg-status-success/15 text-status-success'
                            : confidence >= 0.5
                              ? 'bg-status-warning/15 text-status-warning'
                              : 'bg-status-critical/15 text-status-critical'
                        )}
                      >
                        {confidence >= 0.8 ? 'High' : confidence >= 0.5 ? 'Med' : 'Low'}
                      </span>
                    </div>

                    {/* Diff count indicator (only for NEEDS_REVIEW with suggestions) */}
                    {diffCount > 0 && email.reviewStatus === 'NEEDS_REVIEW' && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-status-warning/15 px-2 py-0.5 text-[10px] font-semibold text-status-warning">
                        {diffCount} diff{diffCount !== 1 ? 's' : ''}
                      </span>
                    )}

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
                    {/* Email body — collapsible */}
                    <details className="mb-4 group">
                      <summary className="mb-2 flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-text-muted select-none">
                        <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
                        EMAIL BODY
                      </summary>
                      <div className="max-h-48 overflow-y-auto rounded-lg bg-surface-900 p-3 text-xs leading-relaxed text-text-secondary whitespace-pre-wrap">
                        {email.bodyText?.slice(0, 2000) ?? '(no text content)'}
                      </div>
                    </details>

                    {/* Data display — depends on state */}
                    {correctingId === email.id ? (
                      <EditableExtractedDataDisplay
                        data={correctedData}
                        originalExtracted={extractedData}
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
                    ) : suggestedData ? (
                      <SuggestionComparisonView
                        extractedData={extractedData}
                        suggestedData={suggestedData}
                        reviewerNotes={email.reviewerNotes}
                      />
                    ) : (
                      <div>
                        <h5 className="mb-2 text-xs font-semibold text-text-muted">
                          EXTRACTED DATA
                        </h5>
                        <ExtractedDataDisplay data={extractedData} />
                      </div>
                    )}

                    {/* Attachments */}
                    <AttachmentsSection emailId={email.id} />

                    {/* Action bar */}
                    {correctingId === email.id ? (
                      <div className="mt-4 border-t border-border pt-3">
                        <div className="mb-3">
                          <label className="mb-1 flex items-center gap-1 text-xs font-semibold text-text-muted">
                            CORRECTION NOTES
                            <span className="text-status-critical">*</span>
                          </label>
                          <textarea
                            value={correctionNotes}
                            onChange={(e) => setCorrectionNotes(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            placeholder="Explain what was wrong and why you made this correction..."
                            rows={2}
                            className={cn(
                              'w-full rounded-lg border bg-surface-900 px-3 py-2 text-xs text-text-primary placeholder:text-text-muted outline-none resize-none',
                              correctionNotes.trim()
                                ? 'border-border focus:border-cobalt-primary'
                                : 'border-status-warning/50 focus:border-status-warning'
                            )}
                          />
                          {!correctionNotes.trim() && (
                            <p className="mt-1 text-[10px] text-status-warning">
                              Please provide correction notes.
                            </p>
                          )}
                        </div>
                        {reviewMutation.isError && (
                          <div className="mb-3 rounded-lg bg-status-critical/10 border border-status-critical/30 px-3 py-2 text-xs text-status-critical">
                            Error: {reviewMutation.error?.message ?? 'Failed to submit correction'}
                          </div>
                        )}
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={(e) => { e.stopPropagation(); cancelCorrecting() }}
                            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-muted hover:bg-surface-700 hover:text-text-primary"
                          >
                            <X size={13} />
                            Cancel
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); submitCorrection() }}
                            disabled={reviewMutation.isPending || !correctionNotes.trim()}
                            title={!correctionNotes.trim() ? 'Correction notes are required' : undefined}
                            className="flex items-center gap-1.5 rounded-lg bg-cobalt-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-cobalt-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <Save size={13} />
                            {reviewMutation.isPending ? 'Submitting...' : 'Submit Edit'}
                          </button>
                        </div>
                      </div>
                    ) : (email.reviewStatus === 'NEEDS_REVIEW' ||
                      email.reviewStatus === 'FLAGGED') && (
                      <div className="mt-4 flex items-center justify-end border-t border-border pt-3">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              startCorrecting(email.id, suggestedData ?? extractedData)
                            }}
                            disabled={reviewMutation.isPending}
                            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-700 hover:text-text-primary disabled:opacity-50"
                          >
                            <Edit3 size={13} />
                            Edit
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleReject(email.id) }}
                            disabled={reviewMutation.isPending}
                            className="flex items-center gap-1.5 rounded-lg border border-status-critical/30 px-3 py-1.5 text-xs font-medium text-status-critical hover:bg-status-critical/10 disabled:opacity-50"
                          >
                            <XCircle size={13} />
                            Reject
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleApprove(email.id) }}
                            disabled={reviewMutation.isPending}
                            className="flex items-center gap-1.5 rounded-lg bg-status-success px-3 py-1.5 text-xs font-medium text-white hover:bg-status-success/90 disabled:opacity-50"
                          >
                            <CheckCircle size={13} />
                            {suggestedData ? 'Approve Suggestion' : 'Approve'}
                          </button>
                        </div>
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

// ─── Utility components ───────────────────────────────────

function ChevronRight({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
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
            <div key={att.id} className="flex items-center justify-between rounded-lg bg-surface-900 px-3 py-2">
              <div className="flex items-center gap-2 min-w-0">
                <Icon size={14} className="shrink-0 text-cobalt-primary-light" />
                <a
                  href={`/api/attachments/${att.id}/download`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="truncate text-xs text-text-primary hover:text-cobalt-primary-light hover:underline cursor-pointer"
                >
                  {att.filename}
                </a>
                <span className="shrink-0 text-[10px] text-text-muted">{formatFileSize(att.sizeBytes)}</span>
              </div>
              <a
                href={`/api/attachments/${att.id}/download`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="shrink-0 rounded p-1 text-text-muted hover:bg-surface-700 hover:text-cobalt-primary-light"
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
    REJECTED: 'bg-status-critical/15 text-status-critical border-status-critical/30',
  }
  const labels: Record<string, string> = {
    NEEDS_REVIEW: 'PENDING',
    AUTO_ACCEPTED: 'AUTO',
    REVIEWED_OK: 'APPROVED',
    REVIEWED_CORRECTED: 'CORRECTED',
    REJECTED: 'REJECTED',
  }
  return (
    <span className={cn('inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide', styles[status] ?? 'bg-surface-700 text-text-muted border-border')}>
      {labels[status] ?? status}
    </span>
  )
}

// ─── Field definitions ───────────────────────────────────

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
  quantity_unit: 'UOM',
  quantity_raw: 'Qty (raw)',
  booking_no: 'Booking No.',
  so_number: 'SO#',
  item_style_no: 'Item / Style No.',
  consignee_name: 'Consignee Name',
  consignee_address: 'Consignee Address',
  mbl_number: 'MBL',
  container_no: 'Container No.',
  scac_code: 'SCAC Code',
  warehouse_start_date: 'WH Start Date',
  warehouse_end_date: 'WH End Date',
  in_dc_date: 'In DC Date',
}

const FIELD_SECTIONS: Record<string, string[]> = {
  'Order Info': ['po_numbers', 'customer', 'forwarder', 'route', 'booking_no', 'so_number', 'item_style_no'],
  'Cargo & Logistics': ['quantity', 'quantity_unit', 'quantity_raw', 'container_no', 'hbl_number', 'mbl_number', 'scac_code', 'warehouse_address'],
  'Shipping Parties': ['consignee_name', 'consignee_address', 'vessel', 'voyage_number'],
  'Dates': ['crd', 'cfs_cutoff', 'warehouse_start_date', 'warehouse_end_date', 'etd', 'eta', 'in_dc_date'],
}

// ─── Comparison view: Extracted vs Suggested ─────────────

function hasValue(v: unknown): boolean {
  if (v === null || v === undefined || v === '') return false
  if (Array.isArray(v) && v.length === 0) return false
  return true
}

function SuggestionComparisonView({
  extractedData,
  suggestedData,
  reviewerNotes,
}: {
  extractedData: Record<string, unknown>
  suggestedData: Record<string, unknown>
  reviewerNotes: string | null
}) {
  // Only include fields where at least one side has actual data
  const allKeys = new Set([...Object.keys(extractedData), ...Object.keys(suggestedData)])
  const rows: { field: string; extracted: string; suggested: string; isDiff: boolean }[] = []
  for (const key of allKeys) {
    if (!hasValue(extractedData[key]) && !hasValue(suggestedData[key])) continue
    const extracted = formatExtractedValue(extractedData[key])
    const suggested = formatExtractedValue(suggestedData[key])
    rows.push({ field: key, extracted, suggested, isDiff: extracted !== suggested })
  }

  const changeCount = rows.filter((r) => r.isDiff).length
  const matchCount = rows.length - changeCount

  return (
    <div>
      {/* Header bar */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot size={14} className="text-cobalt-primary-light" />
          <h5 className="text-xs font-semibold text-text-muted">REVIEW COMPARISON</h5>
        </div>
        <div className="flex items-center gap-2">
          {matchCount > 0 && (
            <span className="text-[10px] text-text-muted">
              {matchCount} match{matchCount !== 1 ? 'es' : ''}
            </span>
          )}
          {changeCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-status-warning/15 px-2 py-0.5 text-[10px] font-semibold text-status-warning">
              <Sparkles size={10} />
              {changeCount} suggested change{changeCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      {/* Reviewer agent notes */}
      {reviewerNotes && (
        <div className="mb-3 rounded-lg border border-cobalt-primary/20 bg-cobalt-primary/5 p-3">
          <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-cobalt-primary-light">
            <Bot size={10} />
            Reviewer Agent Notes
          </div>
          <p className="text-xs leading-relaxed text-text-secondary">{reviewerNotes}</p>
        </div>
      )}

      {/* Comparison table */}
      <div className="overflow-hidden rounded-lg border border-border">
        {/* Column header */}
        <div className="grid grid-cols-[160px_1fr_1fr] border-b border-border bg-surface-900 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
          <span>Field</span>
          <span className="flex items-center gap-1">
            <Mail size={10} />
            Extracted from Email
          </span>
          <span className="flex items-center gap-1">
            <Sparkles size={10} />
            Suggested Change
          </span>
        </div>

        <div className="divide-y divide-border">
          {Object.entries(FIELD_SECTIONS).map(([sectionTitle, fields]) => {
            const sectionRows = rows.filter((r) => fields.includes(r.field))
            if (sectionRows.length === 0) return null
            const sectionHasDiff = sectionRows.some((r) => r.isDiff)

            return (
              <div key={sectionTitle}>
                <div className={cn(
                  'px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider',
                  sectionHasDiff ? 'bg-status-warning/5 text-status-warning' : 'bg-surface-900/50 text-text-muted'
                )}>
                  {sectionTitle}
                  {sectionHasDiff && (
                    <span className="ml-2 text-[9px] font-normal normal-case">
                      ({sectionRows.filter(r => r.isDiff).length} change{sectionRows.filter(r => r.isDiff).length !== 1 ? 's' : ''})
                    </span>
                  )}
                </div>
                {sectionRows.map((row) => (
                  <div
                    key={row.field}
                    className={cn(
                      'grid grid-cols-[160px_1fr_1fr] items-center px-3 py-2 text-xs',
                      row.isDiff ? 'bg-status-warning/[0.03]' : ''
                    )}
                  >
                    <span className={cn('font-medium', row.isDiff ? 'text-text-primary' : 'text-text-muted')}>
                      {FIELD_LABELS[row.field] ?? row.field}
                    </span>
                    <span className={cn(
                      'font-mono',
                      row.isDiff ? 'text-text-muted line-through decoration-status-critical/40' : 'text-text-secondary'
                    )}>
                      {row.extracted}
                    </span>
                    {row.isDiff ? (
                      <span className="flex items-center gap-1.5">
                        <ArrowRight size={10} className="shrink-0 text-status-warning" />
                        <span className="font-mono font-medium text-status-warning">{row.suggested}</span>
                      </span>
                    ) : (
                      <span className="font-mono text-text-muted/40">—</span>
                    )}
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── Simple extracted data display ───────────────────────

function ExtractedDataDisplay({ data }: { data: Record<string, unknown> }) {
  if (Object.keys(data).length === 0) {
    return <p className="text-xs italic text-text-muted">No data extracted</p>
  }
  return (
    <div className="space-y-3">
      {Object.entries(FIELD_SECTIONS).map(([sectionTitle, fields]) => {
        const sectionData = fields.filter((f) => hasValue(data[f]))
        if (sectionData.length === 0) return null
        return (
          <div key={sectionTitle}>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted">{sectionTitle}</div>
            <div className="space-y-1">
              {sectionData.map((field) => (
                <div key={field} className="flex justify-between gap-2 text-xs">
                  <span className="text-text-muted">{FIELD_LABELS[field] ?? field}</span>
                  <span className="font-mono text-text-primary text-right">{formatExtractedValue(data[field])}</span>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Formatters ──────────────────────────────────────────

function formatExtractedValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (Array.isArray(value)) return value.join(', ') || '—'
  if (typeof value === 'number') return String(value)
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

// ─── Editable fields with comparison context ────────────

function EditableExtractedDataDisplay({
  data,
  originalExtracted,
  onChange,
}: {
  data: Record<string, unknown>
  originalExtracted?: Record<string, unknown>
  onChange: (field: string, value: string) => void
}) {
  // Determine which fields to show: any field that has data in either source
  const allKeys = new Set([
    ...Object.keys(data),
    ...(originalExtracted ? Object.keys(originalExtracted) : []),
  ])

  if (allKeys.size === 0) {
    return <p className="text-xs italic text-text-muted">No data extracted</p>
  }

  // Group fields by section, including unsectioned
  const sectionedFields = new Set(Object.values(FIELD_SECTIONS).flat())
  const unsectionedKeys = [...allKeys].filter(
    (k) => !sectionedFields.has(k) && (hasValue(data[k]) || (originalExtracted && hasValue(originalExtracted[k])))
  )

  const renderFieldRow = (field: string) => {
    const currentVal = formatRawValue(data[field])
    const originalVal = originalExtracted ? formatExtractedValue(originalExtracted[field]) : null
    const isDiff = originalExtracted && formatExtractedValue(data[field]) !== formatExtractedValue(originalExtracted[field])

    return (
      <div
        key={field}
        className={cn(
          'grid grid-cols-[140px_1fr_1fr] items-center gap-2 rounded-md px-2 py-1.5 text-xs',
          isDiff ? 'bg-status-warning/[0.05]' : ''
        )}
      >
        {/* Field label */}
        <label className={cn('font-medium', isDiff ? 'text-text-primary' : 'text-text-muted')}>
          {FIELD_LABELS[field] ?? field}
        </label>

        {/* Original extracted value (read-only reference) */}
        {originalExtracted ? (
          <div className="flex items-center gap-1">
            <span className={cn(
              'font-mono text-[11px]',
              isDiff ? 'text-text-muted line-through decoration-status-critical/40' : 'text-text-secondary/60'
            )}>
              {originalVal || '—'}
            </span>
          </div>
        ) : (
          <span className="text-text-muted/40">—</span>
        )}

        {/* Editable field */}
        <div className="flex items-center gap-1.5">
          {isDiff && <ArrowRight size={10} className="shrink-0 text-status-warning" />}
          <input
            type="text"
            value={currentVal}
            onChange={(e) => onChange(field, e.target.value)}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              'flex-1 rounded border bg-surface-900 px-2 py-1 font-mono text-xs text-text-primary outline-none',
              isDiff
                ? 'border-status-warning/50 focus:border-status-warning focus:ring-1 focus:ring-status-warning/30'
                : 'border-border focus:border-cobalt-primary focus:ring-1 focus:ring-cobalt-primary/30'
            )}
          />
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* Header explanation */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Edit3 size={14} className="text-cobalt-primary-light" />
          <h5 className="text-xs font-semibold text-text-muted">EDIT MODE</h5>
        </div>
        {originalExtracted && (
          <span className="text-[10px] text-text-muted">
            Showing: Original extracted → Editable value
          </span>
        )}
      </div>

      {/* Column headers */}
      {originalExtracted && (
        <div className="mb-2 grid grid-cols-[140px_1fr_1fr] gap-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
          <span>Field</span>
          <span className="flex items-center gap-1">
            <Mail size={10} />
            Original Extracted
          </span>
          <span className="flex items-center gap-1">
            <Sparkles size={10} />
            Your Edit
          </span>
        </div>
      )}

      <div className="space-y-2 rounded-lg border border-border p-2">
        {Object.entries(FIELD_SECTIONS).map(([sectionTitle, fields]) => {
          const sectionFields = fields.filter(
            (f) => hasValue(data[f]) || (originalExtracted && hasValue(originalExtracted[f]))
          )
          if (sectionFields.length === 0) return null

          const sectionHasDiff = originalExtracted && sectionFields.some(
            (f) => formatExtractedValue(data[f]) !== formatExtractedValue(originalExtracted[f])
          )

          return (
            <div key={sectionTitle}>
              <div className={cn(
                'mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider',
                sectionHasDiff ? 'text-status-warning' : 'text-text-muted'
              )}>
                {sectionTitle}
              </div>
              {sectionFields.map(renderFieldRow)}
            </div>
          )
        })}

        {/* Unsectioned fields */}
        {unsectionedKeys.length > 0 && (
          <div>
            <div className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
              Other Fields
            </div>
            {unsectionedKeys.map(renderFieldRow)}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Correction diff (for already-reviewed items) ───────

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
  const allFields = new Set([...Object.keys(original), ...Object.keys(corrected)])
  const changedFields = new Set<string>()
  for (const field of allFields) {
    if (formatExtractedValue(original[field]) !== formatExtractedValue(corrected[field])) changedFields.add(field)
  }
  const changedCount = changedFields.size

  if (Object.keys(corrected).length === 0 && Object.keys(original).length === 0) {
    return <p className="text-xs italic text-text-muted">No data extracted</p>
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />
          {changedCount} field{changedCount !== 1 ? 's' : ''} corrected
        </span>
      </div>

      {Object.entries(FIELD_SECTIONS).map(([sectionTitle, fields]) => {
        const sectionFields = fields.filter((f) => hasValue(original[f]) || hasValue(corrected[f]))
        if (sectionFields.length === 0) return null
        return (
          <div key={sectionTitle}>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted">{sectionTitle}</div>
            <div className="space-y-1">
              {sectionFields.map((field) => {
                const origVal = formatExtractedValue(original[field])
                const corrVal = formatExtractedValue(corrected[field])
                const isChanged = changedFields.has(field)
                return (
                  <div key={field} className="flex items-start gap-2 text-xs">
                    <span className="w-32 shrink-0 text-text-muted">{FIELD_LABELS[field] ?? field}</span>
                    {isChanged ? (
                      <div className="flex-1 flex items-center gap-1.5">
                        <span className="rounded bg-red-500/15 px-1.5 py-0.5 font-mono text-red-400 line-through">{origVal || '(empty)'}</span>
                        <span className="text-text-muted">→</span>
                        <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-emerald-400">{corrVal || '(empty)'}</span>
                      </div>
                    ) : (
                      <span className="flex-1 font-mono text-text-secondary">{corrVal}</span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}

      {reviewNotes && (
        <div className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-400">Correction Notes</span>
            {reviewedBy && (
              <span className="text-[10px] text-text-muted">
                by {reviewedBy}{reviewedAt && ` · ${new Date(reviewedAt).toLocaleDateString()}`}
              </span>
            )}
          </div>
          <p className="text-xs leading-relaxed text-text-secondary">{reviewNotes}</p>
        </div>
      )}
    </div>
  )
}
