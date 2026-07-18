import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, Sun, Moon, LogOut, ChevronDown, AlertTriangle, Mail, ClipboardCheck, ChevronRight, Menu } from 'lucide-react'
import { useAlerts, useMarkAlertRead } from '../../hooks/use-alerts'
import { useReviewQueue, useReviewCounts } from '../../hooks/use-review-queue'
import { useEmails } from '../../hooks/use-emails'
import { useAuth } from '../../hooks/use-auth'
import { useUIStore } from '../../store'
import { cn, formatRelativeTime, parsePONumbers } from '../../lib/utils'
import { humanizeReason } from '../../lib/review-reasons'

const roleLabelMap: Record<string, string> = {
  COORDINATOR: 'Coordinator',
  MANAGER: 'Manager',
  ADMIN: 'Admin',
  SUPERADMIN: 'Superadmin',
}

const severityDot: Record<string, string> = {
  CRITICAL: 'bg-status-critical',
  WARNING: 'bg-status-warning',
  INFO: 'bg-status-info',
}

type NotiTab = 'alerts' | 'inbox' | 'review'

export function TopBar() {
  const navigate = useNavigate()
  const { data: alertsData } = useAlerts()
  const markRead = useMarkAlertRead()
  const { data: reviewData } = useReviewQueue()
  const { data: reviewCounts } = useReviewCounts()
  const { data: emailsData } = useEmails()
  const { user, logout } = useAuth()
  const { theme, toggleTheme, openMobileNav, mobileNavOpen } = useUIStore()
  const [menuOpen, setMenuOpen] = useState(false)
  const [notiOpen, setNotiOpen] = useState(false)
  const [notiTab, setNotiTab] = useState<NotiTab>('alerts')
  const menuRef = useRef<HTMLDivElement>(null)
  const notiRef = useRef<HTMLDivElement>(null)

  // Unread alerts — active + not read
  const unreadAlerts =
    (alertsData?.alerts ?? []).filter((a) => a.status === 'ACTIVE' && !a.readAt)

  // Unread emails — pending processing
  const unreadEmails =
    (emailsData?.emails ?? []).filter((e) => e.processingStatus === 'PENDING')

  // Provisional shipments awaiting confirmation
  const pendingReviewCount = reviewCounts?.provisional ?? 0
  const unreadReviews = reviewData?.shipments ?? []

  const tabCounts: Record<NotiTab, number> = {
    alerts: unreadAlerts.length,
    inbox: unreadEmails.length,
    review: pendingReviewCount,
  }

  const totalBadge = tabCounts.alerts + tabCounts.inbox + tabCounts.review

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
      if (notiRef.current && !notiRef.current.contains(e.target as Node)) {
        setNotiOpen(false)
      }
    }
    if (menuOpen || notiOpen) {
      document.addEventListener('mousedown', handleClick)
      return () => document.removeEventListener('mousedown', handleClick)
    }
  }, [menuOpen, notiOpen])

  return (
    <header className="flex h-14 shrink-0 items-center border-b border-border bg-surface-900 px-4 sm:px-6">
      {/* Left: hamburger opens the nav drawer (mobile/tablet only). */}
      <button
        type="button"
        onClick={openMobileNav}
        aria-label="Open navigation menu"
        aria-controls="app-sidebar"
        aria-expanded={mobileNavOpen}
        className="rounded-lg p-2 text-text-secondary hover:bg-surface-700 hover:text-text-primary lg:hidden"
      >
        <Menu size={18} />
      </button>

      {/* Theme / alerts / user — always right-aligned (hamburger is only on small screens). */}
      <div className="ml-auto flex items-center gap-2">
        {/* Theme toggle */}
        <button
          type="button"
          onClick={toggleTheme}
          className="rounded-lg p-2 text-text-secondary hover:bg-surface-700 hover:text-text-primary"
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        >
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>

        {/* Notifications */}
        <div ref={notiRef} className="relative">
          <button
            type="button"
            onClick={() => setNotiOpen((v) => !v)}
            className={cn(
              'relative rounded-lg p-2 text-text-secondary hover:bg-surface-700 hover:text-text-primary',
              notiOpen && 'bg-surface-700 text-text-primary'
            )}
          >
            <Bell size={18} />
            {totalBadge > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-status-critical px-1 text-[10px] font-bold text-white">
                {totalBadge > 99 ? '99+' : totalBadge}
              </span>
            )}
          </button>

          {/* Notification dropdown */}
          {notiOpen && (
            <div className="absolute right-0 top-full z-50 mt-1 w-96 max-w-[calc(100vw-1rem)] rounded-xl border border-border bg-surface-800 shadow-lg">
              {/* Tab bar */}
              <div className="flex border-b border-border">
                {([
                  { key: 'alerts' as NotiTab, label: 'Alerts', icon: <AlertTriangle size={13} />, color: 'text-status-warning' },
                  { key: 'inbox' as NotiTab, label: 'Inbox', icon: <Mail size={13} />, color: 'text-cobalt-teal' },
                  { key: 'review' as NotiTab, label: 'Review', icon: <ClipboardCheck size={13} />, color: 'text-cobalt-primary-light' },
                ]).map((tab) => (
                  <button
                    type="button"
                    key={tab.key}
                    onClick={() => setNotiTab(tab.key)}
                    className={cn(
                      'flex flex-1 items-center justify-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-medium transition-colors',
                      notiTab === tab.key
                        ? 'border-cobalt-primary text-text-primary'
                        : 'border-transparent text-text-muted hover:text-text-secondary'
                    )}
                  >
                    <span className={notiTab === tab.key ? tab.color : ''}>{tab.icon}</span>
                    {tab.label}
                    {tabCounts[tab.key] > 0 && (
                      <span className={cn(
                        'ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold',
                        notiTab === tab.key
                          ? 'bg-cobalt-primary/20 text-cobalt-primary-light'
                          : 'bg-surface-600 text-text-muted'
                      )}>
                        {tabCounts[tab.key]}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div className="max-h-[28rem] overflow-y-auto">
                {/* ── Alerts tab ── */}
                {notiTab === 'alerts' && (
                  <>
                    {unreadAlerts.length === 0 ? (
                      <div className="px-4 py-8 text-center">
                        <AlertTriangle size={20} className="mx-auto mb-2 text-text-muted" />
                        <p className="text-xs text-text-muted">No unread alerts</p>
                      </div>
                    ) : (
                      unreadAlerts.map((alert) => (
                        <button
                          type="button"
                          key={alert.id}
                          onClick={() => {
                            markRead.mutate(alert.id)
                            setNotiOpen(false)
                            navigate(`/shipments/${alert.shipmentId}`, { state: { fromAlerts: true } })
                          }}
                          className="flex w-full items-start gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-surface-700"
                        >
                          <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', severityDot[alert.severity])} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-medium text-text-primary">{alert.message}</p>
                            <p className="mt-0.5 text-[10px] text-text-muted">
                              {alert.shipment?.poNumbers && `${parsePONumbers(alert.shipment.poNumbers)[0]} · `}
                              {formatRelativeTime(alert.triggeredAt)}
                            </p>
                          </div>
                        </button>
                      ))
                    )}
                  </>
                )}

                {/* ── Inbox tab ── */}
                {notiTab === 'inbox' && (
                  <>
                    {unreadEmails.length === 0 ? (
                      <div className="px-4 py-8 text-center">
                        <Mail size={20} className="mx-auto mb-2 text-text-muted" />
                        <p className="text-xs text-text-muted">No pending emails</p>
                      </div>
                    ) : (
                      unreadEmails.map((email) => (
                        <button
                          type="button"
                          key={email.id}
                          onClick={() => { setNotiOpen(false); navigate('/inbox') }}
                          className="flex w-full items-start gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-surface-700"
                        >
                          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-cobalt-teal" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-medium text-text-primary">{email.subject}</p>
                            <p className="mt-0.5 text-[10px] text-text-muted">
                              {email.sender} · {formatRelativeTime(email.receivedAt)}
                            </p>
                          </div>
                        </button>
                      ))
                    )}
                  </>
                )}

                {/* ── Review Queue tab ── */}
                {notiTab === 'review' && (
                  <>
                    {unreadReviews.length === 0 ? (
                      <div className="px-4 py-8 text-center">
                        <ClipboardCheck size={20} className="mx-auto mb-2 text-text-muted" />
                        <p className="text-xs text-text-muted">No items pending review</p>
                      </div>
                    ) : (
                      unreadReviews.map((item) => (
                        <button
                          type="button"
                          key={item.id}
                          onClick={() => { setNotiOpen(false); navigate(`/shipments/${item.id}`) }}
                          className="flex w-full items-start gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-surface-700"
                        >
                          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-cobalt-primary-light" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-medium text-text-primary">
                              {item.customer ?? item.bookingNo ?? item.soNo ?? 'Provisional shipment'}
                            </p>
                            <p className="mt-0.5 text-[10px] text-text-muted">
                              {item.bookingNo ?? item.soNo ?? '—'} · {formatRelativeTime(item.createdAt)}
                              {item.reviewReasons.length > 0 && (
                                <> · {humanizeReason(item.reviewReasons[0]!)}</>
                              )}
                            </p>
                          </div>
                        </button>
                      ))
                    )}
                  </>
                )}
              </div>

              {/* Footer — View All link */}
              <div className="border-t border-border px-4 py-2">
                <button
                  type="button"
                  onClick={() => {
                    setNotiOpen(false)
                    navigate(
                      notiTab === 'alerts' ? '/alerts' :
                      notiTab === 'inbox' ? '/inbox' : '/review-queue'
                    )
                  }}
                  className="flex w-full items-center justify-center gap-1 text-xs font-medium text-cobalt-primary-light hover:underline"
                >
                  View all {notiTab === 'alerts' ? 'alerts' : notiTab === 'inbox' ? 'emails' : 'review items'}
                  <ChevronRight size={12} />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* User menu */}
        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className={cn(
              'flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors',
              'hover:bg-surface-700',
              menuOpen && 'bg-surface-700'
            )}
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-cobalt-primary text-xs font-bold text-white">
              {user?.avatarInitials ?? '??'}
            </div>
            <div className="hidden text-left sm:block">
              <p className="text-sm font-medium leading-tight text-text-primary">
                {user?.name}
              </p>
              <p className="text-[10px] leading-tight text-text-muted">
                {user ? roleLabelMap[user.role] ?? user.role : ''}
              </p>
            </div>
            <ChevronDown
              size={14}
              className={cn(
                'text-text-muted transition-transform',
                menuOpen && 'rotate-180'
              )}
            />
          </button>

          {/* Dropdown */}
          {menuOpen && (
            <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded-xl border border-border bg-surface-800 py-1 shadow-lg">
              <div className="border-b border-border px-3 py-2">
                <p className="text-sm font-medium text-text-primary">{user?.name}</p>
                <p className="text-xs text-text-muted">{user?.email}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false)
                  logout()
                }}
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


