import { Injectable, Logger } from '@nestjs/common'
import { GraphService, type OriginalEmail } from './graph.service'
import { EmailRepository } from '../db/repositories/email.repository'

const MOCK_PREFIX = 'mock:'

/** One downloadable attachment in the email window (one entry per FILE, not per parsed part). */
export interface EmailAttachment {
  filename: string
  label: string | null
  kind: string | null
  mime: string | null
  sizeBytes: number
  /** ORIGINAL bytes, base64 (capped) — office binary, image, or pdf the human downloads & opens */
  base64?: string | null
  /** text-native original (txt/csv/html) served as a file when there are no binary bytes */
  text?: string | null
  /** original exists but exceeds the inline cap */
  tooLarge?: boolean
  /** an office binary whose original was NOT retained — only the parsed text survives (purged) */
  parsedOnly?: boolean
}

@Injectable()
export class EmailsService {
  private readonly log = new Logger('EmailsService')
  constructor(
    private readonly graph: GraphService,
    private readonly emails: EmailRepository,
  ) {}

  /**
   * "View original": resolve a milestone's source-email pointer to the actual email.
   *  1. ingested in the shared queue schema (same-host) → return the real subject/sender/body
   *  2. `mock:<file>` not ingested → corpus pointer, no live copy (return the filename)
   *  3. live mailbox via Graph (production), else not configured
   * Never throws — any failure degrades to `available:false` so the UI always renders.
   */
  async getOriginal(messageId: string): Promise<OriginalEmail> {
    if (!messageId) return { available: false, source: 'unconfigured', messageId: '' }

    try {
      const m = await this.emails.findIngested(messageId)
      if (m) {
        return {
          available: true,
          source: 'corpus',
          messageId,
          sourceFile: m.sourceFile,
          subject: m.subject,
          from: m.sender,
          receivedDateTime: m.receivedAt ? m.receivedAt.toISOString() : null,
          bodyPreview: m.bodyText ? m.bodyText.slice(0, 6000) : null,
          bodyText: m.bodyText,
          bodyHtml: m.bodyHtml,
          hasAttachments: (m.attachmentCount ?? 0) > 0,
        }
      }
    } catch (err) {
      this.log.warn(`local email lookup unavailable: ${String(err).slice(0, 80)}`)
    }

    if (messageId.startsWith(MOCK_PREFIX)) {
      return { available: false, source: 'corpus', messageId, sourceFile: messageId.slice(MOCK_PREFIX.length) }
    }
    if (!this.graph.configured()) {
      return { available: false, source: 'unconfigured', messageId }
    }
    try {
      return await this.graph.fetchMessage(messageId)
    } catch (err) {
      this.log.warn(`view-original fetch failed for ${messageId}: ${String(err)}`)
      return { available: false, source: 'error', messageId }
    }
  }

  /**
   * Attachments for the email window — ONE entry per file, carrying the ORIGINAL so a human can
   * download and open it locally:
   *   - office binaries (docx/xlsx/doc/rtf) → the retained `rawBytes` (the real .docx/.xlsx)
   *   - image / pdf → the passthrough bytes (already the original)
   *   - txt/csv/html → the text content itself (that IS the original)
   * The repository join yields one row per normalized PART (a multi-sheet xlsx → N rows), so we
   * collapse by attachment id to avoid listing the same file N times. Documents float to the top so
   * the meaningful files (B/L, invoice) sit above inline signature logos. Resilient: a queue that
   * isn't co-located (2-VM split) degrades to `available:false`.
   */
  async getAttachments(messageId: string): Promise<{ available: boolean; attachments: EmailAttachment[] }> {
    if (!messageId) return { available: false, attachments: [] }
    const MAX_INLINE = 12 * 1024 * 1024 // bytes; base64'd into the JSON response
    const OFFICE = new Set(['docx', 'xlsx', 'doc', 'rtf'])
    try {
      const rows = await this.emails.attachmentsFor(messageId)

      // collapse the per-part rows into one group per attachment (the file)
      const groups = new Map<string, typeof rows>()
      for (const r of rows) {
        const g = groups.get(r.attachmentId)
        if (g) g.push(r)
        else groups.set(r.attachmentId, [r])
      }

      const attachments: EmailAttachment[] = []
      for (const group of groups.values()) {
        const first = group[0]!
        const a: EmailAttachment = {
          filename: leafName(first.filename),
          label: group.length > 1 ? null : first.label, // a per-sheet label is noise at file level
          kind: first.sourceKind,
          mime: first.declaredMime ?? first.mime ?? null,
          sizeBytes: first.sizeBytes,
        }

        const passthrough = group.find((g) => g.imageBytes) // image / pdf — bytes ARE the original
        if (first.rawBytes) {
          if (first.rawBytes.length <= MAX_INLINE) a.base64 = first.rawBytes.toString('base64')
          else a.tooLarge = true
        } else if (passthrough?.imageBytes) {
          if (passthrough.imageBytes.length <= MAX_INLINE) a.base64 = passthrough.imageBytes.toString('base64')
          else a.tooLarge = true
          a.mime = passthrough.mime ?? a.mime
        } else {
          // no binary original — serve the text-native original, or flag a purged office doc
          const textPart = group.find((g) => g.textContent)
          if (textPart?.textContent) {
            a.text = group.map((g) => g.textContent).filter(Boolean).join('\n\n').slice(0, 500_000)
            a.kind = textPart.kind ?? first.sourceKind
          }
          if (OFFICE.has(first.sourceKind)) a.parsedOnly = true
        }
        attachments.push(a)
      }

      // documents (office/pdf/text) first, then images largest→smallest (signature logos sink)
      const rank = (a: EmailAttachment) =>
        (a.mime?.includes('pdf') || a.text != null || (a.kind != null && OFFICE.has(a.kind)) ? 100_000_000 : 0) + a.sizeBytes
      attachments.sort((x, y) => rank(y) - rank(x))
      return { available: attachments.length > 0, attachments }
    } catch (err) {
      this.log.warn(`attachments lookup unavailable: ${String(err).slice(0, 80)}`)
      return { available: false, attachments: [] }
    }
  }

  /**
   * ONE attachment's original bytes for the download endpoint, resolved the same way getAttachments
   * inlines them: office rawBytes → passthrough image/pdf bytes → the text content as a file.
   * Null when the id is unknown or the original was purged with no text surviving.
   */
  async getAttachmentOriginal(
    attachmentId: string,
  ): Promise<{ filename: string; mime: string; body: Buffer } | null> {
    if (!attachmentId) return null
    const rows = await this.emails.attachmentById(attachmentId)
    const first = rows[0]
    if (!first) return null
    const filename = leafName(first.filename)

    if (first.rawBytes) {
      return { filename, mime: first.declaredMime ?? 'application/octet-stream', body: first.rawBytes }
    }
    const passthrough = rows.find((r) => r.imageBytes)
    if (passthrough?.imageBytes) {
      return {
        filename,
        mime: passthrough.mime ?? first.declaredMime ?? 'application/octet-stream',
        body: passthrough.imageBytes,
      }
    }
    const text = rows.map((r) => r.textContent).filter(Boolean).join('\n\n')
    if (text) return { filename, mime: 'text/plain; charset=utf-8', body: Buffer.from(text, 'utf8') }
    return null
  }
}

/** The real filename to save as — strip the `parent!/` container prefix and any path segments. */
function leafName(filename: string): string {
  const afterContainer = filename.split('!/').pop() ?? filename
  const leaf = afterContainer.split(/[\\/]/).pop() ?? afterContainer
  return leaf || filename
}
