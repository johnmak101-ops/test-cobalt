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
}

const milestoneOrder = [
  'BOOKING_SENT',
  'SO_RECEIVED',
  'DRAFT_BL_RECEIVED',
  'FINAL_BL_RECEIVED',
  'TELEX_RELEASED',
  'DELIVERED',
]

const milestoneLabels: Record<string, string> = {
  BOOKING_SENT: 'Booking Request',
  SO_RECEIVED: 'SO Received',
  DRAFT_BL_RECEIVED: 'Draft B/L',
  FINAL_BL_RECEIVED: 'Final B/L',
  TELEX_RELEASED: 'Telex Release',
  DELIVERED: 'Delivered',
}

export function MilestoneTimeline({ milestones, currentStatus: _currentStatus }: MilestoneTimelineProps) {
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
