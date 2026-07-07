import { describe, it, expect, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useUsers } from './use-users'

vi.mock('../lib/api', () => ({
  api: { get: vi.fn().mockResolvedValue([{ id: 'u1', email: 'a@b.com', name: 'A', role: 'VIEWER', active: true, mustReset: true, avatarInitials: 'A', createdAt: '' }]) },
}))

const wrapper = ({ children }: { children: ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('useUsers', () => {
  it('fetches the users list from GET /users', async () => {
    const { result } = renderHook(() => useUsers(), { wrapper })
    await waitFor(() => expect(result.current.data).toHaveLength(1))
    expect(result.current.data![0].email).toBe('a@b.com')
  })
})
