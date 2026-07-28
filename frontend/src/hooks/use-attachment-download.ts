import { useState } from 'react'
import { downloadAttachment } from '../lib/api'

export type AttachmentDownloadStatus = 'idle' | 'loading' | 'error'

/**
 * Fetch one attachment's bytes and hand them to the browser, with the states a click needs.
 *
 * The download itself has real failure modes an operator must SEE rather than have swallowed: the
 * bytes may never have been stored locally, and the Graph re-fetch can fail or be unconfigured
 * (`ATTACHMENT_UNAVAILABLE`). So the error message is kept and surfaced by the caller, and clicking
 * again retries.
 *
 * A hook rather than a shared component because the behaviour is what must not drift while the
 * presentation legitimately differs — a chip in the email pane, a list row on the review desk. It
 * was one inline copy in EmailContent's AttachmentChip; the review desk's evidence list had no
 * download affordance at all, so an operator could see the proof named and never open it.
 *
 * One instance per row: the state is per-attachment, not per-list.
 */
export function useAttachmentDownload() {
  const [status, setStatus] = useState<AttachmentDownloadStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  const download = async (attachmentId: string, filename: string): Promise<void> => {
    if (status === 'loading') return
    setStatus('loading')
    setError(null)
    try {
      await downloadAttachment(attachmentId, filename)
      setStatus('idle')
    } catch (e) {
      setStatus('error')
      setError(e instanceof Error ? e.message : 'Download failed')
    }
  }

  return { status, error, download }
}
