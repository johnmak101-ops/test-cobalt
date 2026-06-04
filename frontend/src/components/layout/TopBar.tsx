import { useState, useRef, useEffect } from 'react'
import { Search, Bell, Sun, Moon, LogOut, ChevronDown } from 'lucide-react'
import { useAlerts } from '../../hooks/use-alerts'
import { useAuth } from '../../hooks/use-auth'
import { useUIStore } from '../../store'
import { cn } from '../../lib/utils'

const roleLabelMap: Record<string, string> = {
  COORDINATOR: 'Coordinator',
  MANAGER: 'Manager',
  ADMIN: 'Admin',
}

export function TopBar() {
  const { data: alertsData } = useAlerts()
  const { user, logout } = useAuth()
  const { theme, toggleTheme } = useUIStore()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const activeAlertCount =
    alertsData?.alerts?.filter((a: { status: string }) => a.status === 'ACTIVE')
      .length ?? 0

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    if (menuOpen) {
      document.addEventListener('mousedown', handleClick)
      return () => document.removeEventListener('mousedown', handleClick)
    }
  }, [menuOpen])

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface-900 px-6">
      {/* Search */}
      <div className="relative w-80">
        <Search
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
        />
        <input
          type="text"
          placeholder="Search PO#, customer, HBL..."
          className="h-9 w-full rounded-lg border border-border bg-surface-700 pl-9 pr-4 text-sm text-text-primary placeholder:text-text-muted focus:border-cobalt-primary focus:outline-none"
        />
      </div>

      {/* Right side */}
      <div className="flex items-center gap-2">
        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          className="rounded-lg p-2 text-text-secondary hover:bg-surface-700 hover:text-text-primary"
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        >
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>

        {/* Notifications */}
        <button className="relative rounded-lg p-2 text-text-secondary hover:bg-surface-700 hover:text-text-primary">
          <Bell size={18} />
          {activeAlertCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-status-critical px-1 text-[10px] font-bold text-white">
              {activeAlertCount}
            </span>
          )}
        </button>

        {/* User menu */}
        <div ref={menuRef} className="relative">
          <button
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
