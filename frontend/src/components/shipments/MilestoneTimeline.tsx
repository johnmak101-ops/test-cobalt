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
  // always falling through to "Awaiting".
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

type TimelineStage = {
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

function dateLine(s: TimelineStage, sz: string) {
  if (s.date) return <p className={cn(sz, 'text-text-muted')}>{formatDate(s.date)}</p>
  if (s.done) return <p className={cn(sz, 'text-text-muted')}>—</p> // implied complete, date unknown
  if (s.est) return <p className={cn(sz, 'text-text-muted')}>Est. {formatDate(s.est)}</p>
  return <p className={cn(sz, 'text-text-muted italic')}>Awaiting</p>
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

  if (horizontal) {
    return (
      <div className="flex items-stretch">
        {stages.map((s) => (
          <div key={s.type} className="flex flex-1 items-start">
            <div className="flex w-full flex-col items-center">
              <div
                className={cn(
                  'z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2',
                  s.isCurrent
                    ? 'border-status-warning bg-status-warning/20 text-status-warning'
                    : s.done
                      ? 'border-cobalt-primary bg-cobalt-primary text-white'
                      : s.isNext
                        ? 'border-cobalt-primary bg-transparent'
                        : 'border-border bg-transparent'
                )}
              >
                {s.isCurrent ? transitIcon : s.done && <Check size={14} />}
              </div>
              <div className="mt-1.5 text-center">
                <p
                  className={cn(
                    'text-xs font-medium leading-tight',
                    s.isCurrent ? 'text-status-warning' : s.done ? 'text-text-primary' : 'text-text-muted',
                  )}
                >
                  {s.label}
                </p>
                {dateLine(s, 'text-[11px]')}
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
  }

  return (
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
                      : 'border-border bg-transparent'
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
          <div className="pb-6 pt-0.5">
            <p
              className={cn(
                'text-sm font-medium',
                s.isCurrent ? 'text-status-warning' : s.done ? 'text-text-primary' : 'text-text-muted',
              )}
            >
              {s.label}
            </p>
            {dateLine(s, 'text-xs')}
          </div>
        </div>
      ))}
    </div>
  )
}
