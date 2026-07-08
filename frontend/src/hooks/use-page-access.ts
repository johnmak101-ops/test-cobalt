import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export type PageLevel = 'none' | 'view' | 'edit'

/**
 * The current user's access level per governed config page (from GET /api/page-access/me), plus
 * derived helpers. Drives route gating (PageAccessRoute), Settings nav visibility, and per-panel
 * editability. `none` for any page not returned (unknown / not governed).
 */
export function usePageAccess() {
  const { data, isLoading } = useQuery<{ pages: Record<string, PageLevel> }>({
    queryKey: ['pageAccess', 'me'],
    queryFn: () => api.get('/page-access/me'),
  })
  const pages = data?.pages ?? {}
  const levelFor = (pageId: string): PageLevel => pages[pageId] ?? 'none'
  return {
    levelFor,
    canEdit: (pageId: string) => levelFor(pageId) === 'edit',
    canView: (pageId: string) => levelFor(pageId) !== 'none',
    loading: isLoading,
  }
}
