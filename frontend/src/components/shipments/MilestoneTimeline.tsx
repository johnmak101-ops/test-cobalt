import { cn, formatDate } from '../../lib/utils'
import { Check, Ship, Plane } from 'lucide-react'

interface Milestone {
  id: string
  milestoneType: string
  occurredAt: string
  notes: string | null
}

interface MilestoneTimelineProps {
  milestones: Milestone[]
  currentStatus: string
  horizontal?: boolean
  // Transport mode (SEA*/AIR) — picks the in-progress icon (a breathing ship vs plane). Null → a
  // mode-agnostic breathing dot.
  mode?: string | null
  // DEPARTED/ARRIVED have no milestone EVENT — the backend tracks them as the shipment's atd/ata
  // (actual) and etd/eta (estimated) dates. Pass them so those stages reflect reality instead of
  // always falling through to "Not yet".
  etd?: string | null
  atd?: string | null
  eta?: string | null
  ata?: string | null
  inDcDate?: string | null
  // BUG 11: the At-Warehouse stage's date. The backend emits an AT_WAREHOUSE milestone, but pass the scalar
  // too so the stage still shows a date on legs where the milestone row is absent.
  warehouseStartDate?: string | null
}

// Display order only — AT_WAREHOUSE and ARRIVED still exist in data (committer-derived) but are
// not shown on the timeline (#126). Stored milestones of those types are ignored (skip, don't crash).
const milestoneOrder = ['BOOKING_SENT', 'SO_RECEIVED', 'DRAFT_BL_RECEIVED', 'FINAL_BL_RECEIVED', 'DEPARTED', 'DELIVERED']

const milestoneLabels: Record<string, string> = {
  BOOKING_SENT: 'Booking Request',
  SO_RECEIVED: 'SO Received',
  DRAFT_BL_RECEIVED: 'Draft BOL',
  FINAL_BL_RECEIVED: 'Final BOL',
  DEPARTED: 'Departure',
  DELIVERED: 'Delivered',
}

// Keyed on the UI-translated status (stateToUiStatus: RELEASED→DEPARTED, DELIVERED→ARRIVED).
// Indices track the lean milestoneOrder (AT_WAREHOUSE / ARRIVED are no longer display stages — #126).
const STATE_TO_INDEX: Record<string, number> = {
  BOOKED: 0,
  CONFIRMED: 1,
  AT_WAREHOUSE: 1, // stage removed from display — floor at SO Received, never below
  SAILED: 4, // Departure — the vessel has left
  DEPARTED: 4, // Departure (UI status for leg state RELEASED)
  ARRIVED: 5, // Delivered — stage removed from display, fold forward (UI status for leg state DELIVERED)
}

export type TimelineStage = {
  type: string
  idx: number
  label: string
  done: boolean
  isCurrent: boolean
  isNext: boolean
  isLast: boolean
  date: string | null
  est: string | null
}

/**
 * Ops-facing date line under a stage.
 * Priority (eng lock): actual date → done wins → estimate → not yet.
 * Never call formatDate on null (returns "TBD").
 * SAILED + no ATD: done=true → "Done", never "ETD …".
 */
export function stageDateCaption(s: {
  date: string | null
  est: string | null
  done: boolean
  type: string
}): string {
  if (s.date) return formatDate(s.date)
  if (s.done) return 'Done'
  if (s.est) {
    if (s.type === 'DEPARTED') return `ETD ${formatDate(s.est)}`
    if (s.type === 'ARRIVED') return `ETA ${formatDate(s.est)}`
  }
  return 'Not yet'
}

/**
 * Orientation strip above the stepper.
 * mid: Now: X · Next: Y | terminal complete | not started
 */
export function orientationLine(
  stages: Array<{ label: string; done: boolean; isCurrent: boolean; isNext: boolean; isLast: boolean }>,
): string {
  if (stages.length === 0) return 'Not started'
  const current = stages.find((s) => s.isCurrent)
  const next = stages.find((s) => s.isNext)
  const last = stages[stages.length - 1]!
  if (last.done && last.isLast) {
    return `Complete · ${last.label}`
  }
  if (!current) {
    const first = stages[0]!
    return `Not started · Next: ${first.label}`
  }
  if (next) return `Now: ${current.label} · Next: ${next.label}`
  return `Now: ${current.label}`
}

const DONE_TOOLTIP = 'Implied complete; no email date on file'

function dateLine(s: TimelineStage, sz: string) {
  const caption = stageDateCaption(s)
  const title = caption === 'Done' && !s.date ? DONE_TOOLTIP : undefined
  return (
    <p className={cn(sz, 'whitespace-nowrap text-text-muted', caption === 'Not yet' && 'italic')} title={title}>
      {caption}
    </p>
  )
}

function stageLabelClass(s: TimelineStage, base: string) {
  return cn(
    base,
    s.isCurrent && 'font-semibold text-status-warning',
    !s.isCurrent && s.isNext && 'font-medium text-text-primary',
    !s.isCurrent && !s.isNext && s.done && 'text-text-secondary',
    !s.isCurrent && !s.isNext && !s.done && 'text-text-muted',
  )
}

export function MilestoneTimeline({
  milestones,
  currentStatus,
  horizontal,
  mode,
  etd,
  atd,
  eta,
  ata,
  inDcDate,
  warehouseStartDate,
}: MilestoneTimelineProps) {
  const milestoneMap = new Map(milestones.map((m) => [m.milestoneType, m]))

  // The in-progress stage's icon: a gently BREATHING transport icon chosen by mode (ship at sea, plane
  // in the air) — reads as "live / in transit", not "loading" like a spinner. Unknown mode → a plain
  // breathing dot. Colour comes from the node's text-status-warning; the dot sets its own amber fill.
  const upperMode = (mode ?? '').toUpperCase()
  const transitIcon = upperMode.startsWith('SEA') ? (
    <Ship size={15} className="animate-breathe" />
  ) : upperMode === 'AIR' ? (
    <Plane size={15} className="animate-breathe" />
  ) : (
    <span className="h-2.5 w-2.5 rounded-full bg-status-warning animate-breathe" />
  )

  // The ACTUAL date a stage occurred: a milestone EVENT for the document stages, or the shipment's own
  // atd/ata scalar for DEPARTED/ARRIVED (tracked as dates, not events). DEPARTED also falls back to a
  // backend-derived SAILED milestone (etd-derived, atd NULL — see committer BUG 3); AT_WAREHOUSE falls back
  // to warehouseStartDate when no milestone row exists.
  const actualDate = (type: string): string | null =>
    milestoneMap.get(type)?.occurredAt ??
    (type === 'DEPARTED'
      ? atd ?? milestoneMap.get('SAILED')?.occurredAt ?? null
      : type === 'ARRIVED'
        ? ata
        : type === 'DELIVERED'
          ? inDcDate
          : type === 'AT_WAREHOUSE'
            ? warehouseStartDate
            : null) ??
    null
  // ESTIMATED date, for a departure/arrival stage not yet reached.
  const estDate = (type: string): string | null => (type === 'DEPARTED' ? etd : type === 'ARRIVED' ? eta : null) ?? null

  // Furthest stage that actually has a date. Milestones are sequential, so every earlier stage is
  // implicitly complete even when its email/event was never received.
  let currentIndex = -1
  for (let i = milestoneOrder.length - 1; i >= 0; i--) {
    if (actualDate(milestoneOrder[i]!)) {
      currentIndex = i
      break
    }
  }
  // the derived STATE implies progress even with no per-stage milestone EVENT — e.g. a shipment whose emails
  // are all "Other" but carry an so_no sits in CONFIRMED with zero milestones. Never show less than the
  // state's stage, so the timeline agrees with the status badge.
  currentIndex = Math.max(currentIndex, STATE_TO_INDEX[currentStatus] ?? -1)

  const lastIndex = milestoneOrder.length - 1
  const stages: TimelineStage[] = milestoneOrder.map((type, idx) => ({
    type,
    idx,
    label: milestoneLabels[type] ?? type,
    done: idx <= currentIndex, // monotonic: passed once a later stage is reached
    // The furthest-reached stage is IN PROGRESS (e.g. sailed but not yet arrived) — the shipment is
    // currently on this leg, not finished with it. Not applied to the terminal stage (DELIVERED): once
    // delivered, everything is truly done, so it shows a completed tick rather than a spinner.
    isCurrent: idx === currentIndex && idx < lastIndex,
    isNext: idx === currentIndex + 1,
    isLast: idx === lastIndex,
    date: actualDate(type),
    est: estDate(type),
  }))

  const orientation = orientationLine(stages)

  // Vertical stepper — the default layout, and the mobile form of the horizontal tracker below.
  const verticalView = (
    <div className="space-y-0">
      {stages.map((s) => (
        <div key={s.type} className="flex gap-3">
          <div className="flex flex-col items-center">
            <div
              className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2',
                s.isCurrent
                  ? 'border-status-warning bg-status-warning/20 text-status-warning'
                  : s.done
                    ? 'border-cobalt-primary bg-cobalt-primary text-white'
                    : s.isNext
                      ? 'border-cobalt-primary bg-transparent'
                      : 'border-border bg-transparent',
              )}
            >
              {s.isCurrent ? transitIcon : s.done && <Check size={14} />}
            </div>
            {!s.isLast && (
              <div
                className={cn(
                  'min-h-8 w-0.5 flex-1',
                  s.idx < currentIndex ? 'bg-cobalt-primary' : s.isCurrent ? 'bg-status-warning' : 'bg-border',
                )}
              />
            )}
          </div>
          <div className="min-w-0 pb-6 pt-0.5">
            <p className={stageLabelClass(s, 'text-base')}>{s.label}</p>
            {dateLine(s, 'text-sm')}
          </div>
        </div>
      ))}
    </div>
  )

  const horizontalView = (
    <div className="flex items-stretch">
      {stages.map((s) => (
        <div key={s.type} className="flex min-w-0 flex-1 items-start">
          <div className="flex w-full min-w-0 flex-col items-center">
            <div
              className={cn(
                'z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2',
                s.isCurrent
                  ? 'border-status-warning bg-status-warning/20 text-status-warning'
                  : s.done
                    ? 'border-cobalt-primary bg-cobalt-primary text-white'
                    : s.isNext
                      ? 'border-cobalt-primary bg-transparent'
                      : 'border-border bg-transparent',
              )}
            >
              {s.isCurrent ? transitIcon : s.done && <Check size={14} />}
            </div>
            <div className="mt-1.5 min-w-0 max-w-full px-0.5 text-center">
              <p className={stageLabelClass(s, 'text-sm leading-tight')}>{s.label}</p>
              {dateLine(s, 'text-xs')}
            </div>
          </div>
          {!s.isLast && (
            <div
              className={cn(
                '-mx-1 h-0.5 flex-1 self-center',
                s.idx < currentIndex ? 'bg-cobalt-primary' : s.isCurrent ? 'bg-status-warning' : 'bg-border',
              )}
            />
          )}
        </div>
      ))}
    </div>
  )

  // Prefer horizontal prop for tests / forced layout; otherwise responsive split.
  if (horizontal === true) {
    return (
      <div data-testid="milestone-timeline">
        <p className="mb-3 text-sm font-medium text-text-primary" data-testid="milestone-orientation">
          {orientation}
        </p>
        {horizontalView}
      </div>
    )
  }
  if (horizontal === false) {
    return (
      <div data-testid="milestone-timeline">
        <p className="mb-3 text-sm font-medium text-text-primary" data-testid="milestone-orientation">
          {orientation}
        </p>
        {verticalView}
      </div>
    )
  }

  // Six steps side by side crowd a phone (labels collide) — show the vertical stepper below md and
  // the horizontal tracker from md up, where there is room for the labels.
  return (
    <div data-testid="milestone-timeline">
      <p className="mb-3 text-sm font-medium text-text-primary" data-testid="milestone-orientation">
        {orientation}
      </p>
      <div className="md:hidden">{verticalView}</div>
      <div className="hidden md:block">{horizontalView}</div>
    </div>
  )
}
