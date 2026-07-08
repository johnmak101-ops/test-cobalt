import { describe, it, expect, vi } from 'vitest'
import type { ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { usePageAccess } from './use-page-access'

vi.mock('../lib/api', () => ({
  api: { get: vi.fn().mockResolvedValue({ pages: { alert_rules: 'edit', resolution_rules: 'none' } }) },
}))

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe('usePageAccess', () => {
  it('derives levelFor/canEdit/canView from /page-access/me', async () => {
    const { result } = renderHook(() => usePageAccess(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.levelFor('alert_rules')).toBe('edit')
    expect(result.current.canEdit('alert_rules')).toBe(true)
    expect(result.current.canView('alert_rules')).toBe(true)
    expect(result.current.levelFor('resolution_rules')).toBe('none')
    expect(result.current.canEdit('resolution_rules')).toBe(false)
    expect(result.current.canView('resolution_rules')).toBe(false)
    expect(result.current.levelFor('unknown')).toBe('none')
  })
})
