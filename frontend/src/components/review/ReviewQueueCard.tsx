import { useState } from 'react'
import {
  CheckCircle, ChevronDown, ChevronRight, ChevronUp, Edit3, ExternalLink, Mail,
  Save, Ship, X, XCircle,
} from 'lucide-react'
import { useReviewEmail, type ReviewEmail } from '../../hooks/use-review-queue'
import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { cn, formatRelativeTime, stateLabel } from '../../lib/utils'
import { openEmailWindow } from '../../lib/email'
import { diffKeys } from '../../lib/review-fields'
import {
  CorrectionDiffView, EditableFields, ExtractedDataView, ReviewStatusBadge, SuggestionComparisonView,
} from './ReviewDataViews'

const confidenceTier = (c: number) =>
  c >= 0.8
    ? { label: 'High', cls: 'bg-status-success/15 text-status-success' }
    : c >= 0.5
      ? { label: 'Med', cls: 'bg-status-warning/15 text-status-warning' }
      : { label: 'Low', cls: 'bg-status-critical/15 text-status-critical' }

/** One email in the review queue: a collapsible card that shows the extraction (plain, vs-suggested,
 *  editable, or as a correction diff) and the reviewer's actions. Owns its own edit state. */
export function ReviewQueueCard({ email, expanded, onToggle }: { email: ReviewEmail; expanded: boolean; onToggle: () => void }) {
  const review = useReviewEmail()
  const [correcting, setCorrecting] = useState(false)
  const [edited, setEdited] = useState<Record<string, unknown>>({})
  const [notes, setNotes] = useState('')

  const extracted = email.extractedData ?? {}
  const suggested = email.suggestedData
  const original = email.originalExtractedData
  const isCorrected = email.reviewStatus === 'REVIEWED_CORRECTED' && original !== null
  const isPending = email.reviewStatus === 'NEEDS_REVIEW'
  const tier = confidenceTier(email.extractionConfidence ?? 0)
  const diffCount = suggested ? diffKeys(extracted, suggested).size : 0

  const startCorrecting = () => {
    setEdited({ ...(suggested ?? extracted) })
    setNotes('')
    setCorrecting(true)
  }
  const submitCorrection = () =>
    review.mutate(
      { emailId: email.id, action: 'correct', notes: notes.trim() || 'Manual correction', corrections: { extractedData: { ...edited } } },
      { onSuccess: () => setCorrecting(false) },
    )

  return (
    <Card className="overflow-hidden">
      {/* Header row */}
      <div className="flex cursor-pointer items-start justify-between gap-4" onClick={onToggle}>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Mail size={14} className="shrink-0 text-text-muted" />
            <span className="truncate text-sm font-medium text-text-primary">{email.subject ?? '(no subject)'}</span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
            <span>{email.sender ?? 'unknown sender'}</span>
            <span className="text-border">|</span>
            <span>{email.receivedAt ? formatRelativeTime(email.receivedAt) : '—'}</span>
            {email.emailType && (
              <>
                <span className="text-border">|</span>
                <Badge variant="emailType" value={email.emailType} />
              </>
            )}
            {email.jobNo && (
              <>
                <span className="text-border">|</span>
                <span className="inline-flex items-center gap-1 text-cobalt-primary-light">
                  <Ship size={11} />
                  <span className="font-mono text-[11px]">{email.jobNo}</span>
                  {email.shipmentState && <span className="text-text-muted">({stateLabel(email.shipmentState)})</span>}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <span className={cn('inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold', tier.cls)}>{tier.label}</span>
          {diffCount > 0 && isPending && (
            <span className="inline-flex items-center gap-1 rounded-full bg-status-warning/15 px-2 py-0.5 text-[10px] font-semibold text-status-warning">
              {diffCount} diff{diffCount !== 1 ? 's' : ''}
            </span>
          )}
          <ReviewStatusBadge status={email.reviewStatus} />
          {expanded ? <ChevronUp size={14} className="text-text-muted" /> : <ChevronDown size={14} className="text-text-muted" />}
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="mt-4 border-t border-border pt-4">
          {/* Email body — collapsible */}
          <details className="group mb-4">
            <summary className="mb-2 flex cursor-pointer select-none items-center justify-between gap-1.5 text-xs font-semibold text-text-muted">
              <span className="flex items-center gap-1.5">
                <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
                EMAIL BODY
              </span>
              {email.graphMessageId && (
                <button
                  onClick={(e) => { e.stopPropagation(); openEmailWindow(email.graphMessageId!) }}
                  className="inline-flex items-center gap-1 text-cobalt-primary-light hover:underline"
                >
                  <ExternalLink size={11} /> View original
                </button>
              )}
            </summary>
            <div className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg bg-surface-900 p-3 text-xs leading-relaxed text-text-secondary">
              {email.bodyText?.slice(0, 2000) ?? '(no text content)'}
            </div>
          </details>

          {/* Data view — depends on state */}
          {correcting ? (
            <EditableFields data={edited} original={extracted} onChange={(f, v) => setEdited((p) => ({ ...p, [f]: v }))} />
          ) : isCorrected ? (
            <CorrectionDiffView original={original!} corrected={extracted} reviewNotes={email.reviewNotes} reviewedAt={email.reviewedAt} />
          ) : suggested ? (
            <SuggestionComparisonView extractedData={extracted} suggestedData={suggested} reviewerNotes={email.reviewerNotes} />
          ) : (
            <ExtractedDataView data={extracted} />
          )}

          {/* Action bar */}
          {correcting ? (
            <div className="mt-4 border-t border-border pt-3">
              <label className="mb-1 flex items-center gap-1 text-xs font-semibold text-text-muted">
                CORRECTION NOTES<span className="text-status-critical">*</span>
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                placeholder="Explain what was wrong and why you made this correction…"
                rows={2}
                className={cn(
                  'w-full resize-none rounded-lg border bg-surface-900 px-3 py-2 text-xs text-text-primary outline-none placeholder:text-text-muted',
                  notes.trim() ? 'border-border focus:border-cobalt-primary' : 'border-status-warning/50 focus:border-status-warning',
                )}
              />
              {!notes.trim() && <p className="mt-1 text-[10px] text-status-warning">Please provide correction notes.</p>}
              {review.isError && (
                <div className="mt-3 rounded-lg border border-status-critical/30 bg-status-critical/10 px-3 py-2 text-xs text-status-critical">
                  Error: {review.error?.message ?? 'Failed to submit correction'}
                </div>
              )}
              <div className="mt-3 flex items-center justify-end gap-2">
                <button
                  onClick={(e) => { e.stopPropagation(); setCorrecting(false) }}
                  className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-muted hover:bg-surface-700 hover:text-text-primary"
                >
                  <X size={13} /> Cancel
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); submitCorrection() }}
                  disabled={review.isPending || !notes.trim()}
                  title={!notes.trim() ? 'Correction notes are required' : undefined}
                  className="flex items-center gap-1.5 rounded-lg bg-cobalt-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-cobalt-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Save size={13} /> {review.isPending ? 'Submitting…' : 'Submit Edit'}
                </button>
              </div>
            </div>
          ) : isPending ? (
            <div className="mt-4 flex items-center justify-end gap-2 border-t border-border pt-3">
              <button
                onClick={(e) => { e.stopPropagation(); startCorrecting() }}
                disabled={review.isPending}
                className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-700 hover:text-text-primary disabled:opacity-50"
              >
                <Edit3 size={13} /> Edit
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); review.mutate({ emailId: email.id, action: 'reject', notes: 'Rejected by reviewer' }) }}
                disabled={review.isPending}
                className="flex items-center gap-1.5 rounded-lg border border-status-critical/30 px-3 py-1.5 text-xs font-medium text-status-critical hover:bg-status-critical/10 disabled:opacity-50"
              >
                <XCircle size={13} /> Reject
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); review.mutate({ emailId: email.id, action: 'approve' }) }}
                disabled={review.isPending}
                className="flex items-center gap-1.5 rounded-lg bg-status-success px-3 py-1.5 text-xs font-medium text-white hover:bg-status-success/90 disabled:opacity-50"
              >
                <CheckCircle size={13} /> {suggested ? 'Approve Suggestion' : 'Approve'}
              </button>
            </div>
          ) : null}
        </div>
      )}
    </Card>
  )
}
