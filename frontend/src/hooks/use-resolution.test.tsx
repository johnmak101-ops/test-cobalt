import { describe, it, expect, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useResolutionFacts } from './use-resolution'

vi.mock('../lib/api', () => ({
  api: {
    getResolutionManage: vi.fn().mockResolvedValue([
      { id: 'r1', kind: 'customer_group', lhs: 'SEH', rhs: 'PRIMARK', status: 'approved', source: 'seed', reason: null, active: true, createdAt: '' },
    ]),
  },
}))

const wrapper = ({ children }: { children: ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('useResolutionFacts', () => {
  it('fetches the manage list from GET /masters/resolution/manage', async () => {
    const { result } = renderHook(() => useResolutionFacts(), { wrapper })
    await waitFor(() => expect(result.current.data).toHaveLength(1))
    expect(result.current.data![0].lhs).toBe('SEH')
  })
})
