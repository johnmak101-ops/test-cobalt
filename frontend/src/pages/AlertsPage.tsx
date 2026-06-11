import { useEffect, useRef, useState } from 'react'
import { useAlerts } from '../hooks/use-alerts'
import { AlertSection } from '../components/alerts/AlertSection'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Settings } from 'lucide-react'
import { cn } from '../lib/utils'

const filterTabs = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'read', label: 'Read' },
] as const

type FilterKey = (typeof filterTabs)[number]['key']

export default function AlertsPage() {
  const { data, isLoading } = useAlerts()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const severityFilter = searchParams.get('severity')
  const criticalRef = useRef<HTMLDivElement>(null)
  const [filter, setFilter] = useState<FilterKey>('all')

  const activeAlerts = (data?.alerts ?? []).filter((a) => a.status === 'ACTIVE')

  // Apply read/unread filter
  const filtered = activeAlerts.filter((a) => {
    if (filter === 'unread') return !a.readAt
    if (filter === 'read') return !!a.readAt
    return true
  })

  const critical = filtered.filter((a) => a.severity === 'CRITICAL')
  const warning = filtered.filter((a) => a.severity === 'WARNING')
  const info = filtered.filter((a) => a.severity === 'INFO')

  // Counts for tab badges
  const unreadCount = activeAlerts.filter((a) => !a.readAt).length
  const readCount = activeAlerts.filter((a) => !!a.readAt).length

  // Auto-scroll to CRITICAL section when ?severity=CRITICAL
  useEffect(() => {
    if (severityFilter === 'CRITICAL' && criticalRef.current && !isLoading) {
      criticalRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [severityFilter, isLoading])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-text-primary">Alerts</h1>
        </div>
        <button
          onClick={() => navigate('/alerts/rules')}
          className="inline-flex items-center gap-1.5 rounded-lg bg-surface-700 px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-600 hover:text-text-primary"
        >
          <Settings size={14} />
          Alert Rules
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 rounded-lg bg-surface-900 p-1">
        {filterTabs.map((tab) => {
          const count =
            tab.key === 'all'
              ? activeAlerts.length
              : tab.key === 'unread'
                ? unreadCount
                : readCount
          return (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                filter === tab.key
                  ? 'bg-cobalt-primary text-white'
                  : 'text-text-muted hover:text-text-primary'
              )}
            >
              {tab.label}
              <span
                className={cn(
                  'ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                  filter === tab.key
                    ? 'bg-white/20 text-white'
                    : 'bg-surface-700 text-text-muted'
                )}
              >
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <span className="text-sm text-text-muted">Loading alerts...</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center gap-2">
          <span className="text-sm text-text-muted">
            {filter === 'unread'
              ? 'No unread alerts'
              : filter === 'read'
                ? 'No read alerts'
                : 'No active alerts'}
          </span>
          <p className="text-xs text-text-muted">
            {filter === 'all'
              ? 'All shipments are on track.'
              : filter === 'unread'
                ? 'All alerts have been reviewed.'
                : 'No alerts have been marked as read yet.'}
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          <div ref={criticalRef}>
            <AlertSection severity="CRITICAL" alerts={critical} />
          </div>
          <AlertSection severity="WARNING" alerts={warning} />
          <AlertSection severity="INFO" alerts={info} />
        </div>
      )}
    </div>
  )
}
