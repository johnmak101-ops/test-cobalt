/**
 * Free-text shipment search picker for Review "Move PO to another shipment".
 * Hits GET /api/shipments?q= via useShipmentSearch; parent owns commit.
 */
import { useEffect, useMemo, useState } from 'react'
import { Loader2, Search, Ship } from 'lucide-react'
import {
  useShipmentSearch,
  type ShipmentSearchHit,
} from '../../hooks/use-shipment-search'
import { Badge } from '../ui/Badge'

const DEBOUNCE_MS = 300

export interface ShipmentSearchPickerProps {
  /** Current shipment id — never offer re-homing onto self. */
  excludeId: string
  onSelect: (id: string, hit: ShipmentSearchHit) => void
  onCancel: () => void
}

function hitLabel(hit: ShipmentSearchHit): string {
  const booking = (hit.bookingNo ?? hit.soNumber ?? '—').trim() || '—'
  const parts = [booking]
  if (hit.customerName?.trim()) parts.push(hit.customerName.trim())
  if (hit.route?.trim()) parts.push(hit.route.trim())
  return parts.join(' · ')
}

export function ShipmentSearchPicker({
  excludeId,
  onSelect,
  onCancel,
}: ShipmentSearchPickerProps) {
  const [input, setInput] = useState('')
  const [debounced, setDebounced] = useState('')

  useEffect(() => {
    const t = setTimeout(() => setDebounced(input), DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [input])

  const { data, isFetching } = useShipmentSearch(debounced)

  const results = useMemo(() => {
    const rows = data?.shipments ?? []
    return rows.filter((s) => s.id !== excludeId)
  }, [data?.shipments, excludeId])

  const trimmedInput = input.trim()
  const queryReady = debounced.trim().length >= 2
  const showHint = trimmedInput.length < 2
  const showLoading = queryReady && isFetching && results.length === 0
  const showEmpty = queryReady && !isFetching && results.length === 0

  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface-900 p-3"
      data-testid="shipment-search-picker"
    >
      <div className="relative">
        <Search
          size={14}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
          aria-hidden
        />
        <input
          type="search"
          role="searchbox"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Search booking#, SO, HBL, container, PO…"
          className="h-9 w-full rounded-lg border border-border bg-surface-800 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted"
          aria-label="Search shipments"
        />
      </div>

      <div className="min-h-[8rem] max-h-60 overflow-auto">
        {showHint ? (
          <p className="flex h-32 items-center justify-center text-sm text-text-muted">
            Type at least 2 characters to search.
          </p>
        ) : showLoading ? (
          <div className="flex h-32 items-center justify-center gap-2 text-sm text-text-muted">
            <Loader2 size={16} className="animate-spin" aria-hidden />
            Searching…
          </div>
        ) : showEmpty ? (
          <p className="flex h-32 items-center justify-center text-sm text-text-muted">
            No shipments match your search.
          </p>
        ) : (
          <ul className="space-y-1" role="listbox" aria-label="Shipment search results">
            {results.map((hit) => (
              <li key={hit.id} role="option" aria-selected={false}>
                <button
                  type="button"
                  onClick={() => onSelect(hit.id, hit)}
                  className="flex w-full items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left transition-colors hover:border-border hover:bg-surface-700"
                >
                  <Ship size={16} className="shrink-0 text-text-muted" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-medium text-cobalt-primary-light">
                        {hit.bookingNo ?? hit.soNumber ?? '—'}
                      </span>
                      <Badge variant="status" value={hit.status} />
                    </div>
                    <div className="mt-0.5 truncate text-xs text-text-muted">{hitLabel(hit)}</div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {queryReady && isFetching && results.length > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-text-muted">
          <Loader2 size={12} className="animate-spin" aria-hidden />
          Updating results…
        </p>
      )}

      <div className="flex justify-end border-t border-border pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg bg-surface-700 px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-600 hover:text-text-primary"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
