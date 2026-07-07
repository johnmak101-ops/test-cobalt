/**
 * Email/inbox UI presentation. Read-only projections of the ingested mail (inbox list, attachments,
 * body, thread) plus the read-only email-integration status. Graph credentials are owned by the
 * ingestion service (graph_api) and never persisted here.
 */
import { Injectable, NotFoundException } from '@nestjs/common'
import { EmailRepository } from '../db/repositories/email.repository'
import { toUiEmail } from './mappers/email.mapper'
import { isoOrNull } from './adapters/derive'

// Attachment mime resolution: declared_mime is often the generic octet-stream; infer from the
// filename extension instead so the UI shows real types (PDF/XLS/image) for ~87% that were wrong.
const EXT_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  csv: 'text/csv',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  txt: 'text/plain',
  html: 'text/html',
  eml: 'message/rfc822',
  zip: 'application/zip',
  rtf: 'application/rtf',
}
function resolveMime(declared: string | null | undefined, filename: string | null | undefined): string {
  if (declared && declared !== 'application/octet-stream') return declared
  const ext = (filename ?? '').toLowerCase().split('.').pop() ?? ''
  return EXT_MIME[ext] ?? declared ?? 'application/octet-stream'
}

@Injectable()
export class EmailPresentationService {
  constructor(private readonly emailRepo: EmailRepository) {}

  async emails(limit = 250) {
    // window must cover the whole inbox so the (oldest) review-overlay rows aren't cut off (audit gap 15)
    const rows = await this.emailRepo.listInbox(limit)
    return {
      emails: rows.map((r) =>
        toUiEmail({
          message: {
            id: r.id, graphMessageId: r.graphMessageId, subject: r.subject ?? '', sender: r.sender ?? '',
            receivedAt: r.receivedAt, status: r.status, createdAt: r.createdAt,
          },
          review:
            r.reviewStatus != null || r.emailType != null || r.matchedShipmentId != null
              ? {
                  emailType: r.emailType, extractedData: r.extractedData, extractionConfidence: r.extractionConfidence,
                  reviewStatus: r.reviewStatus, reviewedBy: r.reviewedBy, reviewedAt: r.reviewedAt,
                  reviewNotes: r.reviewNotes,
                  // an email is "matched" when it built a shipment (milestone linkage), not via the
                  // review_email FK (which is null for unmatched review items by definition)
                  shipmentId: r.matchedShipmentId ?? r.shipmentId,
                }
              : null,
          readAt: r.readAt,
        }),
      ),
    }
  }

  async emailAttachments(messageId: string) {
    const rows = await this.emailRepo.attachmentsByMessageId(messageId)
    return {
      attachments: rows.map((a) => ({
        id: a.attachmentId,
        emailId: messageId,
        filename: a.filename,
        mimeType: resolveMime(a.declaredMime, a.filename),
        sizeBytes: a.sizeBytes ?? 0,
        createdAt: a.createdAt instanceof Date ? a.createdAt.toISOString() : String(a.createdAt ?? ''),
      })),
    }
  }

  async emailBody(id: string) {
    const row = await this.emailRepo.emailBody(id)
    if (!row) throw new NotFoundException('email not found')
    return {
      id: row.id,
      subject: row.subject,
      sender: row.sender,
      receivedAt: isoOrNull(row.receivedAt),
      bodyText: row.bodyText ?? null,
      bodyHtml: row.bodyHtml ?? null,
      toRecipients: row.toRecipients ?? null,
      ccRecipients: row.ccRecipients ?? null,
    }
  }

  /** The email's conversation siblings with per-message attachment counts (the window's thread panel). */
  async emailThread(id: string) {
    const rows = await this.emailRepo.thread(id)
    return {
      messages: rows.map((r) => ({
        id: r.id,
        subject: r.subject ?? '',
        sender: r.sender ?? '',
        receivedAt: isoOrNull(r.receivedAt),
        attachmentCount: r.attachmentCount ?? 0,
      })),
    }
  }

  // Inbox read-state lives in the app-owned tracking.email_read table.
  async emailsUnreadCount() {
    return { unread: await this.emailRepo.unreadCount() }
  }
  emailMarkRead(id: string, userId: string | null) {
    return this.emailRepo.markRead(id, userId)
  }

  // ---- email integration (read-only status; credentials live in the ingestion service) ----

  async emailIntegration() {
    const [{ count, lastAt }, st] = await Promise.all([this.emailRepo.ingestionStatus(), this.emailRepo.ingestState()])
    // Real last-sync time = the Graph ingestion watermark; status from the stuck-counter (not count>0).
    const syncDate = (st?.updatedAt ?? st?.watermark ?? lastAt) as Date | string | null
    const iso = syncDate instanceof Date ? syncDate.toISOString() : syncDate ? String(syncDate) : null
    const stuck = (st?.stuckCount ?? 0) > 0
    const mailbox = st?.id ? String(st.id).replace(/^inbox:/, '') : null
    return {
      config: {
        id: 'ingestion',
        tenantId: '',
        clientId: '',
        clientSecret: '',
        _secretMasked: true,
        mailboxEmail: mailbox,
        isActive: !!st || count > 0,
        lastSyncAt: iso,
        lastSyncStatus: st ? (stuck ? 'FAILED' : 'SUCCESS') : count > 0 ? 'SUCCESS' : null,
        lastSyncError: stuck ? `ingestion stuck on message ${st?.stuckGraphId ?? '(unknown)'} (${st?.stuckCount} retries)` : null,
        lastSyncCount: count, // lifetime ingested (queue keeps no per-sync count) — labeled "emails synced"
        createdAt: iso ?? '',
        updatedAt: iso ?? '',
      },
    }
  }
  // Governance: Graph credentials are owned by the ingestion service (graph_api), never persisted here.
  emailIntegrationSave() {
    return this.emailIntegration()
  }
  emailIntegrationTest() {
    return {
      success: true,
      message:
        'Email ingestion runs in the Cobalt ingestion service (graph_api). Credentials are managed there, not in the tracking app.',
      userCount: 0,
    }
  }
  async emailIntegrationSync() {
    const { count } = await this.emailRepo.ingestionStatus()
    return { synced: 0, skipped: count, errors: [] as string[] }
  }
}
