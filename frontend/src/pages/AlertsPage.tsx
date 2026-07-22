import { useEffect, useRef, useState, useMemo } from 'react'
import { useAlerts } from '../hooks/use-alerts'
import { AlertSection } from '../components/alerts/AlertSection'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Settings, Download, Calendar } from 'lucide-react'
import { cn } from '../lib/utils'

const filterTabs = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'read', label: 'Read' },
] as const

type FilterKey = (typeof filterTabs)[number]['key']

export default function AlertsPage() {
  const { data, isLoading } = useAlerts()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const severityFilter = searchParams.get('severity')
  const criticalRef = useRef<HTMLDivElement>(null)
  const warningRef = useRef<HTMLDivElement>(null)
  const [filter, setFilter] = useState<FilterKey>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [exporting, setExporting] = useState(false)

  const activeAlerts = (data?.alerts ?? []).filter((a) => a.status === 'ACTIVE')

  // Apply read/unread + date filter
  const filtered = useMemo(() => {
    let result = activeAlerts.filter((a) => {
      if (filter === 'unread') return !a.readAt
      if (filter === 'read') return !!a.readAt
      return true
    })
    if (dateFrom) {
      const from = new Date(dateFrom)
      result = result.filter((a) => new Date(a.triggeredAt) >= from)
    }
    if (dateTo) {
      const to = new Date(dateTo)
      to.setHours(23, 59, 59, 999)
      result = result.filter((a) => new Date(a.triggeredAt) <= to)
    }
    return result
  }, [activeAlerts, filter, dateFrom, dateTo])

  const critical = filtered.filter((a) => a.severity === 'CRITICAL')
  const warning = filtered.filter((a) => a.severity === 'WARNING')
  const info = filtered.filter((a) => a.severity === 'INFO')

  // Counts for tab badges
  const unreadCount = activeAlerts.filter((a) => !a.readAt).length
  const readCount = activeAlerts.filter((a) => !!a.readAt).length

  // Auto-scroll to severity section when ?severity=CRITICAL or ?severity=WARNING
  useEffect(() => {
    if (isLoading) return
    if (severityFilter === 'CRITICAL' && criticalRef.current) {
      criticalRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    } else if (severityFilter === 'WARNING' && warningRef.current) {
      warningRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [severityFilter, isLoading])

  const clearDateFilter = () => {
    setDateFrom('')
    setDateTo('')
  }

  const handleExport = async () => {
    setExporting(true)
    try {
      // Fetch full shipment detail for each unique shipment in the alerts
      const api = (await import('../lib/api')).api
      const shipmentIds = [...new Set(filtered.flatMap((a) => (a.shipmentId ? [a.shipmentId] : [])))]
      const shipmentEntries = await Promise.all(
        shipmentIds.map(async (id) => {
          try {
            const detail = await api.get(`/shipments/${id}`)
            return [id, detail] as const
          } catch {
            return [id, null] as const
          }
        }),
      )
      const shipmentCache = new Map<string, any>(shipmentEntries)

      const headers = [
        // Alert fields
        'Alert ID',
        'Severity',
        'Message',
        'Status',
        'Triggered At',
        'Read',
        // Shipment detail fields
        'Booking No',
        'Shipment PO#s',
        'SO#',
        'Item/Style No',
        'Shipment Status',
        'Risk Level',
        'Route',
        'Qty Shipped',
        'UOM',
        'Consignee Name',
        'Consignee Address',
        'Customer',
        'Vendor',
        'Forwarder',
        'Container No',
        'HBL/AWB/FCR No',
        'MBL No',
        'SCAC Code',
        'Vessel Name',
        'Voyage No',
        'Warehouse Address',
        'CRD',
        'CFS Cutoff',
        'ETD',
        'ETA',
        'ATD',
        'ATA',
        'WH Start Date',
        'WH End Date',
        'In DC Date',
      ]

      const rows = filtered.map((a) => {
        const s = shipmentCache.get(a.shipmentId)
        return [
          a.id,
          a.severity,
          a.message,
          a.status,
          a.triggeredAt ? new Date(a.triggeredAt).toISOString() : '',
          a.readAt ? 'Yes' : 'No',
          // Shipment detail fields
          s?.bookingNo ?? '',
          s?.poNumbers ?? a.shipment?.poNumbers ?? '',
          s?.soNumber ?? '',
          s?.itemStyleNo ?? '',
          s?.status ?? '',
          s?.riskLevel ?? '',
          s?.route ?? a.shipment?.route ?? '',
          String(s?.quantityShipped ?? ''),
          s?.quantityUnit ?? '',
          s?.consigneeName ?? '',
          s?.consigneeAddress ?? '',
          s?.customer?.name ?? a.shipment?.customer?.name ?? '',
          s?.vendor?.name ?? '',
          s?.forwarder?.name ?? '',
          s?.containerNo ?? '',
          s?.hblNumber ?? '',
          s?.mblNumber ?? '',
          s?.scacCode ?? '',
          s?.vesselName ?? '',
          s?.voyageNumber ?? '',
          s?.warehouseAddress ?? '',
          s?.crd ? new Date(s.crd).toLocaleDateString('en-GB') : '',
          s?.cfsCutoff ? new Date(s.cfsCutoff).toLocaleDateString('en-GB') : '',
          s?.etd ? new Date(s.etd).toLocaleDateString('en-GB') : '',
          s?.eta ? new Date(s.eta).toLocaleDateString('en-GB') : '',
          s?.actualDeparture ? new Date(s.actualDeparture).toLocaleDateString('en-GB') : '',
          s?.actualArrival ? new Date(s.actualArrival).toLocaleDateString('en-GB') : '',
          s?.warehouseStartDate ? new Date(s.warehouseStartDate).toLocaleDateString('en-GB') : '',
          s?.warehouseEndDate ? new Date(s.warehouseEndDate).toLocaleDateString('en-GB') : '',
          s?.inDcDate ? new Date(s.inDcDate).toLocaleDateString('en-GB') : '',
        ]
      })

      const escape = (v: string) => {
        if (v.includes(',') || v.includes('"') || v.includes('\n')) return `"${v.replace(/"/g, '""')}"`
        return v
      }
      const csv = [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))].join('\n')
      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      const dateLabel = dateFrom || dateTo ? `_${dateFrom || 'start'}-${dateTo || 'end'}` : ''
      link.download = `alerts${dateLabel}.csv`
      link.click()
      URL.revokeObjectURL(link.href)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-text-primary">Alerts</h1>
        </div>
        <button
          type="button"
          onClick={() => navigate('/settings/alerts')}
          className="inline-flex items-center gap-1.5 rounded-lg bg-surface-700 px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-600 hover:text-text-primary"
        >
          <Settings size={14} />
          Alert Rules
        </button>
      </div>

      {/* Filter tabs + Date filter + Export */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-lg bg-surface-900 p-1">
          {filterTabs.map((tab) => {
            const count =
              tab.key === 'all'
                ? activeAlerts.length
                : tab.key === 'unread'
                  ? unreadCount
                  : readCount
            return (
              <button
                type="button"
                key={tab.key}
                onClick={() => setFilter(tab.key)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                  filter === tab.key
                    ? 'bg-cobalt-primary text-white'
                    : 'text-text-muted hover:text-text-primary'
                )}
              >
                {tab.label}
                <span
                  className={cn(
                    'ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                    filter === tab.key
                      ? 'bg-white/20 text-white'
                      : 'bg-surface-700 text-text-muted'
                  )}
                >
                  {count}
                </span>
              </button>
            )
          })}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Calendar size={14} className="text-text-muted" />
          <input
            type="date"
            aria-label="Filter from date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="h-8 rounded-lg border border-border bg-surface-800 px-2 text-sm text-text-primary"
          />
          <span className="text-text-muted text-xs">—</span>
          <input
            type="date"
            aria-label="Filter to date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="h-8 rounded-lg border border-border bg-surface-800 px-2 text-sm text-text-primary"
          />
          {(dateFrom || dateTo) && (
            <button
              type="button"
              onClick={clearDateFilter}
              className="h-8 rounded-lg border border-border bg-surface-700 px-2 text-xs text-text-secondary hover:bg-surface-600 hover:text-text-primary"
            >
              Clear
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={exporting || filtered.length === 0}
          className="inline-flex items-center gap-1.5 rounded-lg bg-cobalt-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-cobalt-primary-light disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Download size={14} />
          {exporting ? 'Exporting...' : 'Export CSV'}
        </button>
      </div>

      {(dateFrom || dateTo) && (
        <div className="text-xs text-text-muted">
          Showing {filtered.length} of {activeAlerts.length} alerts
          {dateFrom && ` from ${dateFrom}`}
          {dateTo && ` to ${dateTo}`}
        </div>
      )}

      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <span className="text-sm text-text-muted">Loading alerts...</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center gap-2">
          <span className="text-sm text-text-muted">
            {filter === 'unread'
              ? 'No unread alerts'
              : filter === 'read'
                ? 'No read alerts'
                : 'No active alerts'}
          </span>
          <p className="text-xs text-text-muted">
            {filter === 'all'
              ? 'All shipments are on track.'
              : filter === 'unread'
                ? 'All alerts have been reviewed.'
                : 'No alerts have been marked as read yet.'}
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          <div ref={criticalRef}>
            <AlertSection severity="CRITICAL" alerts={critical} />
          </div>
          <div ref={warningRef}>
            <AlertSection severity="WARNING" alerts={warning} />
          </div>
          <AlertSection severity="INFO" alerts={info} />
        </div>
      )}
    </div>
  )
}