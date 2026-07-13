/**
 * Unlinked-documents UI presentation: Invoice/Billing legs (kind='DOCUMENT', not yet linked to a real
 * shipment) — the Unlinked Documents view, plus the dismiss/link actions. Read-mostly.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { ShipmentRepository } from '../db/repositories/shipment.repository'
import { isoOrNull } from './adapters/derive'

@Injectable()
export class DocumentPresentationService {
  constructor(private readonly shipmentRepo: ShipmentRepository) {}

  /** Orphan documents (kind='DOCUMENT', not yet linked) — the Unlinked Documents view. */
  async documents() {
    const rows = await this.shipmentRepo.documents()
    return {
      documents: rows.map((r) => ({
        id: r.id,
        customer: r.customerName ?? null,
        emailType: r.emailType ?? null,
        senderType: r.senderType ?? null,
        poNumbers: r.poNumbers ?? [],
        poCount: (r.poNumbers ?? []).length,
        qty: r.qty ?? null,
        qtyUnit: r.qtyUnit ?? null,
        receivedAt: isoOrNull(r.receivedAt),
      })),
    }
  }

  /** One unlinked document's detail panel + the queue_message id of its source email (for the pop-up). */
  async document(id: string) {
    const r = await this.shipmentRepo.documentDetail(id)
    if (!r) throw new NotFoundException('document not found')
    return {
      id: r.id,
      customer: r.customerName ?? null,
      emailType: r.emailType ?? null,
      senderType: r.senderType ?? null,
      poNumbers: r.poNumbers ?? [],
      poCount: (r.poNumbers ?? []).length,
      qty: r.qty ?? null,
      qtyUnit: r.qtyUnit ?? null,
      receivedAt: isoOrNull(r.receivedAt),
      emailId: r.emailId ?? null,
    }
  }

  /** Dismiss an unlinked document so it drops off the list (stamps dismissed_at). */
  async dismissDocument(id: string): Promise<{ ok: true }> {
    const kind = await this.shipmentRepo.kindOf(id)
    if (kind == null) throw new NotFoundException('document not found')
    if (kind !== 'DOCUMENT') throw new BadRequestException('not an unlinked document')
    await this.shipmentRepo.dismissDocument(id)
    return { ok: true }
  }

  /** Manually link a document onto a real shipment: fold its POs + emails over and mark it linked. */
  async linkDocument(documentId: string, shipmentId: string): Promise<{ ok: true }> {
    if (!shipmentId) throw new BadRequestException('shipmentId is required')
    const [docKind, targetKind] = await Promise.all([
      this.shipmentRepo.kindOf(documentId),
      this.shipmentRepo.kindOf(shipmentId),
    ])
    if (docKind == null) throw new NotFoundException('document not found')
    if (targetKind == null) throw new NotFoundException('shipment not found')
    if (docKind !== 'DOCUMENT') throw new BadRequestException('source is not an unlinked document')
    await this.shipmentRepo.linkDocument(documentId, shipmentId)
    return { ok: true }
  }
}
