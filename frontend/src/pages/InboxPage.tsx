import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Search, RefreshCw, Inbox, ExternalLink, Link as LinkIcon, AlertTriangle, ArrowLeft } from 'lucide-react'
import { useEmails, useMarkEmailRead, type ShippingEmail } from '../hooks/use-emails'
import { EmailContent, parseSender, type RelatedEmail } from '../components/shipments/EmailContent'
import { Badge } from '../components/ui/Badge'
import { Pagination, usePagination, PageSizeSelect } from '../components/ui/Pagination'
import { toast } from '../components/ui/Toast'
import { cn, formatRelativeTime } from '../lib/utils'

/** A short, human one-liner drawn from the AI-extracted fields, for the list row's preview line. */
function extractedPreview(raw: string | null): string | null {
  if (!raw) return null
  let d: Record<string, unknown>
  try {
    d = JSON.parse(raw)
  } catch {
    return null
  }
  const str = (v: unknown) => (Array.isArray(v) ? v.filter(Boolean).join(', ') : v == null ? '' : String(v)).trim()
  const parts: string[] = []
  const po = str(d.customer_po ?? d.po_no)
  if (po) parts.push(`PO ${po}`)
  const origin = str(d.pol ?? d.poi ?? d.port_of_loading)
  const dest = str(d.pod ?? d.port_of_discharge)
  if (origin || dest) parts.push(`${origin || '—'} → ${dest || '—'}`)
  const ref = str(d.booking_no ?? d.so_no ?? d.hbl_awb_fcr_no ?? d.container_no)
  if (ref && parts.length < 2) parts.push(ref)
  const consignee = str(d.consignee_name)
  if (consignee && parts.length < 3) parts.push(consignee)
  return parts.slice(0, 3).join('  ·  ') || null
}

/** One compact, clearly-clickable message row in the Outlook-style list. */
function EmailRow({
  email,
  selected,
  onSelect,
}: {
  email: ShippingEmail
  selected: boolean
  onSelect: () => void
}) {
  const { name } = parseSender(email.sender)
  const preview = extractedPreview(email.extractedData)
  const unmatched = !!email.extractedData && !email.isMatched
  const unread = !email.isRead

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full flex-col gap-0.5 border-l-2 px-3 py-2.5 text-left transition-colors',
        selected
          ? 'border-cobalt-primary bg-surface-700'
          : 'border-transparent hover:bg-surface-800',
      )}
    >
      <div className="flex items-center gap-2">
        {unread && <span className="h-2 w-2 shrink-0 rounded-full bg-cobalt-primary" />}
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-sm',
            unread ? 'font-semibold text-text-primary' : 'font-medium text-text-secondary',
          )}
        >
          {name}
        </span>
        <span className="shrink-0 text-[11px] text-text-muted">{formatRelativeTime(email.receivedAt)}</span>
      </div>
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-xs',
            unread ? 'text-text-primary' : 'text-text-secondary',
          )}
        >
          {email.subject || '(no subject)'}
        </span>
        {email.emailType && <Badge variant="emailType" value={email.emailType} />}
      </div>
      {(preview || unmatched) && (
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[11px] text-text-muted">{preview}</span>
          {unmatched && (
            <span
              className="inline-flex shrink-0 items-center gap-1 text-[11px] text-status-warning"
              title="Extracted, but no shipment matched yet"
            >
              <AlertTriangle size={11} />
              Unmatched
            </span>
          )}
        </div>
      )}
    </button>
  )
}

/** The right-hand reading pane: subject/action bar over the shared Outlook reading-pane body. */
function ReadingPane({ email, onBack }: { email: ShippingEmail; onBack: () => void }) {
  const related: RelatedEmail = {
    id: email.id,
    subject: email.subject,
    sender: email.sender,
    receivedAt: email.receivedAt,
    emailType: email.emailType,
  }
  const windowUrl = `/email/${email.id}?type=${encodeURIComponent(email.emailType ?? '')}`

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-surface-800">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3 lg:px-6">
        <button
          type="button"
          onClick={onBack}
          className="shrink-0 rounded-lg p-1.5 text-text-muted hover:bg-surface-700 hover:text-text-primary lg:hidden"
          title="Back to list"
        >
          <ArrowLeft size={16} />
        </button>
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-text-primary">
          {email.subject || '(no subject)'}
        </h2>
        {email.shipmentId && (
          <Link
            to={`/shipments/${email.shipmentId}`}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-surface-700 px-3 py-1.5 text-xs font-medium text-cobalt-primary-light hover:bg-surface-600"
          >
            <LinkIcon size={13} />
            <span className="hidden sm:inline">View shipment</span>
          </Link>
        )}
        <a
          href={windowUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-surface-700 px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-600 hover:text-text-primary"
          title="Open this email in a new window"
        >
          <ExternalLink size={13} />
          <span className="hidden sm:inline">Open</span>
        </a>
      </div>
      {/* Fetches + renders the header, sandboxed HTML body, and attachments (shared with the pop-out window). */}
      <EmailContent email={related} />
    </div>
  )
}

export default function InboxPage() {
  const { data, isLoading } = useEmails()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(25)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const qc = useQueryClient()
  const markRead = useMarkEmailRead()

  const emails = (data?.emails ?? []).filter((e) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      e.subject.toLowerCase().includes(q) ||
      e.sender.toLowerCase().includes(q) ||
      (e.extractedData && e.extractedData.toLowerCase().includes(q))
    )
  })

  const { totalItems, totalPages, pageSize, getPage } = usePagination(emails, perPage)
  const pageEmails = getPage(page)
  // Keep the reading pane on the chosen email even if it paginates out of view.
  const selected = emails.find((e) => e.id === selectedId) ?? null

  const handleSearch = (v: string) => {
    setSearch(v)
    setPage(1)
  }

  const handlePageSizeChange = (size: number) => {
    setPerPage(size)
    setPage(1)
  }

  const selectEmail = (email: ShippingEmail) => {
    setSelectedId(email.id)
    if (!email.isRead) markRead.mutate(email.id)
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="mb-4 flex shrink-0 items-center justify-between">
        <h1 className="text-lg font-semibold text-text-primary">Shipping Inbox</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={async () => {
              await qc.invalidateQueries({ queryKey: ['emails'] })
              toast('Inbox refreshed')
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-surface-700 px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-600 hover:text-text-primary"
          >
            <RefreshCw size={14} />
            Refresh
          </button>
          <PageSizeSelect value={perPage} onChange={handlePageSizeChange} />
        </div>
      </div>

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <span className="text-sm text-text-muted">Loading emails...</span>
        </div>
      ) : emails.length === 0 && !search ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2">
          <Inbox size={32} className="text-text-muted" />
          <span className="text-sm text-text-muted">No emails yet</span>
          <p className="text-xs text-text-muted">
            Emails will appear here once the ingestion pipeline is connected.
          </p>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 gap-4">
          {/* LEFT — message list */}
          <div
            className={cn(
              'min-h-0 w-full flex-col lg:flex lg:w-96 lg:shrink-0',
              selected ? 'hidden lg:flex' : 'flex',
            )}
          >
            {/* Search */}
            <div className="relative mb-3 shrink-0">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                type="text"
                placeholder="Search emails..."
                value={search}
                onChange={(e) => handleSearch(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-surface-800 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted"
              />
            </div>

            {/* Scrollable rows */}
            <div className="min-h-0 flex-1 divide-y divide-border overflow-y-auto rounded-xl border border-border bg-surface-900">
              {pageEmails.length === 0 ? (
                <div className="flex h-full items-center justify-center p-6">
                  <span className="text-sm text-text-muted">No emails match your search</span>
                </div>
              ) : (
                pageEmails.map((email) => (
                  <EmailRow
                    key={email.id}
                    email={email}
                    selected={email.id === selectedId}
                    onSelect={() => selectEmail(email)}
                  />
                ))
              )}
            </div>

            <div className="shrink-0">
              <Pagination
                currentPage={page}
                totalPages={totalPages}
                totalItems={totalItems}
                pageSize={pageSize}
                onPageChange={setPage}
              />
            </div>
          </div>

          {/* RIGHT — reading pane */}
          <div className={cn('min-h-0 flex-1 flex-col', selected ? 'flex' : 'hidden lg:flex')}>
            {selected ? (
              <ReadingPane email={selected} onBack={() => setSelectedId(null)} />
            ) : (
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-surface-900/50">
                <Inbox size={40} className="text-text-muted" />
                <div className="text-center">
                  <p className="text-sm font-medium text-text-secondary">Select an email to read</p>
                  <p className="mt-0.5 text-xs text-text-muted">
                    Choose a message from the list to open it here.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
