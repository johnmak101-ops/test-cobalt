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
      <div
        className={cn(
          'flex flex-1 flex-col transition-all duration-200',
          sidebarCollapsed ? 'ml-16' : 'ml-56'
        )}
      >
        <TopBar />
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
