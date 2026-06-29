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
}

// The real backend MILESTONE_TYPE vocabulary (data-wiring audit gap 33): the old order used
// DEPARTED/ARRIVED which no backend producer emits, and dropped AT_WAREHOUSE/TELEX_RELEASED/
// INVOICE_RECEIVED (INVOICE_RECEIVED is the single most common milestone).
const milestoneOrder = [
  'BOOKING_SENT',
  'SO_RECEIVED',
  'AT_WAREHOUSE',
  'DRAFT_BL_RECEIVED',
  'FINAL_BL_RECEIVED',
  'TELEX_RELEASED',
  'INVOICE_RECEIVED',
  'DELIVERED',
]

const milestoneLabels: Record<string, string> = {
  BOOKING_SENT: 'Booking Request',
  SO_RECEIVED: 'SO Received',
  AT_WAREHOUSE: 'At Warehouse',
  DRAFT_BL_RECEIVED: 'Draft BOL',
  FINAL_BL_RECEIVED: 'Final BOL',
  TELEX_RELEASED: 'Telex Released',
  INVOICE_RECEIVED: 'Invoice Received',
  DELIVERED: 'Delivered',
}

export function MilestoneTimeline({ milestones, currentStatus: _currentStatus, horizontal }: MilestoneTimelineProps) {
  const completedTypes = new Set(milestones.map((m) => m.milestoneType))
  const milestoneMap = new Map(milestones.map((m) => [m.milestoneType, m]))

  // Determine which milestone is "current" (the last completed one)
  let currentIndex = -1
  for (let i = milestoneOrder.length - 1; i >= 0; i--) {
    if (completedTypes.has(milestoneOrder[i])) {
      currentIndex = i
      break
    }
  }

  if (horizontal) {
    return (
      <div className="flex items-stretch">
        {milestoneOrder.map((type, idx) => {
          const completed = completedTypes.has(type)
          const isNext = idx === currentIndex + 1
          const milestone = milestoneMap.get(type)
          const isLast = idx === milestoneOrder.length - 1

          return (
            <div key={type} className="flex flex-1 items-start">
              {/* Node + connector */}
              <div className="flex flex-col items-center w-full">
                {/* Circle node */}
                <div
                  className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 z-10',
                    completed
                      ? 'border-cobalt-primary bg-cobalt-primary text-white'
                      : isNext
                        ? 'border-cobalt-primary bg-transparent'
                        : 'border-border bg-transparent'
                  )}
                >
                  {completed && <Check size={14} />}
                </div>

                {/* Label and date */}
                <div className="mt-1.5 text-center">
                  <p
                    className={cn(
                      'text-xs font-medium leading-tight',
                      completed ? 'text-text-primary' : 'text-text-muted'
                    )}
                  >
                    {milestoneLabels[type]}
                  </p>
                  {milestone ? (
                    <p className="text-[11px] text-text-muted">{formatDate(milestone.occurredAt)}</p>
                  ) : (
                    <p className="text-[11px] text-text-muted italic">Awaiting</p>
                  )}
                </div>
              </div>

              {/* Horizontal connector line between nodes */}
              {!isLast && (
                <div
                  className={cn(
                    'h-0.5 flex-1 self-center -mx-1',
                    completed && idx < currentIndex
                      ? 'bg-cobalt-primary'
                      : isNext || completed
                        ? 'bg-border'
                        : 'bg-border'
                  )}
                />
              )}
            </div>
          )
        })}
      </div>
    )
  }

  // Vertical timeline (original)
  return (
    <div className="space-y-0">
      {milestoneOrder.map((type, idx) => {
        const completed = completedTypes.has(type)
        const isNext = idx === currentIndex + 1
        const milestone = milestoneMap.get(type)

        return (
          <div key={type} className="flex gap-3">
            {/* Timeline line and dot */}
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2',
                  completed
                    ? 'border-cobalt-primary bg-cobalt-primary text-white'
                    : isNext
                      ? 'border-cobalt-primary bg-transparent'
                      : 'border-border bg-transparent'
                )}
              >
                {completed && <Check size={14} />}
              </div>
              {idx < milestoneOrder.length - 1 && (
                <div
                  className={cn(
                    'w-0.5 flex-1 min-h-8',
                    completed && idx < currentIndex
                      ? 'bg-cobalt-primary'
                      : 'bg-border'
                  )}
                />
              )}
            </div>

            {/* Content */}
            <div className="pb-6 pt-0.5">
              <p
                className={cn(
                  'text-sm font-medium',
                  completed ? 'text-text-primary' : 'text-text-muted'
                )}
              >
                {milestoneLabels[type]}
              </p>
              {milestone ? (
                <p className="text-xs text-text-muted">{formatDate(milestone.occurredAt)}</p>
              ) : (
                <p className="text-xs text-text-muted italic">Awaiting</p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}