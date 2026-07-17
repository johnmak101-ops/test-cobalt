import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { Outlet } from 'react-router-dom'
import { useUIStore } from '../../store'
import { cn } from '../../lib/utils'

export function AppShell() {
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed)

  return (
    <div className="flex h-screen overflow-hidden bg-bg">
      <Sidebar />
      {/* Content is full-width below lg (sidebar is an off-canvas drawer there);
          only at lg+ does it reserve room for the persistent rail. */}
      <div
        className={cn(
          // min-w-0: without it this flex item takes its content's min-content width, so one
          // unbreakable string anywhere widens the whole page (and every card in it) instead
          // of overflowing its own box. h-screen's overflow-hidden then hides the evidence.
          'flex min-w-0 flex-1 flex-col transition-all duration-200',
          'ml-0',
          sidebarCollapsed ? 'lg:ml-16' : 'lg:ml-56'
        )}
      >
        <TopBar />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
