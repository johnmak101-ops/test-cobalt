import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Bell, Sun, Moon, LogOut, ChevronDown, AlertTriangle, ClipboardCheck, ChevronRight } from 'lucide-react'
import { useAlerts } from '../../hooks/use-alerts'
import { useReviewQueue } from '../../hooks/use-review'
import { useAuth } from '../../hooks/use-auth'
import { useUIStore } from '../../store'
import { cn } from '../../lib/utils'

type NotiTab = 'alerts' | 'review'

const initialsOf = (name?: string) =>
  (name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?'

const severityDot: Record<string, string> = {
  CRITICAL: 'bg-status-critical',
  WARNING: 'bg-status-warning',
  INFO: 'bg-status-info',
}

export function TopBar() {
  const navigate = useNavigate()
  const { data: alerts = [] } = useAlerts('ACTIVE')
  const { data: reviewItems = [] } = useReviewQueue()
  const { user, logout } = useAuth()
  const { theme, toggleTheme } = useUIStore()
  const [menuOpen, setMenuOpen] = useState(false)
  const [notiOpen, setNotiOpen] = useState(false)
  const [notiTab, setNotiTab] = useState<NotiTab>('alerts')
  const [search, setSearch] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)
  const notiRef = useRef<HTMLDivElement>(null)

  const counts: Record<NotiTab, number> = { alerts: alerts.length, review: reviewItems.length }
  const totalBadge = counts.alerts + counts.review

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
      if (notiRef.current && !notiRef.current.contains(e.target as Node)) setNotiOpen(false)
    }
    if (menuOpen || notiOpen) {
      document.addEventListener('mousedown', handleClick)
      return () => document.removeEventListener('mousedown', handleClick)
    }
  }, [menuOpen, notiOpen])

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface-900 px-6">
      <div className="relative w-80">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') navigate(`/shipments?q=${encodeURIComponent(search.trim())}`)
          }}
          placeholder="Search PO#, customer, HBL..."
          className="h-9 w-full rounded-lg border border-border bg-surface-700 pl-9 pr-4 text-sm text-text-primary placeholder:text-text-muted focus:border-cobalt-primary focus:outline-none"
        />
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={toggleTheme}
          className="rounded-lg p-2 text-text-secondary hover:bg-surface-700 hover:text-text-primary"
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        >
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>

        <div ref={notiRef} className="relative">
          <button
            onClick={() => setNotiOpen((v) => !v)}
            className={cn(
              'relative rounded-lg p-2 text-text-secondary hover:bg-surface-700 hover:text-text-primary',
              notiOpen && 'bg-surface-700 text-text-primary',
            )}
          >
            <Bell size={18} />
            {totalBadge > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-status-critical px-1 text-[10px] font-bold text-white">
                {totalBadge > 99 ? '99+' : totalBadge}
              </span>
            )}
          </button>

          {notiOpen && (
            <div className="absolute right-0 top-full z-50 mt-1 w-96 rounded-xl border border-border bg-surface-800 shadow-lg">
              <div className="flex border-b border-border">
                {([
                  { key: 'alerts' as NotiTab, label: 'Alerts', icon: <AlertTriangle size={13} />, color: 'text-status-warning' },
                  { key: 'review' as NotiTab, label: 'Review', icon: <ClipboardCheck size={13} />, color: 'text-cobalt-primary-light' },
                ]).map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setNotiTab(tab.key)}
                    className={cn(
                      'flex flex-1 items-center justify-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-medium transition-colors',
                      notiTab === tab.key ? 'border-cobalt-primary text-text-primary' : 'border-transparent text-text-muted hover:text-text-secondary',
                    )}
                  >
                    <span className={notiTab === tab.key ? tab.color : ''}>{tab.icon}</span>
                    {tab.label}
                    {counts[tab.key] > 0 && (
                      <span className={cn('ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold', notiTab === tab.key ? 'bg-cobalt-primary/20 text-cobalt-primary-light' : 'bg-surface-600 text-text-muted')}>
                        {counts[tab.key]}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              <div className="max-h-[26rem] overflow-y-auto">
                {notiTab === 'alerts' &&
                  (alerts.length === 0 ? (
                    <div className="px-4 py-8 text-center">
                      <AlertTriangle size={20} className="mx-auto mb-2 text-text-muted" />
                      <p className="text-xs text-text-muted">No active alerts</p>
                    </div>
                  ) : (
                    alerts.map((a) => (
                      <button
                        key={a.id}
                        onClick={() => { setNotiOpen(false); if (a.bookingId) navigate(`/bookings/${a.bookingId}`) }}
                        className="flex w-full items-start gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-surface-700"
                      >
                        <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', severityDot[a.severity] ?? 'bg-text-muted')} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium text-text-primary">{a.message}</p>
                          <p className="mt-0.5 text-[10px] text-text-muted">{a.ruleId}</p>
                        </div>
                      </button>
                    ))
                  ))}

                {notiTab === 'review' &&
                  (reviewItems.length === 0 ? (
                    <div className="px-4 py-8 text-center">
                      <ClipboardCheck size={20} className="mx-auto mb-2 text-text-muted" />
                      <p className="text-xs text-text-muted">Nothing awaiting review</p>
                    </div>
                  ) : (
                    reviewItems.map((it) => (
                      <button
                        key={it.id}
                        onClick={() => { setNotiOpen(false); navigate('/review-queue') }}
                        className="flex w-full items-start gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-surface-700"
                      >
                        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-cobalt-primary-light" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium text-text-primary">{it.jobNo ?? it.id.slice(0, 8)}</p>
                          <p className="mt-0.5 text-[10px] text-text-muted">confidence {it.confidence ?? '—'}</p>
                        </div>
                      </button>
                    ))
                  ))}
              </div>

              <div className="border-t border-border px-4 py-2">
                <button
                  onClick={() => { setNotiOpen(false); navigate(notiTab === 'alerts' ? '/alerts' : '/review-queue') }}
                  className="flex w-full items-center justify-center gap-1 text-xs font-medium text-cobalt-primary-light hover:underline"
                >
                  View all {notiTab === 'alerts' ? 'alerts' : 'review items'}
                  <ChevronRight size={12} />
                </button>
              </div>
            </div>
          )}
        </div>

        <div ref={menuRef} className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className={cn('flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-surface-700', menuOpen && 'bg-surface-700')}
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-cobalt-primary text-xs font-bold text-white">
              {initialsOf(user?.name)}
            </div>
            <div className="hidden text-left sm:block">
              <p className="text-sm font-medium leading-tight text-text-primary">{user?.name}</p>
              <p className="text-[10px] leading-tight text-text-muted">{user?.role}</p>
            </div>
            <ChevronDown size={14} className={cn('text-text-muted transition-transform', menuOpen && 'rotate-180')} />
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded-xl border border-border bg-surface-800 py-1 shadow-lg">
              <div className="border-b border-border px-3 py-2">
                <p className="text-sm font-medium text-text-primary">{user?.name}</p>
                <p className="text-xs text-text-muted">{user?.email}</p>
              </div>
              <button
                onClick={() => { setMenuOpen(false); logout() }}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-text-secondary hover:bg-surface-700 hover:text-text-primary"
              >
                <LogOut size={14} />
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
