import { useQuery } from '@tanstack/react-query'
import { X, ExternalLink, Mail } from 'lucide-react'
import { api } from '../lib/api'

interface OriginalEmail {
  available: boolean
  source: 'graph' | 'corpus' | 'unconfigured' | 'error'
  messageId: string
  sourceFile?: string | null
  subject?: string | null
  from?: string | null
  receivedDateTime?: string | null
  bodyPreview?: string | null
  webLink?: string | null
  hasAttachments?: boolean
}

export function ViewOriginalModal({ messageId, onClose }: { messageId: string; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['email-original', messageId],
    queryFn: () => api.get<OriginalEmail>(`/emails/original?messageId=${encodeURIComponent(messageId)}`),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-xl border border-border bg-surface-800 p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="inline-flex items-center gap-2 font-semibold">
            <Mail size={16} className="text-text-muted" /> Original email
          </h3>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary">
            <X size={18} />
          </button>
        </div>

        {isLoading ? (
          <div className="text-sm text-text-muted">Loading…</div>
        ) : data?.available ? (
          <div className="space-y-2 text-sm">
            <div>
              <span className="text-text-muted">Subject:</span> {data.subject || '—'}
            </div>
            <div>
              <span className="text-text-muted">From:</span> {data.from || '—'}
            </div>
            <div>
              <span className="text-text-muted">Received:</span> {data.receivedDateTime || '—'}
            </div>
            <div className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-surface-900 p-3 text-text-secondary">
              {data.bodyPreview || '—'}
            </div>
            {data.webLink && (
              <a
                href={data.webLink}
                target="_blank"
                rel="noreferrer"
                className="link inline-flex items-center gap-1 text-xs"
              >
                Open in Outlook <ExternalLink size={12} />
              </a>
            )}
          </div>
        ) : (
          <div className="space-y-2 text-sm text-text-secondary">
            {data?.source === 'corpus' ? (
              <>
                <p>
                  This milestone was sourced from a labelled <strong>corpus file</strong>, not a live mailbox — there is
                  no Graph copy to fetch.
                </p>
                <p className="break-all font-mono text-xs text-text-muted">{data.sourceFile}</p>
              </>
            ) : data?.source === 'unconfigured' ? (
              <p>Original-email viewing isn't configured in this environment (no Microsoft Graph credentials).</p>
            ) : (
              <p>Couldn't load the original email.</p>
            )}
            <p className="break-all font-mono text-[11px] text-text-muted">id: {messageId}</p>
          </div>
        )}
      </div>
    </div>
  )
}
