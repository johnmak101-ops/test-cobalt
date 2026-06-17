import type { ReactNode } from 'react'
import { ArrowRight, Bot, Edit3, Mail, Sparkles } from 'lucide-react'
import { cn } from '../../lib/utils'
import {
  diffKeys, fieldLabel, formatExtractedValue, formatRawValue, hasValue, sectionsWith,
} from '../../lib/review-fields'

// ─── Shared bits ─────────────────────────────────────────

const EmptyData = () => <p className="text-xs italic text-text-muted">No data extracted</p>

/** A section header bar — uniform across every data view; optional right-aligned chip. */
function SectionHeader({ title, chip }: { title: string; chip?: ReactNode }) {
  return (
    <div className="flex items-center justify-between bg-surface-900/40 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
      <span>{title}</span>
      {chip}
    </div>
  )
}

const Panel = ({ children }: { children: ReactNode }) => (
  <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">{children}</div>
)

const ChangeChip = ({ n }: { n: number }) => (
  <span className="inline-flex items-center gap-1 rounded-full bg-status-warning/15 px-1.5 py-0.5 text-[9px] font-semibold normal-case tracking-normal text-status-warning">
    {n} change{n !== 1 ? 's' : ''}
  </span>
)

// ─── Review status pill (card header) ────────────────────

const STATUS_STYLES: Record<string, string> = {
  NEEDS_REVIEW: 'bg-status-warning/15 text-status-warning border-status-warning/30',
  AUTO_ACCEPTED: 'bg-status-success/15 text-status-success border-status-success/30',
  REVIEWED_OK: 'bg-status-success/15 text-status-success border-status-success/30',
  REVIEWED_CORRECTED: 'bg-cobalt-primary/15 text-cobalt-primary border-cobalt-primary/30',
  REJECTED: 'bg-status-critical/15 text-status-critical border-status-critical/30',
}
const STATUS_LABELS: Record<string, string> = {
  NEEDS_REVIEW: 'PENDING', AUTO_ACCEPTED: 'AUTO', REVIEWED_OK: 'APPROVED', REVIEWED_CORRECTED: 'CORRECTED', REJECTED: 'REJECTED',
}

export function ReviewStatusBadge({ status }: { status: string | null }) {
  if (!status) return null
  return (
    <span className={cn('inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide', STATUS_STYLES[status] ?? 'bg-surface-700 text-text-muted border-border')}>
      {STATUS_LABELS[status] ?? status}
    </span>
  )
}

// ─── Plain extracted data (no agent suggestion) ──────────

export function ExtractedDataView({ data }: { data: Record<string, unknown> }) {
  const sections = sectionsWith((f) => hasValue(data[f]))
  if (sections.length === 0) return <EmptyData />
  return (
    <Panel>
      {sections.map(({ title, fields }) => (
        <div key={title}>
          <SectionHeader title={title} />
          <div className="grid grid-cols-1 gap-x-8 gap-y-2 px-3 py-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {fields.map((f) => (
              <div key={f} className="grid grid-cols-[120px_1fr] items-baseline gap-3 text-xs">
                <span className="text-text-muted">{fieldLabel(f)}</span>
                <span className="truncate font-mono text-text-primary" title={formatExtractedValue(data[f])}>{formatExtractedValue(data[f])}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </Panel>
  )
}

// ─── Extracted vs the agent's suggested change ───────────

export function SuggestionComparisonView({
  extractedData, suggestedData, reviewerNotes,
}: {
  extractedData: Record<string, unknown>
  suggestedData: Record<string, unknown>
  reviewerNotes: string | null
}) {
  const sections = sectionsWith((f) => hasValue(extractedData[f]) || hasValue(suggestedData[f]))
  const diffs = diffKeys(extractedData, suggestedData)
  const shown = sections.flatMap((s) => s.fields)
  const changeCount = shown.filter((f) => diffs.has(f)).length
  const matchCount = shown.length - changeCount

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h5 className="flex items-center gap-2 text-xs font-semibold text-text-muted"><Bot size={14} className="text-cobalt-primary-light" /> REVIEW COMPARISON</h5>
        <div className="flex items-center gap-2">
          {matchCount > 0 && <span className="text-[10px] text-text-muted">{matchCount} match{matchCount !== 1 ? 'es' : ''}</span>}
          {changeCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-status-warning/15 px-2 py-0.5 text-[10px] font-semibold text-status-warning">
              <Sparkles size={10} /> {changeCount} suggested change{changeCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      {reviewerNotes && (
        <div className="mb-3 rounded-lg border border-cobalt-primary/20 bg-cobalt-primary/5 p-3">
          <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-cobalt-primary-light">
            <Bot size={10} /> Reviewer Agent Notes
          </div>
          <p className="text-xs leading-relaxed text-text-secondary">{reviewerNotes}</p>
        </div>
      )}

      <Panel>
        <div className="grid grid-cols-[150px_1fr_1fr] bg-surface-900/60 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
          <span>Field</span>
          <span className="flex items-center gap-1"><Mail size={10} /> Extracted from Email</span>
          <span className="flex items-center gap-1"><Sparkles size={10} /> Suggested Change</span>
        </div>
        {sections.map(({ title, fields }) => {
          const sectionDiffs = fields.filter((f) => diffs.has(f)).length
          return (
            <div key={title}>
              <SectionHeader title={title} chip={sectionDiffs > 0 ? <ChangeChip n={sectionDiffs} /> : undefined} />
              {fields.map((f) => {
                const isDiff = diffs.has(f)
                return (
                  <div key={f} className={cn('grid grid-cols-[150px_1fr_1fr] items-center px-3 py-2 text-xs', isDiff && 'bg-status-warning/[0.03]')}>
                    <span className={cn('font-medium', isDiff ? 'text-text-primary' : 'text-text-muted')}>{fieldLabel(f)}</span>
                    <span className={cn('font-mono', isDiff ? 'text-text-muted line-through decoration-status-critical/40' : 'text-text-secondary')}>{formatExtractedValue(extractedData[f])}</span>
                    {isDiff ? (
                      <span className="flex items-center gap-1.5">
                        <ArrowRight size={10} className="shrink-0 text-status-warning" />
                        <span className="font-mono font-medium text-status-warning">{formatExtractedValue(suggestedData[f])}</span>
                      </span>
                    ) : (
                      <span className="font-mono text-text-muted/40">—</span>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}
      </Panel>
    </div>
  )
}

// ─── Editable fields (correction mode) ───────────────────

export function EditableFields({
  data, original, onChange,
}: {
  data: Record<string, unknown>
  original: Record<string, unknown>
  onChange: (field: string, value: string) => void
}) {
  const sections = sectionsWith((f) => hasValue(data[f]) || hasValue(original[f]))
  if (sections.length === 0) return <EmptyData />
  const diffs = diffKeys(original, data)

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h5 className="flex items-center gap-2 text-xs font-semibold text-text-muted"><Edit3 size={14} className="text-cobalt-primary-light" /> EDIT MODE</h5>
        <span className="text-[10px] text-text-muted">Original extracted → your edit</span>
      </div>
      <Panel>
        <div className="grid grid-cols-[150px_1fr_1fr] bg-surface-900/60 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
          <span>Field</span>
          <span className="flex items-center gap-1"><Mail size={10} /> Original</span>
          <span className="flex items-center gap-1"><Sparkles size={10} /> Your Edit</span>
        </div>
        {sections.map(({ title, fields }) => (
          <div key={title}>
            <SectionHeader title={title} />
            {fields.map((f) => {
              const isDiff = diffs.has(f)
              return (
                <div key={f} className={cn('grid grid-cols-[150px_1fr_1fr] items-center gap-2 px-3 py-1.5 text-xs', isDiff && 'bg-status-warning/[0.04]')}>
                  <label className={cn('font-medium', isDiff ? 'text-text-primary' : 'text-text-muted')}>{fieldLabel(f)}</label>
                  <span className={cn('font-mono text-[11px]', isDiff ? 'text-text-muted line-through decoration-status-critical/40' : 'text-text-secondary/60')}>{formatExtractedValue(original[f])}</span>
                  <div className="flex items-center gap-1.5">
                    {isDiff && <ArrowRight size={10} className="shrink-0 text-status-warning" />}
                    <input
                      type="text"
                      value={formatRawValue(data[f])}
                      onChange={(e) => onChange(f, e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      className={cn(
                        'flex-1 rounded border bg-surface-900 px-2 py-1 font-mono text-xs text-text-primary outline-none',
                        isDiff ? 'border-status-warning/50 focus:border-status-warning' : 'border-border focus:border-cobalt-primary',
                      )}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </Panel>
    </div>
  )
}

// ─── Correction history (already-reviewed items) ─────────

export function CorrectionDiffView({
  original, corrected, reviewNotes, reviewedAt,
}: {
  original: Record<string, unknown>
  corrected: Record<string, unknown>
  reviewNotes: string | null
  reviewedAt?: string | null
}) {
  const sections = sectionsWith((f) => hasValue(original[f]) || hasValue(corrected[f]))
  if (sections.length === 0) return <EmptyData />
  const changed = diffKeys(original, corrected)

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-full bg-status-warning/15 px-2 py-0.5 text-[10px] font-semibold text-status-warning">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-status-warning" />
          {changed.size} field{changed.size !== 1 ? 's' : ''} corrected
        </span>
      </div>
      <Panel>
        {sections.map(({ title, fields }) => (
          <div key={title}>
            <SectionHeader title={title} chip={fields.some((f) => changed.has(f)) ? <ChangeChip n={fields.filter((f) => changed.has(f)).length} /> : undefined} />
            <div className="space-y-1 px-3 py-2.5">
              {fields.map((f) => {
                const origVal = formatExtractedValue(original[f])
                const corrVal = formatExtractedValue(corrected[f])
                return (
                  <div key={f} className="grid grid-cols-[150px_1fr] items-start gap-2 text-xs">
                    <span className="text-text-muted">{fieldLabel(f)}</span>
                    {changed.has(f) ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="rounded bg-status-critical/15 px-1.5 py-0.5 font-mono text-status-critical line-through">{origVal || '(empty)'}</span>
                        <ArrowRight size={10} className="shrink-0 text-text-muted" />
                        <span className="rounded bg-status-success/15 px-1.5 py-0.5 font-mono text-status-success">{corrVal || '(empty)'}</span>
                      </div>
                    ) : (
                      <span className="font-mono text-text-secondary">{corrVal}</span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </Panel>
      {reviewNotes && (
        <div className="rounded-lg border border-status-warning/20 bg-status-warning/5 p-2.5">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-status-warning">Correction Notes</span>
            {reviewedAt && <span className="text-[10px] text-text-muted">· {new Date(reviewedAt).toLocaleDateString()}</span>}
          </div>
          <p className="text-xs leading-relaxed text-text-secondary">{reviewNotes}</p>
        </div>
      )}
    </div>
  )
}
