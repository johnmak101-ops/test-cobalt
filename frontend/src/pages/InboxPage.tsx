import { useEmails } from '../hooks/use-emails'
import { EmailCard } from '../components/emails/EmailCard'
import { Search, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

export default function InboxPage() {
  const { data, isLoading } = useEmails()
  const [search, setSearch] = useState('')
  const qc = useQueryClient()

  const emails = (data?.emails ?? []).filter((e) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      e.subject.toLowerCase().includes(q) ||
      e.sender.toLowerCase().includes(q) ||
      (e.extractedData && e.extractedData.toLowerCase().includes(q))
    )
  })

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-text-primary">Shipping Inbox</h1>
        <button
          onClick={() => qc.invalidateQueries({ queryKey: ['emails'] })}
          className="inline-flex items-center gap-1.5 rounded-lg bg-surface-700 px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-600 hover:text-text-primary"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
        <input
          type="text"
          placeholder="Search emails..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-10 w-full rounded-lg border border-border bg-surface-700 pl-9 pr-4 text-sm text-text-primary placeholder:text-text-muted focus:border-cobalt-primary focus:outline-none"
        />
      </div>

      {/* Email list */}
      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <span className="text-sm text-text-muted">Loading emails...</span>
        </div>
      ) : emails.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center gap-2">
          <span className="text-sm text-text-muted">
            {search ? 'No emails match your search' : 'No emails yet'}
          </span>
          <p className="text-xs text-text-muted">
            Emails will appear here once the ingestion pipeline is connected.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {emails.map((email) => (
            <EmailCard key={email.id} email={email} />
          ))}
        </div>
      )}
    </div>
  )
}
