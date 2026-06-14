import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Pagination, usePagination } from './Pagination'

describe('usePagination', () => {
  it('computes totals and slices pages', () => {
    const items = Array.from({ length: 23 }, (_, i) => i)
    const { totalItems, totalPages, getPage } = usePagination(items, 10)
    expect(totalItems).toBe(23)
    expect(totalPages).toBe(3)
    expect(getPage(1)).toHaveLength(10)
    expect(getPage(3)).toEqual([20, 21, 22])
  })
})

describe('Pagination', () => {
  it('shows the range and pages, and reports page changes', async () => {
    const onPageChange = vi.fn()
    render(<Pagination currentPage={1} totalPages={3} totalItems={23} pageSize={10} onPageChange={onPageChange} />)
    expect(screen.getByText(/Showing 1.10 of 23/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '2' }))
    expect(onPageChange).toHaveBeenCalledWith(2)
  })

  it('renders nothing when there are no items', () => {
    const { container } = render(<Pagination currentPage={1} totalPages={1} totalItems={0} pageSize={10} onPageChange={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })
})
