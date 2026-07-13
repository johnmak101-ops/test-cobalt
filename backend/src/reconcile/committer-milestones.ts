/**
 * MilestoneSynchronizer — thin collaborator: rewrite a leg's milestone + email timeline rows from the
 * recon group's events/fields/state. Extracted from CommitterService so apply() stays an orchestrator.
 */
import type { ShipmentRepository } from '../db/repositories/shipment.repository'
import { deriveMilestoneRows, deriveEmailRows } from './milestone-rows'

export class MilestoneSynchronizer {
  constructor(private readonly shipments: ShipmentRepository) {}

  async sync(
    shipmentId: string,
    events: { emailType: string; receivedAt: string; graphId?: string | null }[],
    fields: Record<string, unknown>,
    state: string,
  ): Promise<void> {
    // Related Emails FIRST: it is independent of milestones, and writing it first means a future
    // milestone-write failure (e.g. a milestone_type the CHECK constraint doesn't know) can never again
    // silently drop the shipment↔email link — the exact collateral damage the missing 'SAILED' type caused.
    await this.shipments.replaceEmails(shipmentId, deriveEmailRows(shipmentId, events))
    await this.shipments.replaceMilestones(shipmentId, deriveMilestoneRows(shipmentId, events, fields, state))
  }
}
