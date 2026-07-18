import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '../../lib/utils'

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100]

/** Standalone page-size dropdown — place in page header / top-right */
export function PageSizeSelect({
  value,
  onChange,
}: {
  value: number
  onChange: (size: number) => void
}) {
  return (
    <div className="flex items-center gap-1.5">
      <label className="text-xs text-text-muted">Show</label>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-7 rounded-md border border-border bg-surface-700 px-1.5 text-xs text-text-primary focus:border-cobalt-primary focus:outline-none"
      >
        {PAGE_SIZE_OPTIONS.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
      <span className="text-xs text-text-muted">per page</span>
    </div>
  )
}

interface PaginationProps {
  currentPage: number
  totalPages: number
  totalItems: number
  pageSize: number
  onPageChange: (page: number) => void
}

export function Pagination({
  currentPage,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
}: PaginationProps) {
  if (totalItems === 0) return null

  const startItem = (currentPage - 1) * pageSize + 1
  const endItem = Math.min(currentPage * pageSize, totalItems)

  // Build visible page numbers: always show first, last, current, and neighbors
  const pages: (number | '...')[] = []
  if (totalPages > 1) {
    for (let i = 1; i <= totalPages; i++) {
      if (
        i === 1 ||
        i === totalPages ||
        (i >= currentPage - 1 && i <= currentPage + 1)
      ) {
        pages.push(i)
      } else if (pages[pages.length - 1] !== '...') {
        pages.push('...')
      }
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 pt-4">
      <p className="text-xs text-text-muted">
        Showing {startItem}–{endItem} of {totalItems}
      </p>
      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onPageChange(currentPage - 1)}
            disabled={currentPage <= 1}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-700 hover:text-text-primary disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ChevronLeft size={14} />
          </button>
          {pages.map((p, i) =>
            p === '...' ? (
              <span
                key={`ellipsis-${i}`}
                className="inline-flex h-8 w-8 items-center justify-center text-xs text-text-muted"
              >
                ...
              </span>
            ) : (
              <button
                type="button"
                key={p}
                onClick={() => onPageChange(p)}
                className={cn(
                  'inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-xs font-medium transition-colors',
                  currentPage === p
                    ? 'bg-cobalt-primary text-white'
                    : 'text-text-muted hover:bg-surface-700 hover:text-text-primary'
                )}
              >
                {p}
              </button>
            )
          )}
          <button
            type="button"
            onClick={() => onPageChange(currentPage + 1)}
            disabled={currentPage >= totalPages}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-700 hover:text-text-primary disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  )
}

/** Helper hook for client-side pagination */
export function usePagination<T>(items: T[], pageSize = 25) {
  const totalItems = items.length
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))

  return {
    totalItems,
    totalPages,
    pageSize,
    getPage: (page: number) => {
      const start = (page - 1) * pageSize
      return items.slice(start, start + pageSize)
    },
  }
}
