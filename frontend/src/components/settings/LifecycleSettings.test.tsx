import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LifecycleSettings } from './LifecycleSettings'

const { getMock, putMock } = vi.hoisted(() => ({
  getMock: vi.fn(async () => ({ airDays: 7, seaDays: 45 })),
  putMock: vi.fn(async (_p: string, b: unknown) => b),
}))
vi.mock('../../lib/api', () => ({ api: { get: getMock, put: putMock } }))
vi.mock('../../hooks/use-auth', () => ({
  useAuth: () => ({ user: { id: 'u1', role: 'ADMIN' } }),
}))
vi.mock('../ui/Toast', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }))

function renderCard() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LifecycleSettings />
    </QueryClientProvider>,
  )
}

describe('LifecycleSettings — Delivered fallback transit allowances', () => {
  beforeEach(() => {
    getMock.mockClear()
    putMock.mockClear()
  })

  it('shows the stored allowances and saves an edited pair', async () => {
    const user = userEvent.setup()
    renderCard()

    const air = (await screen.findByLabelText('Air days after departure value')) as HTMLInputElement
    await waitFor(() => expect(air.value).toBe('7'))
    const sea = screen.getByLabelText('Sea days after departure value') as HTMLInputElement
    expect(sea.value).toBe('45')

    fireEvent.change(air, { target: { value: '10' } })
    fireEvent.blur(air)
    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(putMock).toHaveBeenCalledTimes(1))
    expect(putMock.mock.calls[0]![0]).toBe('/settings/etd-fallback')
    expect(putMock.mock.calls[0]![1]).toMatchObject({ airDays: 10, seaDays: 45 })
  })
})
