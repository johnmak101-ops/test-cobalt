import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle, RefreshCw } from 'lucide-react'
import { useReviewQueue, useReviewCounts } from '../hooks/use-review-queue'
import { useAuth } from '../hooks/use-auth'
import { Card } from '../components/ui/Card'
import { Pagination, usePagination, PageSizeSelect } from '../components/ui/Pagination'
import { ReviewQueueCard } from '../components/review/ReviewQueueCard'
import { cn } from '../lib/utils'

export default function ReviewPage() {
  const [activeTab, setActiveTab] = useState<string | undefined>(undefined)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(25)
  const { data: queueData, isLoading } = useReviewQueue(activeTab)
  const { data: counts } = useReviewCounts()
  const { user } = useAuth()
  const qc = useQueryClient()

  if (user?.role === 'VIEWER') {
    return <Card><div className="muted">Editors only.</div></Card>
  }

  const emails = queueData?.emails ?? []
  const { totalItems, totalPages, pageSize, getPage } = usePagination(emails, perPage)
  const pageEmails = getPage(page)

  const statusTabs = [
    { key: undefined, label: 'Pending Review', count: counts?.pending },
    { key: 'REVIEWED_OK', label: 'Approved', count: counts?.REVIEWED_OK },
    { key: 'REVIEWED_CORRECTED', label: 'Corrected', count: counts?.REVIEWED_CORRECTED },
    { key: 'REJECTED', label: 'Rejected', count: counts?.REJECTED },
  ]

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['review-queue'] })
    qc.invalidateQueries({ queryKey: ['review-counts'] })
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Review Queue</h1>
          <p className="muted mt-1">
            Low-confidence email extractions held for review. High-confidence emails are applied automatically.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={refresh}
            className="inline-flex items-center gap-1.5 rounded-lg bg-surface-700 px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-600 hover:text-text-primary"
          >
            <RefreshCw size={14} /> Refresh
          </button>
          <PageSizeSelect value={perPage} onChange={(size) => { setPerPage(size); setPage(1) }} />
        </div>
      </div>

      {/* Filter tabs with counts */}
      <div className="flex gap-1 rounded-lg bg-surface-900 p-1">
        {statusTabs.map((tab) => (
          <button
            key={tab.key ?? 'pending'}
            onClick={() => { setActiveTab(tab.key); setPage(1); setExpandedId(null) }}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              activeTab === tab.key ? 'bg-cobalt-primary text-white' : 'text-text-muted hover:text-text-primary',
            )}
          >
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span
                className={cn(
                  'inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold',
                  activeTab === tab.key ? 'bg-white/20 text-white' : 'bg-surface-600 text-text-muted',
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
        <div className="flex h-32 items-center justify-center text-sm text-text-muted">Loading review queue…</div>
      ) : emails.length === 0 ? (
        <div className="flex h-32 flex-col items-center justify-center text-text-muted">
          <CheckCircle size={24} className="mb-2 opacity-50" />
          <p className="text-sm">No emails to review</p>
        </div>
      ) : (
        <div className="space-y-3">
          {pageEmails.map((email) => (
            <ReviewQueueCard
              key={email.id}
              email={email}
              expanded={expandedId === email.id}
              onToggle={() => setExpandedId((cur) => (cur === email.id ? null : email.id))}
            />
          ))}
          <Pagination currentPage={page} totalPages={totalPages} totalItems={totalItems} pageSize={pageSize} onPageChange={setPage} />
        </div>
      )}
    </div>
  )
}
