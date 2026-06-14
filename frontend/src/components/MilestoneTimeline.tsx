import { useState } from 'react'
import { Mail } from 'lucide-react'
import { formatDate } from '../lib/utils'
import { ViewOriginalModal } from './ViewOriginalModal'
import type { Milestone } from '../lib/types'

const labels: Record<string, string> = {
  BOOKING_SENT: 'Booking sent',
  SO_RECEIVED: 'SO received',
  AT_WAREHOUSE: 'At warehouse',
  DRAFT_BL_RECEIVED: 'Draft B/L',
  FINAL_BL_RECEIVED: 'Final B/L',
  TELEX_RELEASED: 'Telex released',
  INVOICE_RECEIVED: 'Invoice',
  DELIVERED: 'Delivered',
}

export function MilestoneTimeline({ milestones }: { milestones: Milestone[] }) {
  const [openId, setOpenId] = useState<string | null>(null)
  if (!milestones?.length) return <div className="text-sm text-text-muted">No milestones yet.</div>
  return (
    <div className="space-y-0">
      {milestones.map((m, i) => (
        <div key={m.id ?? i} className="flex items-start gap-3">
          <div className="flex flex-col items-center">
            <div className="mt-1 h-2.5 w-2.5 rounded-full bg-cobalt-teal" />
            {i < milestones.length - 1 && <div className="h-7 w-px bg-border" />}
          </div>
          <div className="pb-3">
            <div className="text-sm font-medium text-text-primary">{labels[m.milestoneType] ?? m.milestoneType}</div>
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <span>{formatDate(m.occurredAt)}</span>
              {m.emailMessageId && (
                <button
                  onClick={() => setOpenId(m.emailMessageId!)}
                  className="inline-flex items-center gap-1 text-cobalt-primary hover:underline"
                >
                  <Mail size={11} /> View original
                </button>
              )}
            </div>
          </div>
        </div>
      ))}
      {openId && <ViewOriginalModal messageId={openId} onClose={() => setOpenId(null)} />}
    </div>
  )
}
