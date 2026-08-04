/**
 * ONE shell for every block on the review desk.
 *
 * The card had fifteen kinds of block and eight ways of drawing one. `REVIEW_PANEL` existed and
 * exactly one block used it; the rest hand-rolled a container each — `rounded-lg` with a fill,
 * `rounded-lg` without, `rounded-md` at 80% opacity on a different surface, `rounded-xl` in the
 * accent colour, a bare table, and — for seven of them — no container at all. Those seven were the
 * worst of it: a grey sentence floating between two bordered boxes belongs, visually, to neither, so
 * the operator had to read it to find out what it was attached to.
 *
 * Text drifted the same way: seven sizes for the same class of content (`text-base`, `text-sm`,
 * `13px`, `text-xs`, `11px`, `10.5px`, `10px`), four of them written as arbitrary values that exist
 * nowhere else in the app. And colour meant four different things at once — a green fill for
 * "nothing to do", an amber fill for "you are editing", amber text for a cross-mode fact, a blue
 * border for an email preview — so the one thing colour never told you was which blocks wanted work.
 *
 * This shell fixes the vocabulary rather than each site:
 *   - one container: hairline border, 12px radius, `surface-900`, never tinted;
 *   - one header: 16px icon, 13px medium title, optional count, status pill hard right;
 *   - two text sizes below it — 14px body, 12px meta. No 11px, no 10.5px;
 *   - colour appears ONLY in the pill, so a column of identical boxes reads at a glance as
 *     "these two want an answer, the rest are reading material".
 *
 * Approved by the operator desk (2026-07-31) from a mockup of the whole card in this shell.
 */
import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, type LucideIcon } from 'lucide-react'
import { cn } from '../../lib/utils'

/**
 * What the block wants from the operator. `answer` is the only value that draws colour — everything
 * else is deliberately quiet, because a desk where six boxes are highlighted has highlighted none.
 */
export type ReviewBlockStatus = 'answer' | 'none'

export interface ReviewBlockProps {
  title: string
  icon?: LucideIcon
  /** Rendered after the title in muted type — a source-email count, a row count. */
  count?: number | string | null
  status?: ReviewBlockStatus
  /** Overrides the pill wording. The default says what the status means, not what the block is. */
  statusLabel?: string
  /** Collapsible blocks get a chevron and a button header; omit for a static one. */
  collapsible?: boolean
  defaultOpen?: boolean
  /** Header-right controls (Edit, Add PO) — kept out of the pill's slot. */
  action?: ReactNode
  children?: ReactNode
  /** Body padding off, for a block whose child is a full-bleed table. */
  flush?: boolean
  className?: string
  'data-testid'?: string
  /** Testid for the title text itself — the block's headline IS the open question on the needs-
   *  attention block, and the desk reaches for it by name. */
  titleTestId?: string
}

const PILL: Record<ReviewBlockStatus, string> = {
  answer: 'bg-status-warning/15 text-status-warning',
  none: 'text-text-muted',
}

const PILL_TEXT: Record<ReviewBlockStatus, string> = {
  answer: 'needs answer',
  none: 'no action',
}

export function ReviewBlock({
  title,
  icon: Icon,
  count,
  status = 'none',
  statusLabel,
  collapsible = false,
  defaultOpen = false,
  action,
  children,
  flush = false,
  className,
  'data-testid': testId,
  titleTestId,
}: ReviewBlockProps) {
  const [open, setOpen] = useState(defaultOpen)
  const body = collapsible ? open : true
  const hasBody = children != null && body

  const header = (
    <>
      {collapsible ? (
        open ? (
          <ChevronDown size={16} className="shrink-0 text-text-muted" />
        ) : (
          <ChevronRight size={16} className="shrink-0 text-text-muted" />
        )
      ) : (
        Icon && <Icon size={16} className="shrink-0 text-text-muted" />
      )}
      <span
        className="min-w-0 truncate text-[13px] font-medium text-text-primary"
        data-testid={titleTestId}
      >
        {title}
      </span>
      {count != null && count !== '' && (
        <span className="shrink-0 text-[13px] text-text-muted">{count}</span>
      )}
      <span className="ml-auto flex shrink-0 items-center gap-2">
        {action}
        <span
          className={cn('rounded-md px-2 py-0.5 text-xs font-medium', PILL[status])}
          data-testid={testId ? `${testId}-status` : undefined}
        >
          {statusLabel ?? PILL_TEXT[status]}
        </span>
      </span>
    </>
  )

  return (
    <div
      className={cn('rounded-xl border border-border bg-surface-900', className)}
      data-testid={testId}
      data-status={status}
    >
      {collapsible ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className={cn(
            'flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-surface-800/60',
            hasBody && 'border-b border-border',
          )}
        >
          {header}
        </button>
      ) : (
        <div
          className={cn(
            'flex items-center gap-2 px-3 py-2.5',
            hasBody && 'border-b border-border',
          )}
        >
          {header}
        </div>
      )}
      {hasBody && <div className={flush ? undefined : 'px-3 py-2.5'}>{children}</div>}
    </div>
  )
}
