import { describe, it, expect, vi } from 'vitest'
import { render, screen, renderHook } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Pagination, usePagination } from './Pagination'

describe('usePagination — client-side slicing', () => {
  it('computes totals and slices each page correctly', () => {
    const items = Array.from({ length: 57 }, (_, i) => i)
    const { result } = renderHook(() => usePagination(items, 25))
    expect(result.current.totalItems).toBe(57)
    expect(result.current.totalPages).toBe(3)
    expect(result.current.getPage(1)).toEqual(items.slice(0, 25))
    expect(result.current.getPage(2)).toEqual(items.slice(25, 50))
    expect(result.current.getPage(3)).toEqual(items.slice(50, 57)) // last page is the remainder
  })
  it('never reports fewer than 1 page, even when empty', () => {
    const { result } = renderHook(() => usePagination([], 25))
    expect(result.current.totalPages).toBe(1)
  })
})

describe('Pagination — controls', () => {
  it('shows the current range and jumps to a page when its number is clicked', async () => {
    const onPageChange = vi.fn()
    render(<Pagination currentPage={2} totalPages={3} totalItems={57} pageSize={25} onPageChange={onPageChange} />)
    expect(screen.getByText('Showing 26–50 of 57')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '3' }))
    expect(onPageChange).toHaveBeenCalledWith(3)
  })

  it('disables prev on the first page and next on the last page', () => {
    const { rerender } = render(
      <Pagination currentPage={1} totalPages={3} totalItems={57} pageSize={25} onPageChange={() => {}} />,
    )
    const buttons = () => screen.getAllByRole('button')
    // first button = prev (ChevronLeft), last = next (ChevronRight)
    expect(buttons()[0]).toBeDisabled() // prev disabled on page 1
    expect(buttons()[buttons().length - 1]).not.toBeDisabled() // next enabled on page 1

    rerender(<Pagination currentPage={3} totalPages={3} totalItems={57} pageSize={25} onPageChange={() => {}} />)
    expect(buttons()[0]).not.toBeDisabled() // prev enabled on last page
    expect(buttons()[buttons().length - 1]).toBeDisabled() // next disabled on last page
  })

  it('renders nothing when there are no items', () => {
    const { container } = render(
      <Pagination currentPage={1} totalPages={1} totalItems={0} pageSize={25} onPageChange={() => {}} />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
