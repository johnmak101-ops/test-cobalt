import { useState } from 'react'
import { Badge } from '../ui/Badge'
import { formatShortDate, formatRelativeTime } from '../../lib/utils'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, ChevronRight, ChevronDown, Package } from 'lucide-react'
import type { Shipment } from '../../hooks/use-shipments'

interface ShipmentTableProps {
  shipments: Shipment[]
}

export function ShipmentTable({ shipments }: ShipmentTableProps) {
  const navigate = useNavigate()
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  const toggleExpanded = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface-800">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-surface-900/50">
              <th className="w-8 px-2 py-3"></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Shipment ID</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Customer PO#</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Customer</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Forwarder</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Route</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Status</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">ETD</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">ETA</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Last Activity</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Risk</th>
            </tr>
          </thead>
          <tbody>
            {shipments.map((s) => {
              const isExpanded = expandedIds.has(s.id)
              const poCount = s.linkedPOs?.length ?? 0
              // Meaningful identifiers — booking no / SO no (then a PO), never the opaque UUID.
              const ids = [s.bookingNo, s.soNumber].filter(Boolean) as string[]
              const primaryId = ids[0] ?? s.linkedPOs?.[0]?.poNumber ?? s.id.slice(0, 8)
              const secondaryId = ids[1] ?? null

              return (
                <>
                  {/* Shipment parent row */}
                  <tr
                    key={s.id}
                    onClick={() => navigate(`/shipments/${s.id}`)}
                    className="cursor-pointer border-b border-border last:border-0 hover:bg-surface-700 transition-colors"
                  >
                    <td className="px-2 py-3 text-center">
                      {poCount > 0 ? (
                        <button
                          onClick={(e) => toggleExpanded(s.id, e)}
                          className="inline-flex h-5 w-5 items-center justify-center rounded text-text-muted hover:bg-surface-600 hover:text-text-primary transition-colors"
                        >
                          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 font-mono text-sm font-medium text-cobalt-primary-light">
                      {primaryId}
                      {secondaryId && (
                        <div className="text-[11px] font-normal text-text-muted">SO {secondaryId}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="group relative inline-block">
                        <span className="inline-flex items-center gap-1.5 rounded-md bg-surface-600 px-2 py-0.5 text-xs font-medium text-text-secondary cursor-default">
                          <Package size={12} className="text-text-muted" />
                          {poCount} PO{poCount !== 1 ? 's' : ''}
                        </span>
                        {poCount > 0 && (
                          <div className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden w-72 rounded-lg border border-border bg-surface-800 p-3 shadow-xl group-hover:pointer-events-auto group-hover:block">
                            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                              Customer Purchase Orders
                            </p>
                            <div className="divide-y divide-border">
                              {s.linkedPOs?.map((po) => (
                                <div
                                  key={po.id}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    navigate(`/purchase-orders/${po.id}`, { state: { fromShipment: s.id } })
                                  }}
                                  className="rounded-md px-2 py-2 transition-colors hover:bg-surface-700 cursor-pointer"
                                >
                                  <span className="font-mono text-xs font-medium text-cobalt-primary-light">{po.poNumber}</span>
                                  <div className="mt-0.5 flex items-center justify-between text-[11px] text-text-muted">
                                    <span className="truncate">{po.vendor?.name ?? '—'}</span>
                                    <span className="shrink-0 ml-3">
                                      {po.quantity ?? '—'} {po.totalQuantity ? `/ ${po.totalQuantity}` : ''} {po.quantityUnit ?? ''}
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-text-secondary">
                      {s.customer?.name ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-text-secondary">
                      {s.forwarder?.name ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-text-secondary">{s.route ?? '—'}</td>
                    <td className="px-4 py-3">
                      <Badge variant="status" value={s.status} />
                    </td>
                    <td className="px-4 py-3 text-sm text-text-secondary">{formatShortDate(s.etd)}</td>
                    <td className="px-4 py-3 text-sm text-text-secondary">{formatShortDate(s.eta)}</td>
                    <td className="px-4 py-3 text-sm text-text-muted">
                      {formatRelativeTime(s.updatedAt)}
                    </td>
                    <td className="px-4 py-3">
                      {s.riskLevel === 'DELAYED' && (
                        <AlertTriangle size={16} className="text-status-critical" />
                      )}
                      {s.riskLevel === 'AT_RISK' && (
                        <AlertTriangle size={16} className="text-status-warning" />
                      )}
                    </td>
                  </tr>

                  {/* Expanded PO child rows */}
                  {isExpanded && s.linkedPOs?.map((po) => (
                    <tr
                      key={`${s.id}-${po.id}`}
                      onClick={() => navigate(`/shipments/${s.id}`)}
                      className="cursor-pointer border-b border-border last:border-0 bg-surface-900/40 hover:bg-surface-700/50 transition-colors"
                    >
                      <td className="px-2 py-2"></td>
                      <td className="px-4 py-2 pl-8">
                        <span className="text-[11px] text-text-muted">└</span>
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-cobalt-primary-light/80">
                        {po.poNumber}
                      </td>
                      <td className="px-4 py-2 text-xs text-text-muted">
                        {po.vendor?.name ?? '—'}
                      </td>
                      <td className="px-4 py-2 text-xs text-text-muted" colSpan={2}>
                        {po.quantity ?? '—'} / {po.totalQuantity ?? '—'} {po.quantityUnit ?? ''}
                      </td>
                      <td className="px-4 py-2" colSpan={5}></td>
                    </tr>
                  ))}
                </>
              )
            })}
            {shipments.length === 0 && (
              <tr>
                <td colSpan={11} className="px-4 py-12 text-center text-sm text-text-muted">
                  No shipments found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
