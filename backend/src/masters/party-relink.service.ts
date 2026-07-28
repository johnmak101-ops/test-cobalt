import { Injectable, Logger } from '@nestjs/common'
import { ShipmentRepository } from '../db/repositories/shipment.repository'
import { BookingRepository } from '../db/repositories/booking.repository'
import { MastersRepository } from '../db/repositories/masters.repository'
import { AuditRepository } from '../db/repositories/audit.repository'

export interface RelinkSummary {
  scanned: number
  linked: { forwarder: number; vendor: number; customer: number }
}

/**
 * Fill party master FKs that a raw name already answers EXACTLY.
 *
 * The situation this ends: a leg stores `vendor_raw = "MACAU FUNG TAI LIMITED"`, Mesh holds a vendor
 * named "MACAU FUNG TAI LIMITED", and `bookings.vendor_id` is NULL — so the shipment page prints the
 * raw name in amber under "in Mesh, not linked — edit the field and pick it", asking an operator to
 * retype a string that is already character-for-character identical. The review desk cannot help
 * either: it deliberately refuses to make a conflict row out of one candidate spelled exactly like
 * the stored value, because a row has to present a CHOICE, and there is none here.
 *
 * There is none here because this is a LOOKUP, not a judgement — which is why doing it automatically
 * does not breach the de-correction principle. Nothing the agent read is being second-guessed and no
 * VALUE moves: the raw name is left exactly as parsed, and only a null foreign key is filled with
 * the single master that name unambiguously identifies. `*Exact` is the same resolver the human edit
 * path (`applyHumanFieldWrite`) and the confirm path (`reResolveBookingParties`) already call; the
 * gap was purely one of timing, since those only run when someone touches the leg.
 *
 * Timing is the whole bug. Masters mirror from Mesh on a daily sync and run months behind, so the
 * commit that created the leg genuinely had no master to link. When one arrives later, nothing
 * re-asks the question — the leg keeps an advice line describing a miss that has since been fixed.
 * So this runs right after a successful sync, against the rows the sync may just have unblocked.
 *
 * Ambiguity is left alone by construction: `*Exact` returns a master only for an unambiguous exact
 * hit, and anything fuzzy stays the LLM matcher's and the operator's problem.
 */
@Injectable()
export class PartyRelinkService {
  private readonly log = new Logger(PartyRelinkService.name)

  constructor(
    private readonly shipments: ShipmentRepository,
    private readonly bookings: BookingRepository,
    private readonly masters: MastersRepository,
    private readonly audit: AuditRepository,
  ) {}

  async relinkAll(): Promise<RelinkSummary> {
    const rows = await this.shipments.legsWithUnlinkedRawParties()
    const linked = { forwarder: 0, vendor: 0, customer: 0 }

    for (const row of rows) {
      const forwarderRaw = String(row.forwarderRaw ?? '').trim()
      if (forwarderRaw && row.forwarderId == null) {
        const id = await this.masters.forwarderIdExact(forwarderRaw)
        if (id) {
          await this.shipments.updateLeg(row.id, { forwarderId: id })
          await this.writeAudit(row.id, 'forwarderId', id, forwarderRaw)
          linked.forwarder++
        }
      }

      /**
       * Customer and vendor hang off the BOOKING, so one patch object per booking — two separate
       * `bookings.update` calls would make the second overwrite nothing but still cost a round trip,
       * and a leg routinely names both.
       */
      const bookingPatch: Record<string, unknown> = {}
      const vendorRaw = String(row.vendorRaw ?? '').trim()
      if (vendorRaw && row.bookingVendorId == null) {
        const id = await this.masters.vendorIdExact(vendorRaw)
        if (id) {
          bookingPatch.vendorId = id
          await this.writeAudit(row.id, 'vendorId', id, vendorRaw)
          linked.vendor++
        }
      }
      const customerRaw = String(row.customerRaw ?? '').trim()
      if (customerRaw && row.bookingCustomerId == null) {
        const id = await this.masters.customerIdExact(customerRaw)
        if (id) {
          bookingPatch.customerId = id
          await this.writeAudit(row.id, 'customerId', id, customerRaw)
          linked.customer++
        }
      }
      if (Object.keys(bookingPatch).length && row.bookingId) {
        await this.bookings.update(String(row.bookingId), bookingPatch)
      }
    }

    const total = linked.forwarder + linked.vendor + linked.customer
    if (total > 0) {
      this.log.log(
        `party re-link: ${total} master link(s) filled from exact raw names ` +
          `(forwarder=${linked.forwarder} vendor=${linked.vendor} customer=${linked.customer}) across ${rows.length} candidate leg(s)`,
      )
    }
    return { scanned: rows.length, linked }
  }

  /**
   * An FK moving with no trace is exactly the class of change the stale-master-FK work was about —
   * display prefers the master over the raw twin, so this silently changes what the shipment page
   * PRINTS. `actorUserId` is null because no human did it; the note names the raw value that
   * resolved, so the row reads as the lookup it is.
   */
  private async writeAudit(shipmentId: string, field: string, newValue: string, raw: string) {
    await this.audit.write({
      entityType: 'shipment',
      entityId: shipmentId,
      field,
      oldValue: null,
      newValue,
      changeType: 'update',
      sourceType: 'system',
      actorUserId: null,
      note: `master auto-linked from exact raw name "${raw}" after Mesh sync`,
    })
  }
}
