import { Injectable, Logger } from '@nestjs/common'
import { GraphService, type OriginalEmail, type GraphAttachment } from './graph.service'
import { EmailRepository } from '../db/repositories/email.repository'

const MOCK_PREFIX = 'mock:'

/** One downloadable attachment in the email window (one entry per FILE — the `ingest` mirror already
 *  stores one row per attachment, so there is no longer a "per parsed part" fan-out to collapse). */
export interface EmailAttachment {
  filename: string
  /** per-sheet/part label — a `queue_normalized` concept the ingest mirror doesn't have; always null */
  label: string | null
  kind: string | null
  mime: string | null
  sizeBytes: number
  /** ORIGINAL bytes, base64 (capped) — from ingest.email_attachment.raw_bytes, else an on-demand Graph fetch */
  base64?: string | null
  /** reserved: a text-native rendering; not populated until a later task re-adds it (e.g. via Graph) */
  text?: string | null
  /** original exists but exceeds the inline cap */
  tooLarge?: boolean
  /** an office binary with no local raw_bytes AND unfetchable from Graph (not configured, no graph ids, or the fetch failed) */
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
   *  1. ingested in track-system's own `ingest` mirror (intra-DB) → return the real subject/sender/body
   *  2. `mock:<file>` not ingested → corpus pointer, no live copy (return the filename)
   *  3. live mailbox via Graph (production), else not configured
   * Never throws — any failure degrades to `available:false` so the UI always renders.
   */
  async getOriginal(messageId: string): Promise<OriginalEmail> {
    if (!messageId) return { available: false, source: 'unconfigured', messageId: '' }

    try {
      const m = await this.emails.findIngested(messageId)
      if (m) {
        const corpus: OriginalEmail = {
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
        const hasBody = !!((m.bodyText && m.bodyText.trim()) || (m.bodyHtml && m.bodyHtml.trim()))
        if (hasBody) return corpus
        // Body absent. A Graph-sourced email (graphId present) with no local body was necessarily nulled
        // by retention — ingest always captures the body, and the original still lives in the mailbox, so
        // re-fetch the FULL body from Graph. Corpus mail (no graphId) has no mailbox copy → genuinely empty.
        const purged = !!m.graphId
        if (m.graphId && this.graph.configured()) {
          try {
            const g = await this.graph.fetchMessage(m.graphId)
            return {
              ...corpus,
              source: 'graph',
              subject: m.subject ?? g.subject,
              from: m.sender ?? g.from,
              bodyPreview: g.bodyPreview,
              bodyText: g.bodyText,
              bodyHtml: g.bodyHtml,
              webLink: g.webLink,
            }
          } catch (err) {
            this.log.warn(`view-original body re-fetch failed for ${messageId}: ${String(err).slice(0, 80)}`)
          }
        }
        // genuinely empty, or purged-but-unfetchable → return what we hold, flagging the purge for the UI
        return { ...corpus, bodyPurged: purged }
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
   * Attachments for the email window — ONE entry per file (the ingest mirror already stores one row
   * per attachment, so there is nothing left to collapse). Every kind is served the same way now:
   * `rawBytes` (when we have it — dev-seed only for now) becomes the downloadable `base64`; failing
   * that, a Graph fetch (see `fetchGraphOriginals`) is tried for anything real mail left unfetched; an
   * office kind (docx/xlsx/doc/rtf) that even Graph can't produce is flagged `parsedOnly` so the UI
   * knows the original isn't available; anything else with no bytes just carries its metadata.
   * Documents float to the top so the meaningful files (B/L, invoice) sit above inline signature logos.
   * Resilient: a DB hiccup degrades to `available:false`.
   */
  async getAttachments(messageId: string): Promise<{ available: boolean; attachments: EmailAttachment[] }> {
    if (!messageId) return { available: false, attachments: [] }
    const MAX_INLINE = 12 * 1024 * 1024 // bytes; base64'd into the JSON response
    const OFFICE = new Set(['docx', 'xlsx', 'doc', 'rtf'])
    try {
      const rows = await this.emails.attachmentsFor(messageId)
      // one memoized Graph round-trip covers every row of this message missing local bytes
      const graphOriginals = await this.fetchGraphOriginals(rows)

      const attachments: EmailAttachment[] = rows.map((r) => {
        const a: EmailAttachment = {
          filename: leafName(r.filename),
          label: null, // no per-part fan-out anymore — one row IS the file
          kind: r.sourceKind,
          mime: r.declaredMime,
          sizeBytes: r.sizeBytes,
        }
        if (r.rawBytes) {
          if (r.rawBytes.length <= MAX_INLINE) a.base64 = r.rawBytes.toString('base64')
          else a.tooLarge = true
          return a
        }
        const g = matchGraphOriginal(graphOriginals, r)
        if (g) {
          a.mime = a.mime ?? g.mime
          if (g.body.length <= MAX_INLINE) a.base64 = g.body.toString('base64')
          else a.tooLarge = true
        } else if (r.sourceKind && OFFICE.has(r.sourceKind)) {
          a.parsedOnly = true
        }
        return a
      })

      // documents (office/pdf) first, then images largest→smallest (signature logos sink)
      const rank = (a: EmailAttachment) =>
        (a.mime?.includes('pdf') || (a.kind != null && OFFICE.has(a.kind)) ? 100_000_000 : 0) + a.sizeBytes
      attachments.sort((x, y) => rank(y) - rank(x))
      return { available: attachments.length > 0, attachments }
    } catch (err) {
      this.log.warn(`attachments lookup unavailable: ${String(err).slice(0, 80)}`)
      return { available: false, attachments: [] }
    }
  }

  /**
   * ONE attachment's original bytes for the download endpoint — local `rawBytes` first, else a Graph
   * fallback fetch matched by `graphAttachmentId`. Null when the id is unknown or neither source has it.
   */
  async getAttachmentOriginal(
    attachmentId: string,
  ): Promise<{ filename: string; mime: string; body: Buffer } | null> {
    if (!attachmentId) return null
    const rows = await this.emails.attachmentById(attachmentId)
    const first = rows[0]
    if (!first) return null
    if (first.rawBytes) {
      return {
        filename: leafName(first.filename),
        mime: first.declaredMime ?? 'application/octet-stream',
        body: first.rawBytes,
      }
    }
    const g = matchGraphOriginal(await this.fetchGraphOriginals([first]), first)
    if (!g) return null
    return {
      filename: leafName(first.filename),
      mime: first.declaredMime ?? g.mime,
      body: g.body,
    }
  }

  /**
   * Graph fallback for attachments with no local `rawBytes` — mirrors how `getOriginal` re-fetches a
   * purged BODY from Graph, but for attachment bytes. Graph has no single-attachment-by-id endpoint
   * cheaper than listing the message's attachments, so this fetches ONCE per call (memoized here, not
   * across calls) for every row that still needs it, and the caller matches back by `graphAttachmentId`.
   * Never throws: absent creds, a transport/auth failure, or an incomplete test double for `graph` all
   * degrade to `[]` so callers fall through to their own parsedOnly/unavailable handling.
   */
  private async fetchGraphOriginals(
    rows: { rawBytes: Buffer | null; graphAttachmentId: string | null; messageGraphId: string | null; filename: string }[],
  ) {
    // graphAttachmentId is absent for attachments ingested via the raw-MIME (mailparser) path — those
    // still need this fetch (matched back by filename, see matchGraphOriginal), so only messageGraphId gates it.
    // messageGraphId is the Graph ITEM id (email_message.graph_id) and is nullable — skip when absent.
    const needsGraph = rows.find((r) => !r.rawBytes && r.messageGraphId)?.messageGraphId
    if (!needsGraph) return []
    try {
      if (!this.graph.configured()) return []
      return await this.graph.fetchAttachments(needsGraph)
    } catch (err) {
      this.log.warn(`attachment Graph fetch failed: ${String(err).slice(0, 80)}`)
      return []
    }
  }
}

/**
 * Match a fetched Graph attachment back to a DB row: prefer the stored `graphAttachmentId` (exact,
 * cheap); fall back to a case-insensitive leaf-filename match for rows ingested via the raw-MIME
 * path, which never had a `graphAttachmentId` to store in the first place.
 */
function matchGraphOriginal(
  originals: GraphAttachment[],
  row: { graphAttachmentId: string | null; filename: string },
): GraphAttachment | undefined {
  if (row.graphAttachmentId) {
    const byId = originals.find((x) => x.graphAttachmentId === row.graphAttachmentId)
    if (byId) return byId
  }
  const leaf = leafName(row.filename).toLowerCase()
  return originals.find((x) => leafName(x.filename).toLowerCase() === leaf)
}

/** The real filename to save as — strip the `parent!/` container prefix and any path segments. */
function leafName(filename: string): string {
  const afterContainer = filename.split('!/').pop() ?? filename
  const leaf = afterContainer.split(/[\\/]/).pop() ?? afterContainer
  return leaf || filename
}
