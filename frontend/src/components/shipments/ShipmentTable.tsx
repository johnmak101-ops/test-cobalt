import { useState, Fragment } from 'react'
import { Badge } from '../ui/Badge'
import { ModeIcon } from '../ui/ModeIcon'
import { formatShortDate, formatRelativeTime, modeLabel } from '../../lib/utils'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, ChevronRight, ChevronDown } from 'lucide-react'
import { PoBadge } from './PoBadge'
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
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Job / Shipment</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">POs</th>
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
              const shortId = s.bookingNo ?? s.id.slice(0, 12)

              return (
                <Fragment key={s.id}>
                  <tr
                    onClick={() => navigate(`/shipments/${s.id}`)}
                    className="cursor-pointer border-b border-border last:border-0 transition-colors hover:bg-surface-700"
                  >
                    <td className="px-2 py-3 text-center">
                      {poCount > 0 ? (
                        <button
                          onClick={(e) => toggleExpanded(s.id, e)}
                          className="inline-flex h-5 w-5 items-center justify-center rounded text-text-muted transition-colors hover:bg-surface-600 hover:text-text-primary"
                        >
                          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <ModeIcon mode={s.mode} size={16} className="shrink-0 text-cobalt-teal" />
                        <div className="min-w-0">
                          <div className="font-mono text-sm font-medium text-cobalt-primary-light">{s.jobNo ?? shortId}</div>
                          <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
                            {s.mode && <span>{modeLabel(s.mode)}</span>}
                            {s.jobNo && shortId && shortId !== s.jobNo && <span className="font-mono">· {shortId}</span>}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <PoBadge shipmentId={s.id} pos={s.linkedPOs ?? []} />
                    </td>
                    <td className="px-4 py-3 text-sm text-text-secondary">{s.customer?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-sm text-text-secondary">{s.forwarder?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-sm text-text-secondary">{s.route ?? '—'}</td>
                    <td className="px-4 py-3">
                      <Badge variant="status" value={s.status} />
                    </td>
                    <td className="px-4 py-3 text-sm text-text-secondary">{formatShortDate(s.etd)}</td>
                    <td className="px-4 py-3 text-sm text-text-secondary">{formatShortDate(s.eta)}</td>
                    <td className="px-4 py-3 text-sm text-text-muted">{formatRelativeTime(s.updatedAt)}</td>
                    <td className="px-4 py-3">
                      {s.riskLevel === 'DELAYED' && <AlertTriangle size={16} className="text-status-critical" />}
                      {s.riskLevel === 'AT_RISK' && <AlertTriangle size={16} className="text-status-warning" />}
                    </td>
                  </tr>

                  {isExpanded &&
                    s.linkedPOs?.map((po) => (
                      <tr
                        key={`${s.id}-${po.id}`}
                        onClick={() => navigate(`/shipments/${s.id}`)}
                        className="cursor-pointer border-b border-border bg-surface-900/40 transition-colors last:border-0 hover:bg-surface-700/50"
                      >
                        <td className="px-2 py-2"></td>
                        <td className="px-4 py-2 pl-8">
                          <span className="text-[11px] text-text-muted">&#8627;</span>
                        </td>
                        <td className="px-4 py-2 font-mono text-xs text-cobalt-primary-light/80">{po.poNumber}</td>
                        <td className="px-4 py-2 text-xs text-text-muted">{po.vendor?.name ?? '—'}</td>
                        <td className="px-4 py-2 text-xs text-text-muted" colSpan={2}>
                          {po.totalQuantity != null ? `${po.totalQuantity} ${po.quantityUnit ?? ''}` : '—'}
                        </td>
                        <td className="px-4 py-2" colSpan={5}></td>
                      </tr>
                    ))}
                </Fragment>
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
