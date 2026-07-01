import { cn, formatDate } from '../../lib/utils'
import { Check } from 'lucide-react'

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

// BUG 11: AT_WAREHOUSE is a first-class stage the backend emits (derived from warehouse_start_date). It was
// missing here, so an at-warehouse date had no stage to render. Inserted between SO Received and Draft BOL.
const milestoneOrder = ['BOOKING_SENT', 'SO_RECEIVED', 'AT_WAREHOUSE', 'DRAFT_BL_RECEIVED', 'FINAL_BL_RECEIVED', 'DEPARTED', 'ARRIVED', 'DELIVERED']

const milestoneLabels: Record<string, string> = {
  BOOKING_SENT: 'Booking Request',
  SO_RECEIVED: 'SO Received',
  AT_WAREHOUSE: 'At Warehouse',
  DRAFT_BL_RECEIVED: 'Draft BOL',
  FINAL_BL_RECEIVED: 'Final BOL',
  DEPARTED: 'Departure',
  ARRIVED: 'Arrived',
  DELIVERED: 'Delivered',
}

export function MilestoneTimeline({
  milestones,
  currentStatus,
  horizontal,
  etd,
  atd,
  eta,
  ata,
  inDcDate,
  warehouseStartDate,
}: MilestoneTimelineProps) {
  const milestoneMap = new Map(milestones.map((m) => [m.milestoneType, m]))

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
  // BUG 4: keyed on the UI-translated status the component actually receives (stateToUiStatus:
  // RELEASED→DEPARTED, DELIVERED→ARRIVED), NOT the raw leg states — the old RELEASED/DELIVERED keys were dead
  // and SAILED/DEPARTED/ARRIVED never matched. Indices track milestoneOrder (AT_WAREHOUSE inserted at 2).
  const STATE_TO_INDEX: Record<string, number> = { BOOKED: 0, CONFIRMED: 1, AT_WAREHOUSE: 2, SAILED: 5, DEPARTED: 5, ARRIVED: 6 }
  currentIndex = Math.max(currentIndex, STATE_TO_INDEX[currentStatus] ?? -1)

  const stages = milestoneOrder.map((type, idx) => ({
    type,
    idx,
    label: milestoneLabels[type] ?? type,
    done: idx <= currentIndex, // monotonic: passed once a later stage is reached
    isNext: idx === currentIndex + 1,
    isLast: idx === milestoneOrder.length - 1,
    date: actualDate(type),
    est: estDate(type),
  }))

  type Stage = (typeof stages)[number]
  const dateLine = (s: Stage, sz: string) => {
    if (s.date) return <p className={cn(sz, 'text-text-muted')}>{formatDate(s.date)}</p>
    if (s.done) return <p className={cn(sz, 'text-text-muted')}>—</p> // implied complete, date unknown
    if (s.est) return <p className={cn(sz, 'text-text-muted')}>Est. {formatDate(s.est)}</p>
    return <p className={cn(sz, 'text-text-muted italic')}>Awaiting</p>
  }

  if (horizontal) {
    return (
      <div className="flex items-stretch">
        {stages.map((s) => (
          <div key={s.type} className="flex flex-1 items-start">
            <div className="flex w-full flex-col items-center">
              <div
                className={cn(
                  'z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2',
                  s.done
                    ? 'border-cobalt-primary bg-cobalt-primary text-white'
                    : s.isNext
                      ? 'border-cobalt-primary bg-transparent'
                      : 'border-border bg-transparent'
                )}
              >
                {s.done && <Check size={14} />}
              </div>
              <div className="mt-1.5 text-center">
                <p className={cn('text-xs font-medium leading-tight', s.done ? 'text-text-primary' : 'text-text-muted')}>
                  {s.label}
                </p>
                {dateLine(s, 'text-[11px]')}
              </div>
            </div>
            {!s.isLast && (
              <div className={cn('-mx-1 h-0.5 flex-1 self-center', s.idx < currentIndex ? 'bg-cobalt-primary' : 'bg-border')} />
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
                s.done
                  ? 'border-cobalt-primary bg-cobalt-primary text-white'
                  : s.isNext
                    ? 'border-cobalt-primary bg-transparent'
                    : 'border-border bg-transparent'
              )}
            >
              {s.done && <Check size={14} />}
            </div>
            {!s.isLast && <div className={cn('min-h-8 w-0.5 flex-1', s.idx < currentIndex ? 'bg-cobalt-primary' : 'bg-border')} />}
          </div>
          <div className="pb-6 pt-0.5">
            <p className={cn('text-sm font-medium', s.done ? 'text-text-primary' : 'text-text-muted')}>{s.label}</p>
            {dateLine(s, 'text-xs')}
          </div>
        </div>
      ))}
    </div>
  )
}
