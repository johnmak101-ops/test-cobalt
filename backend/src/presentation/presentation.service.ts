/**
 * UI presentation/adapter service: orchestrates the existing (DB-verified) repositories and the
 * pure mappers to produce the flat shapes the new UI expects. Read-only. Adds no new model concepts —
 * one UI "shipment" = one ACTIVE leg + its booking, projected flat.
 */
import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { ShipmentRepository } from '../db/repositories/shipment.repository'
import { BookingRepository } from '../db/repositories/booking.repository'
import { MastersRepository } from '../db/repositories/masters.repository'
import { AlertRepository } from '../db/repositories/alert.repository'
import { AuditRepository } from '../db/repositories/audit.repository'
import { EmailRepository } from '../db/repositories/email.repository'
import { EvidenceRepository } from '../db/repositories/evidence.repository'
import { ShipmentsService } from '../shipments/shipments.service'
import {
  buildMatchAmbiguityFromCandidates,
  dedupeReviewReasons,
  lookupQueryFromLeg,
  needsMatchAmbiguityHydration,
  stripStaleAmbiguousSignals,
  withMatchAmbiguity,
} from '../shipments/match-ambiguity-hydrate'
import { emailFieldTimeline, dedupeAgainstAudit } from './adapters/email-timeline'
import {
  compactCriticReview,
  toUiShipment,
  type ShipmentMapperInput,
  type ShipmentLegRow,
} from './mappers/shipment.mapper'
import type { CriticReview } from '../decisions/critic-review.types'
import { toUiAlert } from './mappers/alert.mapper'
import { toUiAlertRule } from './mappers/alert-rule.mapper'
import { toUiHistoryEntry } from './mappers/history.mapper'
import { deriveRoute, portLabel, poNumbersJson, isoOrNull } from './adapters/derive'
import { computeFieldConflicts } from './field-conflicts'
import { poQtyIssue, describePoQtyIssue } from '../reconcile/po-qty-consistency'
import { stateToUiStatus } from './adapters/enums'
import { makeTtlCache } from '../common/ttl-cache'

type Ref = { id: string; code?: string | null; name: string }
type PortRow = { id: string; unlocode?: string | null; country?: string | null; iata?: string | null }
type BookingRow = { id: string; customerId: string | null; vendorId: string | null }
type LinkedPoRow = {
  id: string
  poNumber: string
  totalQuantity: number | null
  quantityUnit: string | null
  itemStyleNo?: string | null
  brand?: string | null
  vendorName: string | null
}

interface MasterMaps {
  customers: Map<string, Ref>
  vendors: Map<string, Ref>
  forwarders: Map<string, Ref>
  ports: Map<string, PortRow>
}

/** Dedupe PO numbers by case-insensitive trim; first-seen order wins (stable). */
export function mergePoNumbers(...sources: string[][]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const src of sources) {
    for (const raw of src) {
      const t = (raw ?? '').trim()
      if (!t) continue
      const key = t.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(t)
    }
  }
  return out
}

/** Pure per-shipment summary (id + PO JSON + route + customer + consignee) from preloaded rows + master maps — the
 *  batch-friendly core of the old per-alert shipmentSummary(). No I/O.
 *  `poNumbers` should already be booking_pos ∪ shipment_pos (caller merges). */
export function buildShipmentSummary(
  leg: {
    id: string
    bookingId: string
    mode: string | null
    polId: string | null
    podId: string | null
    consigneeName?: string | null
  },
  booking: { customerId: string | null } | null,
  poNumbers: string[],
  maps: MasterMaps,
) {
  const customer = booking?.customerId ? maps.customers.get(booking.customerId) : undefined
  const pol = leg.polId ? maps.ports.get(leg.polId) : undefined
  const pod = leg.podId ? maps.ports.get(leg.podId) : undefined
  const consignee = (leg.consigneeName ?? '').trim()
  return {
    id: leg.id,
    poNumbers: poNumbersJson(poNumbers),
    route: deriveRoute(portLabel(leg.mode, pol?.unlocode, pol?.iata), portLabel(leg.mode, pod?.unlocode, pod?.iata)),
    customer: customer ? { name: customer.name } : null,
    consigneeName: consignee || null,
  }
}

// Master data is read-mostly reference data; a master edit becomes visible within this window. Cache tuned
// to sit at/above the 30s UI poll so repeated renders share one built maps object instead of rebuilding 24k
// ports each time. Override with MASTER_MAPS_TTL_MS.
const MASTER_MAPS_TTL_MS = Number(process.env.MASTER_MAPS_TTL_MS ?? 30_000)

@Injectable()
export class PresentationService {
  private readonly logger = new Logger(PresentationService.name)

  constructor(
    private readonly shipmentRepo: ShipmentRepository,
    private readonly bookingRepo: BookingRepository,
    private readonly mastersRepo: MastersRepository,
    private readonly alertRepo: AlertRepository,
    private readonly auditRepo: AuditRepository,
    private readonly emailRepo: EmailRepository,
    private readonly evidenceRepo: EvidenceRepository,
    private readonly shipmentsLookup: ShipmentsService,
  ) {}

  // ---- shared assembly ----

  private readonly mapsCache = makeTtlCache<MasterMaps>(MASTER_MAPS_TTL_MS)

  private masterMaps(): Promise<MasterMaps> {
    // Master data — especially the ~24,768-row ports table — is read-mostly reference data, but it was
    // rebuilt on EVERY list / detail / alerts / dashboard render (the dashboard + tracker poll every 30s
    // per open tab). Cache the built maps for MASTER_MAPS_TTL_MS so those calls share ONE build instead of
    // re-querying + re-Mapping 24k ports each time; concurrent misses share one in-flight build.
    return this.mapsCache(async () => {
      const [customers, vendors, forwarders, ports] = await Promise.all([
        this.mastersRepo.listCustomers(),
        this.mastersRepo.listVendors(),
        this.mastersRepo.listForwarders(),
        this.mastersRepo.listPorts(),
      ])
      const byId = <T extends { id: string }>(rows: T[]) => new Map(rows.map((r) => [r.id, r]))
      return {
        customers: byId(customers as Ref[]),
        vendors: byId(vendors as Ref[]),
        forwarders: byId(forwarders as Ref[]),
        ports: byId(ports as PortRow[]),
      }
    })
  }

  private assembleInput(
    leg: ShipmentLegRow & { bookingId: string; polId?: string | null; podId?: string | null },
    booking: BookingRow | null,
    maps: MasterMaps,
    linkedPos: (LinkedPoRow & { legQty?: number | null; legUnit?: string | null })[],
  ): ShipmentMapperInput {
    const customer = booking?.customerId ? maps.customers.get(booking.customerId) : undefined
    const vendor = booking?.vendorId ? maps.vendors.get(booking.vendorId) : undefined
    const forwarder = leg.forwarderId ? maps.forwarders.get(leg.forwarderId) : undefined
    return {
      leg,
      booking: booking ? { customerId: booking.customerId, vendorId: booking.vendorId } : null,
      customer: customer ? { id: customer.id, name: customer.name, code: customer.code ?? null } : null,
      vendor: vendor ? { id: vendor.id, name: vendor.name, code: vendor.code ?? null } : null,
      forwarder: forwarder ? { id: forwarder.id, name: forwarder.name, code: forwarder.code ?? null } : null,
      polPort: leg.polId ? maps.ports.get(leg.polId) ?? null : null,
      podPort: leg.podId ? maps.ports.get(leg.podId) ?? null : null,
      poNumbers: linkedPos.map((p) => p.poNumber),
      linkedPOs: (() => {
        // When ≥3 POs all show the same total and none have a per-leg shipped split, that total is a
        // booking-level broadcast (not per-PO order qty) — UI must not present it as each PO's total.
        const totals = linkedPos.map((p) => p.totalQuantity).filter((t): t is number => t != null)
        const sharedBroadcast =
          linkedPos.length >= 3 &&
          totals.length === linkedPos.length &&
          new Set(totals).size === 1 &&
          linkedPos.every((p) => p.legQty == null)
        const sharedTotal = sharedBroadcast ? totals[0]! : null
        return linkedPos.map((p) => {
          const quantity = p.legQty ?? null // per-leg shipped qty from shipment_pos (null when the split is unknown)
          // Compare the attributed shipped qty against the ERP order (total + unit) — flag an impossible
          // over-attribution (shipped > ordered) or a unit mismatch so the UI can surface it.
          const poTotal = sharedBroadcast ? null : p.totalQuantity ?? null
          const ctx = { legQty: quantity, legUnit: p.legUnit ?? null, poTotal, poUnit: p.quantityUnit ?? null }
          const issue = poQtyIssue(ctx)
          return {
            id: p.id,
            poNumber: p.poNumber,
            totalQuantity: poTotal,
            quantityUnit: p.quantityUnit ?? p.legUnit ?? leg.qtyUnit ?? null,
            quantity,
            itemStyleNo: p.itemStyleNo ?? null,
            brand: p.brand ?? null,
            qtyIssue: issue,
            qtyIssueDetail: issue ? describePoQtyIssue(issue, ctx) : null,
            vendor: p.vendorName ? { name: p.vendorName } : null,
            // same on every row when set — UI shows one banner, not a fake per-PO total
            sharedBroadcastTotal: sharedTotal,
            sharedBroadcastUnit: sharedTotal != null ? (p.quantityUnit ?? leg.qtyUnit ?? null) : null,
          }
        })
      })(),
    }
  }

  /** Summaries for many shipmentIds in bulk queries (legs + bookings + booking_pos ∪ shipment_pos) instead of
   *  N+1 per alert. Returns id -> summary; a missing id → caller uses null. */
  private async shipmentSummariesByIds(shipmentIds: string[], maps: MasterMaps) {
    const ids = [...new Set(shipmentIds)]
    const legs = await this.shipmentRepo.findByIds(ids)
    const bookingIds = [...legs.values()].map((l) => l.bookingId)
    const [bookingsById, posByBooking, posByShipment] = await Promise.all([
      this.bookingRepo.findByIds(bookingIds),
      this.bookingRepo.poNumbersByBooking(bookingIds),
      this.shipmentRepo.poNumbersByShipment(ids),
    ])
    const out = new Map<string, ReturnType<typeof buildShipmentSummary>>()
    for (const [id, leg] of legs) {
      const poNumbers = mergePoNumbers(posByBooking.get(leg.bookingId) ?? [], posByShipment.get(id) ?? [])
      out.set(id, buildShipmentSummary(leg, bookingsById.get(leg.bookingId) ?? null, poNumbers, maps))
    }
    return out
  }

  // ---- shipments ----

  async shipments(filter?: { status?: string; customerId?: string; forwarderId?: string }) {
    const [legs, bookingRows, maps] = await Promise.all([
      this.shipmentRepo.activeLegs(),
      this.bookingRepo.listOrdered(),
      this.masterMaps(),
    ])
    const bookingsById = new Map<string, BookingRow>(bookingRows.map((b: BookingRow) => [b.id, b]))
    // #151: leg counts per booking (one pass over the list — no N+1)
    const legCountByBooking = new Map<string, number>()
    for (const leg of legs) {
      if ((leg as { kind?: string | null }).kind === 'DOCUMENT') continue
      legCountByBooking.set(leg.bookingId, (legCountByBooking.get(leg.bookingId) ?? 0) + 1)
    }
    const poCache = new Map<string, LinkedPoRow[]>()
    const out: ReturnType<typeof toUiShipment>[] = []
    for (const leg of legs) {
      // Only REAL shipments belong on the tracker; DOCUMENT legs live in the Unlinked Documents view.
      // (null-kind is treated as SHIPMENT defensively, for rows predating the split.)
      if ((leg as { kind?: string | null }).kind === 'DOCUMENT') continue
      if (filter?.forwarderId && leg.forwarderId !== filter.forwarderId) continue
      const booking = bookingsById.get(leg.bookingId) ?? null
      if (filter?.customerId && booking?.customerId !== filter.customerId) continue
      // Prefer per-leg POs; fall back to booking union when leg has none (legacy).
      let linkedPos = (await this.shipmentRepo.linkedPosForShipment(leg.id)) as LinkedPoRow[]
      if (!linkedPos.length) {
        let bookingPos = poCache.get(leg.bookingId)
        if (!bookingPos) {
          bookingPos = (await this.shipmentRepo.linkedPosForBooking(leg.bookingId)) as LinkedPoRow[]
          poCache.set(leg.bookingId, bookingPos)
        }
        linkedPos = bookingPos
      }
      const ui = toUiShipment(
        this.assembleInput(leg, booking, maps, linkedPos),
        {
          legNo: (leg as { legNo?: number | null }).legNo ?? 1,
          legCount: legCountByBooking.get(leg.bookingId) ?? 1,
        },
      )
      if (filter?.status && ui.status !== filter.status) continue
      out.push(ui)
    }
    return { shipments: out }
  }

  async shipment(id: string) {
    const leg = await this.shipmentRepo.findById(id)
    if (!leg) throw new NotFoundException('shipment not found')
    const [booking, maps, milestones, alertRows, legLinkedPos, relatedEmails, identifiers, siblings] =
      await Promise.all([
        this.bookingRepo.findById(leg.bookingId),
        this.masterMaps(),
        this.shipmentRepo.milestonesFor(id),
        this.alertRepo.list(),
        this.shipmentRepo.linkedPosForShipment(id) as Promise<LinkedPoRow[]>,
        this.emailRepo.emailsForShipment(id),
        this.shipmentRepo.identifiersFor(id),
        this.shipmentRepo.legsForBooking(leg.bookingId),
      ])
    // #151: per-leg shipment_pos first; booking_pos only when the leg has no PO links (legacy).
    const linkedPos =
      legLinkedPos.length > 0
        ? legLinkedPos
        : ((await this.shipmentRepo.linkedPosForBooking(leg.bookingId)) as LinkedPoRow[])
    // per-leg shipped qty/unit lives in shipment_pos — attach it so the PO table shows Shipped/UOM
    const legPos = await this.shipmentRepo.posFor(id)
    const legPosMap = new Map(legPos.map((x) => [x.poId, x]))
    const linkedPosWithLeg = linkedPos.map((p) => ({
      ...p,
      legQty: legPosMap.get(p.id)?.quantity ?? (p as { legQty?: number | null }).legQty ?? null,
      legUnit: legPosMap.get(p.id)?.quantityUnit ?? (p as { legQtyUnit?: string | null }).legQtyUnit ?? null,
    }))
    const base = toUiShipment(this.assembleInput(leg, booking, maps, linkedPosWithLeg), {
      legNo: (leg as { legNo?: number | null }).legNo ?? 1,
      legCount: siblings.length,
    })
    const legAlerts = alertRows.filter((a) => a.shipmentId === id).map((a) => toUiAlert({ alert: a, shipment: null }))
    const emails = relatedEmails.map((e) => ({
      id: e.id,
      subject: e.subject,
      sender: e.sender,
      receivedAt: isoOrNull(e.receivedAt),
      emailType: e.milestoneType ?? null,
    }))
    // Contested fields (≥2 co-current values for one identity type) — recovered from the identifier set so
    // the review page can highlight them + show "what each email said", even when the gate's reason is a
    // bare count ("N unresolved field conflict(s)") that names no field. Identifiers store the source email
    // as a Graph message-id; resolve it to the internal email id (queue_message.id) the popup opens by, so
    // the "open source" link isn't broken (unresolved → null → shown as plain text).
    const emailIdByGraph = new Map(relatedEmails.map((e) => [e.graphMessageId, e.id]))
    const fieldConflicts = computeFieldConflicts(identifiers, (graphId) => emailIdByGraph.get(graphId ?? '') ?? null)

    // #129 next stage: hydrate closed-set matchAmbiguity when critic says multi-hit but cards are missing
    let criticReview = (base.criticReview ?? null) as CriticReview | null
    let reviewReasons = dedupeReviewReasons(
      Array.isArray(base.reviewReasons)
        ? (base.reviewReasons as string[])
        : base.reviewReasons
          ? [String(base.reviewReasons)]
          : [],
    )
    if (needsMatchAmbiguityHydration(criticReview, reviewReasons)) {
      try {
        const posNums = linkedPosWithLeg.map((p) => p.poNumber).filter(Boolean)
        const q = lookupQueryFromLeg({
          bookingNo: leg.bookingNo,
          soNo: leg.soNo,
          hblAwbFcrNo: leg.hblAwbFcrNo,
          mbl: leg.mbl,
          containerNo: leg.containerNo,
          matchKeys: (leg.matchKeys ?? null) as Record<string, unknown> | null,
          pos: posNums,
        })
        const { candidates } = await this.shipmentsLookup.lookupByMatchKey(q)
        const ma = buildMatchAmbiguityFromCandidates(q, candidates ?? [])
        if (ma) {
          criticReview = withMatchAmbiguity(criticReview, ma)
          // Persist so list/queue and next open get cards without re-lookup (best-effort)
          void this.shipmentRepo
            .updateLeg(id, { criticReview, reviewReasons: reviewReasons.length ? reviewReasons : null })
            .catch((err: unknown) =>
              this.logger.warn(
                `matchAmbiguity hydrate persist failed: ${err instanceof Error ? err.message : String(err)}`,
              ),
            )
        } else {
          // Live lookup no longer multi-hits — strip stale multi signals from the response
          const stripped = stripStaleAmbiguousSignals(criticReview, reviewReasons)
          criticReview = stripped.criticReview
          reviewReasons = stripped.reviewReasons
          void this.shipmentRepo
            .updateLeg(id, {
              criticReview,
              reviewReasons: reviewReasons.length ? reviewReasons : null,
            })
            .catch((err: unknown) =>
              this.logger.warn(
                `stale ambiguous strip persist failed: ${err instanceof Error ? err.message : String(err)}`,
              ),
            )
        }
      } catch (err) {
        this.logger.warn(
          `matchAmbiguity hydrate failed: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }

    return {
      ...base,
      criticReview,
      reviewReasons,
      milestones,
      emails,
      alerts: legAlerts,
      fieldConflicts,
    }
  }

  /**
   * Change History = real audit rows (creates, review corrections, manual edits, live-mode amends)
   * MERGED with a per-email field replay reconstructed from parsed evidence. Batch commits collapse a
   * whole thread into one create, so without the replay a shipment built from 8 emails shows a single
   * entry. Synthesized entries are deduped against audit rows (live-mode amends record the same change).
   */
  async shipmentHistory(id: string) {
    const [rows, related, leg] = await Promise.all([
      this.auditRepo.listForEntity('shipment', id),
      this.emailRepo.emailsForShipment(id),
      this.shipmentRepo.findById(id),
    ])
    const evidence = related.length
      ? await this.evidenceRepo.forMessages(related.map((r) => r.id))
      : []
    const emailEntries = dedupeAgainstAudit(
      emailFieldTimeline(
        evidence.map((e) => ({
          messageId: e.messageId,
          subject: e.subject ?? null,
          sender: e.sender ?? null,
          receivedAt: e.receivedAt,
          fields: (e.fields as Record<string, unknown>) ?? null,
        })),
        // a multi-booking email's sibling records must not speak for THIS shipment
        leg
          ? {
              bookingNo: (leg as { bookingNo?: string | null }).bookingNo,
              soNo: (leg as { soNo?: string | null }).soNo,
              hblAwbFcrNo: (leg as { hblAwbFcrNo?: string | null }).hblAwbFcrNo,
              mbl: (leg as { mbl?: string | null }).mbl,
              containerNo: (leg as { containerNo?: string | null }).containerNo,
            }
          : undefined,
      ),
      rows.map((r) => ({ field: r.field, newValue: r.newValue })),
    ).map((c, i) => ({
      id: `email-${c.messageId}-${c.field}-${i}`,
      shipmentId: id,
      field: c.field,
      oldValue: c.oldValue,
      newValue: c.newValue,
      sourceType: 'email',
      sourceId: c.messageId,
      changedBy: null,
      changedAt: c.changedAt,
      isDelay: false,
      notes: c.subject ? `${c.subject}`.slice(0, 140) : null,
    }))
    const audit = rows.map(toUiHistoryEntry)
    const history = [...audit, ...emailEntries].sort((a, b) =>
      (b.changedAt ?? '') < (a.changedAt ?? '') ? -1 : 1,
    )
    return { history }
  }

  // ---- review queue (provisional shipments) ----

  /**
   * The Review Queue: Active (`pending`), Rejected (`dismissed`), or Approved (`approved` confirmed
   * with criticReview). Same customer/route resolution as the shipments() list.
   */
  async reviewQueue(view: 'pending' | 'dismissed' | 'approved' = 'pending') {
    const rows = await this.shipmentRepo.reviewQueue(view)
    return {
      shipments: rows.map((r) => ({
        id: r.id,
        bookingNo: r.bookingNo ?? null,
        soNo: r.soNo ?? null,
        // strings (not objects) — the review-queue table renders these directly; an object here crashes React
        customer: r.customerName ?? null,
        forwarder: r.forwarderName ?? r.forwarderRaw ?? null,
        route: deriveRoute(
          portLabel(r.mode, r.polCode, r.polIata) ?? r.polRaw,
          portLabel(r.mode, r.podCode, r.podIata) ?? r.podRaw,
        ),
        state: r.state,
        status: stateToUiStatus(r.state, r.legStatus),
        reviewReasons: r.reviewReasons ?? [],
        // compact only — never project raw confidence score (sort stays server-side on confidence ASC)
        criticReviewCompact: compactCriticReview(r.criticReview as CriticReview | null | undefined),
        createdAt: isoOrNull(r.createdAt),
        updatedAt: isoOrNull(r.updatedAt),
        poCount: r.poCount ?? 0,
        dismissedAt: isoOrNull(r.dismissedAt),
      })),
    }
  }

  /** Nav badge count of provisional shipments awaiting review (+ dismissed for the queue tab). */
  async reviewQueueCounts() {
    const c = await this.shipmentRepo.reviewQueueCounts()
    return { provisional: c.pending, dismissed: c.dismissed }
  }

  /** Human "approve": accept a provisional shipment as-is (review_status → confirmed). */
  async confirmShipment(id: string): Promise<{ ok: true }> {
    const leg = await this.shipmentRepo.findById(id)
    if (!leg) throw new NotFoundException('shipment not found')
    await this.shipmentRepo.updateLeg(id, { reviewStatus: 'confirmed', reviewedAt: new Date() })
    return { ok: true }
  }

  // ---- alerts ----

  async alerts(status?: string) {
    const [rows, maps] = await Promise.all([this.alertRepo.list(status), this.masterMaps()])
    const summaries = await this.shipmentSummariesByIds(
      rows.map((a) => a.shipmentId).filter((x): x is string => !!x),
      maps,
    )
    const out = rows.map((a) => toUiAlert({ alert: a, shipment: a.shipmentId ? summaries.get(a.shipmentId) ?? null : null }))
    return { alerts: out }
  }

  async alertRules() {
    const rows = await this.alertRepo.allRules()
    return { rules: rows.map(toUiAlertRule) }
  }

  /** Persist edited alert rules. The UI works in DAYS; we store HOURS. Locked rules stay immutable. */
  async saveAlertRules(input: { rules?: Array<Record<string, unknown>> }) {
    for (const r of input?.rules ?? []) {
      if (r.locked) continue // A3 etc. are locked — never mutate
      const id = String(r.id ?? '')
      if (!id) continue
      const patch: Record<string, unknown> = {}
      if (typeof r.thresholdDays === 'number') patch.thresholdHours = Math.round(r.thresholdDays * 24)
      if (typeof r.severity === 'string') patch.severity = r.severity
      if (typeof r.enabled === 'boolean') patch.enabled = r.enabled
      const raw = r.countryThresholds
      const ct = typeof raw === 'string' ? (raw ? JSON.parse(raw) : null) : (raw ?? null)
      patch.countryThresholds =
        ct && typeof ct === 'object' && Object.keys(ct as object).length > 0
          ? Object.fromEntries(
              Object.entries(ct as Record<string, unknown>).map(([k, d]) => [k, Math.round(Number(d) * 24)]),
            )
          : null
      await this.alertRepo.updateRule(id, patch)
    }
    return this.alertRules()
  }

  // ---- dashboard ----

  async dashboard() {
    // newEmails = inbox unread (email_message with no email_read row) — same source as Sidebar/Inbox badge.
    // Do NOT use review_email NEEDS_REVIEW: the matcher→decisions path never writes that legacy table.
    const [legs, activeAlerts, maps, bookingRows, unreadEmails] = await Promise.all([
      this.shipmentRepo.activeLegs(),
      this.alertRepo.list('ACTIVE'),
      this.masterMaps(),
      this.bookingRepo.listOrdered(),
      this.emailRepo.unreadCount(),
    ])
    // active-shipments stats exclude cancelled legs (they still appear in the tracker list, shown as
    // Cancelled, but must not inflate the active count).
    const nonDelivered = legs.filter((l) => l.state !== 'DELIVERED' && (l as { legStatus?: string | null }).legStatus !== 'CANCELLED')
    // KPI pair = ACTIVE alerts by severity (not shipment riskLevel). atRiskShipments deleted.
    const stats = {
      activeShipments: nonDelivered.length,
      warningAlerts: activeAlerts.filter((a) => a.severity === 'WARNING').length,
      criticalAlerts: activeAlerts.filter((a) => a.severity === 'CRITICAL').length,
      newEmails: unreadEmails,
    }

    const recentAlertRows = activeAlerts.slice(0, 5)
    const recentSummaries = await this.shipmentSummariesByIds(
      recentAlertRows.map((a) => a.shipmentId).filter((x): x is string => !!x),
      maps,
    )
    const recentAlerts = recentAlertRows.map((a) =>
      toUiAlert({ alert: a, shipment: a.shipmentId ? recentSummaries.get(a.shipmentId) ?? null : null }),
    )

    const bookingsById = new Map<string, BookingRow>(bookingRows.map((b: BookingRow) => [b.id, b]))
    const recentLegs = [...legs]
      .sort((a, b) => new Date(b.updatedAt as Date).getTime() - new Date(a.updatedAt as Date).getTime())
      .slice(0, 8)
    const recentActivity: ReturnType<typeof toUiShipment>[] = []
    for (const leg of recentLegs) {
      const booking = bookingsById.get(leg.bookingId) ?? null
      // must use the rich linkedPos (id/vendor/qty), not poNumbersFor (string[]) — the flat
      // assembleInput expects LinkedPoRow[]; passing strings broke recent-activity poNumbers/linkedPOs.
      const linkedPos = (await this.shipmentRepo.linkedPosForBooking(leg.bookingId)) as LinkedPoRow[]
      recentActivity.push(toUiShipment(this.assembleInput(leg, booking, maps, linkedPos)))
    }

    return { stats, recentAlerts, recentActivity }
  }
}
