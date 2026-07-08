import { Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { usePageAccess } from '../hooks/use-page-access'

/**
 * Gate a config-page route on the superadmin-configured access matrix. `none` → redirect home;
 * `view`/`edit` → render (the panel itself renders read-only vs editable off the same level).
 * Replaces the hard-coded SuperadminRoute/AdminRoute on the governed config routes.
 */
export function PageAccessRoute({ page, children }: { page: string; children: ReactNode }) {
  const { levelFor, loading } = usePageAccess()
  if (loading) return null // brief; the surrounding AppShell is already rendered
  if (levelFor(page) === 'none') return <Navigate to="/" replace />
  return <>{children}</>
}
