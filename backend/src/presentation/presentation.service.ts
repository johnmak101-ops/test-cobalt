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
import { AlertEvaluatorService } from '../alerts/alert-evaluator.service'
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
import { filterPortMissReasons } from './mappers/port-miss-reasons'
import type { CriticReview } from '../decisions/critic-review.types'
import { isHighBandAutoEligible } from '../decisions/band-routing'
import { toUiAlert } from './mappers/alert.mapper'
import { toUiAlertRule } from './mappers/alert-rule.mapper'
import { SaveAlertRulesDto } from './alert-rules.dto'
import { ALERT_COUNTRY_CODES } from '../alerts/alert-rule-defaults'
import { toUiHistoryEntry } from './mappers/history.mapper'
import { deriveRoute, portLabel, poNumbersJson, isoOrNull } from './adapters/derive'
import { computeFieldConflicts } from './field-conflicts'
import { poQtyIssue, describePoQtyIssue } from '../reconcile/po-qty-consistency'
import { stateToUiStatus } from './adapters/enums'
import { makeTtlCache } from '../common/ttl-cache'
import {
  entityCodeNameMapsFromRefs,
  hydrateCriticEntityLabels,
  resolveEntityCodeDisplay,
} from './hydrate-critic-entity-labels'

// nameCh rides along (repo selectAll) — the mapper's party-mismatch check accepts a Chinese raw.
type Ref = { id: string; code?: string | null; name: string; nameCh?: string | null }
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
  /** shipment_pos.id — present only for shipment-linked POs (absent on the booking fallback); the UI
   *  unlinks a PO from this shipment by this id. */
  linkId?: string | null
}

/** Compact row for Review "Move PO" free-text shipment search (`GET /api/shipments?q=`). */
export type CompactShipmentSearchRow = {
  id: string
  bookingNo: string | null
  soNumber: string | null
  customerName: string | null
  route: string | null
  status: string
  reviewStatus: string | null
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
    /** Beginning email (min shipment_emails.received_at) — rides findByIds rows (#350). */
    firstEmailAt?: Date | string | null
    createdAt?: Date | string | null
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
    // #350: the alert card derives the Shipment ID from these (firstEmailAt ?? createdAt + uuid head).
    firstEmailAt: isoOrNull(leg.firstEmailAt),
    createdAt: isoOrNull(leg.createdAt),
  }
}

// Master data is read-mostly reference data; a master edit becomes visible within this window. Cache tuned
// to sit at/above the 30s UI poll so repeated renders share one built maps object instead of rebuilding 24k
// ports each time. Override with MASTER_MAPS_TTL_MS.
const MASTER_MAPS_TTL_MS = Number(process.env.MASTER_MAPS_TTL_MS ?? 30_000)

const ALERT_COUNTRY_CODE_SET = new Set<string>(ALERT_COUNTRY_CODES)

/** UI days map -> stored hours map. Drops unknown codes and out-of-range values (1-30 days). */
function sanitizeCountryThresholds(
  ct: Record<string, number> | null | undefined,
): Record<string, number> | null {
  if (!ct || typeof ct !== 'object') return null
  const out: Record<string, number> = {}
  for (const [code, days] of Object.entries(ct)) {
    const d = Math.round(Number(days))
    if (ALERT_COUNTRY_CODE_SET.has(code) && Number.isFinite(d) && d >= 1 && d <= 30) out[code] = d * 24
  }
  return Object.keys(out).length > 0 ? out : null
}

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
    private readonly alertEvaluator: AlertEvaluatorService,
  ) {}

  // ---- shared assembly ----

  private readonly mapsCache = makeTtlCache<MasterMaps>(MASTER_MAPS_TTL_MS)
  /** Party masters only (no ports) — detail page needs full party lists for critic code→name hydrate,
   *  but only 0–2 port rows. Cached separately so detail never waits on ~24k ports. */
  private readonly partyMapsCache = makeTtlCache<Omit<MasterMaps, 'ports'>>(MASTER_MAPS_TTL_MS)

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

  private partyMaps(): Promise<Omit<MasterMaps, 'ports'>> {
    return this.partyMapsCache(async () => {
      const [customers, vendors, forwarders] = await Promise.all([
        this.mastersRepo.listCustomers(),
        this.mastersRepo.listVendors(),
        this.mastersRepo.listForwarders(),
      ])
      const byId = <T extends { id: string }>(rows: T[]) => new Map(rows.map((r) => [r.id, r]))
      return {
        customers: byId(customers as Ref[]),
        vendors: byId(vendors as Ref[]),
        forwarders: byId(forwarders as Ref[]),
      }
    })
  }

  /** Detail: party maps + only pol/pod port rows (Kysely select-needed, not full ports catalogue). */
  private async detailMasterMaps(polId?: string | null, podId?: string | null): Promise<MasterMaps> {
    const ids = [polId, podId].filter((x): x is string => !!x)
    const [parties, portRows] = await Promise.all([
      this.partyMaps(),
      this.mastersRepo.portsByIds(ids),
    ])
    return {
      ...parties,
      ports: new Map(portRows.map((r) => [r.id, r as PortRow])),
    }
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
            linkId: p.linkId ?? null,
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

  /**
   * Free-text shipment search for Review "Move PO to another shipment".
   * Compact rows only — booking / SO / HBL / container / linked PO# substring match.
   * Strong-key matcher path stays on GET /shipments?booking_no=… etc.; this is only for `?q=`.
   */
  async searchShipments(opts: { q: string; limit?: number }) {
    const q = (opts.q ?? '').trim()
    if (!q) return { shipments: [] as CompactShipmentSearchRow[] }
    const rawLimit = Number(opts.limit)
    const limit = Math.min(Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : 20, 50)
    const needle = q.toLowerCase()

    const [legs, bookingRows, maps] = await Promise.all([
      this.shipmentRepo.activeLegs(),
      this.bookingRepo.listOrdered(),
      this.masterMaps(),
    ])
    const bookingsById = new Map<string, BookingRow>(bookingRows.map((b: BookingRow) => [b.id, b]))
    const realLegs = legs.filter((leg) => (leg as { kind?: string | null }).kind !== 'DOCUMENT')
    const posByShipment = await this.shipmentRepo.poNumbersByShipment(realLegs.map((l) => l.id))

    const contains = (v: string | null | undefined) =>
      v != null && String(v).toLowerCase().includes(needle)

    const out: CompactShipmentSearchRow[] = []
    for (const leg of realLegs) {
      const poHit = (posByShipment.get(leg.id) ?? []).some((p) => contains(p))
      const fieldHit =
        contains(leg.bookingNo) ||
        contains(leg.soNo) ||
        contains(leg.hblAwbFcrNo) ||
        contains(leg.containerNo)
      if (!fieldHit && !poHit) continue

      const booking = bookingsById.get(leg.bookingId) ?? null
      const customer = booking?.customerId ? maps.customers.get(booking.customerId) : undefined
      const pol = leg.polId ? maps.ports.get(leg.polId) : undefined
      const pod = leg.podId ? maps.ports.get(leg.podId) : undefined
      out.push({
        id: leg.id,
        bookingNo: leg.bookingNo ?? null,
        soNumber: leg.soNo ?? null,
        customerName: customer?.name ?? (leg as { customerRaw?: string | null }).customerRaw ?? null,
        route: deriveRoute(
          portLabel(leg.mode, pol?.unlocode, pol?.iata) ?? leg.polRaw,
          portLabel(leg.mode, pod?.unlocode, pod?.iata) ?? leg.podRaw,
        ),
        status: stateToUiStatus(leg.state, leg.legStatus),
        reviewStatus: leg.reviewStatus ?? null,
      })
      if (out.length >= limit) break
    }
    return { shipments: out }
  }

  async shipments(filter?: { status?: string; customerId?: string; forwarderId?: string }) {
    const [legs, bookingRows, maps] = await Promise.all([
      this.shipmentRepo.activeLegs(),
      this.bookingRepo.listOrdered(),
      this.masterMaps(),
    ])
    const bookingsById = new Map<string, BookingRow>(bookingRows.map((b: BookingRow) => [b.id, b]))
    // #151: leg counts per booking (one pass over the list — no N+1)
    const legCountByBooking = new Map<string, number>()
    const realLegs: typeof legs = []
    for (const leg of legs) {
      if ((leg as { kind?: string | null }).kind === 'DOCUMENT') continue
      legCountByBooking.set(leg.bookingId, (legCountByBooking.get(leg.bookingId) ?? 0) + 1)
      realLegs.push(leg)
    }
    // Bulk PO load — kills sequential await linkedPosForShipment(leg.id) (root cause of ~4s list).
    const legIds = realLegs.map((l) => l.id)
    const posByShipment = await this.shipmentRepo.linkedPosForShipments(legIds)
    const needBookingFallback = new Set<string>()
    for (const leg of realLegs) {
      if (!(posByShipment.get(leg.id)?.length)) needBookingFallback.add(leg.bookingId)
    }
    const posByBooking =
      needBookingFallback.size > 0
        ? await this.shipmentRepo.linkedPosForBookings([...needBookingFallback])
        : new Map<string, LinkedPoRow[]>()

    const out: ReturnType<typeof toUiShipment>[] = []
    for (const leg of realLegs) {
      if (filter?.forwarderId && leg.forwarderId !== filter.forwarderId) continue
      const booking = bookingsById.get(leg.bookingId) ?? null
      if (filter?.customerId && booking?.customerId !== filter.customerId) continue
      // Prefer per-leg POs; fall back to booking union when leg has none (legacy).
      const legPos = (posByShipment.get(leg.id) ?? []) as LinkedPoRow[]
      const linkedPos =
        legPos.length > 0
          ? legPos
          : ((posByBooking.get(leg.bookingId) ?? []) as LinkedPoRow[])
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
    // Detail path: scoped queries only (no full alerts table, no full ports catalogue).
    // linkedPosForShipment already carries legQty/legQtyUnit — do not re-query posFor.
    const [booking, maps, milestones, alertRows, legLinkedPos, relatedEmails, identifiers, siblings] =
      await Promise.all([
        this.bookingRepo.findById(leg.bookingId),
        this.detailMasterMaps(
          (leg as { polId?: string | null }).polId,
          (leg as { podId?: string | null }).podId,
        ),
        this.shipmentRepo.milestonesFor(id),
        this.alertRepo.listForShipment(id),
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
    // linkedPosForShipment selects legQty/legQtyUnit; booking fallback has neither (null shipped).
    const linkedPosWithLeg = linkedPos.map((p) => ({
      ...p,
      legQty: (p as { legQty?: number | null }).legQty ?? null,
      legUnit: (p as { legQtyUnit?: string | null }).legQtyUnit ?? null,
    }))
    // #350: the beginning email anchors the derived Shipment ID. findById stays lean (it also runs
    // inside committer/edit transactions), and the related emails are already loaded here — derive
    // the anchor from them instead of adding a second shipment_emails query.
    const firstEmailAt = relatedEmails.reduce<string | null>((min, e) => {
      const at = e.receivedAt != null ? new Date(e.receivedAt as string | Date).toISOString() : null
      return at != null && (min == null || at < min) ? at : min
    }, null)
    const base = toUiShipment(this.assembleInput({ ...leg, firstEmailAt }, booking, maps, linkedPosWithLeg), {
      legNo: (leg as { legNo?: number | null }).legNo ?? 1,
      legCount: siblings.length,
    })
    const legAlerts = alertRows.map((a) => toUiAlert({ alert: a, shipment: null }))
    // Orphan shipment_emails (email_message wiped): keep a stub so Related Emails is not blank.
    const emails = relatedEmails.map((e) => ({
      id: e.id,
      // The queue attributes a conflict candidate by graphMessageId (it has no access to our uuid
      // PK), so the UI needs this to match a proposed value to the email that stated it.
      graphMessageId: e.graphMessageId ?? null,
      subject: e.subject ?? '(email body not in store)',
      sender: e.sender ?? null,
      receivedAt: isoOrNull(e.receivedAt),
      emailType: e.milestoneType ?? null,
      bodyMissing: e.id == null,
    }))
    // Contested fields (≥2 co-current values for one identity type) — recovered from the identifier set so
    // the review page can highlight them + show "what each email said", even when the gate's reason is a
    // bare count ("N unresolved field conflict(s)") that names no field. Identifiers store the source email
    // as a Graph message-id; resolve it to the internal email id (queue_message.id) the popup opens by, so
    // the "open source" link isn't broken (unresolved → null → shown as plain text).
    const emailIdByGraph = new Map(
      relatedEmails
        .filter((e): e is typeof e & { id: string; graphMessageId: string } => e.id != null && e.graphMessageId != null)
        .map((e) => [e.graphMessageId, e.id]),
    )
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
    // Entity conflict candidates often store Mesh codes (forwarder "058"/"060"); expand to names
    // for the review table. Response-only — stored critic_review keeps codes for matching/learning.
    {
      const codeMaps = entityCodeNameMapsFromRefs(
        maps.forwarders.values(),
        maps.customers.values(),
        maps.vendors.values(),
      )
      criticReview = hydrateCriticEntityLabels(criticReview, codeMaps)
    }
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
    const messageIds = related.map((r) => r.id).filter((id): id is string => id != null)
    const evidence = messageIds.length ? await this.evidenceRepo.forMessages(messageIds) : []
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
    // The detail rows label these fields "Customer/Vendor Code", so their history speaks in codes:
    // any old/new value that resolves to a master (code or exact name) displays as the CODE
    // ("SOUOCE → ROKNFT", not "SOUOCE → ROSE KNITTING FACTORY LIMITED"). Response-time only —
    // audit rows keep the values that were actually written.
    const parties = await this.partyMaps()
    const codeMaps = entityCodeNameMapsFromRefs(
      parties.forwarders.values(),
      parties.customers.values(),
      parties.vendors.values(),
    )
    const codeify = <T extends { field: string | null; oldValue: string | null; newValue: string | null }>(h: T): T =>
      h.field
        ? {
            ...h,
            oldValue: h.oldValue ? resolveEntityCodeDisplay(h.field, h.oldValue, codeMaps) : h.oldValue,
            newValue: h.newValue ? resolveEntityCodeDisplay(h.field, h.newValue, codeMaps) : h.newValue,
          }
        : h
    const history = [...audit, ...emailEntries].sort((a, b) =>
      (b.changedAt ?? '') < (a.changedAt ?? '') ? -1 : 1,
    ).map(codeify)
    return { history }
  }

  // ---- review queue (provisional shipments) ----

  /**
   * The Review Queue: Active (`pending`), Rejected (`dismissed`), or Approved (`approved` confirmed
   * with criticReview). Same customer/route resolution as the shipments() list.
   * High-band auto-eligible legs never surface (Active or Approved) — silent auto-confirm path.
   */
  async reviewQueue(view: 'pending' | 'dismissed' | 'approved' = 'pending') {
    const rows = await this.shipmentRepo.reviewQueue(view)
    const visible = rows.filter(
      (r) => !isHighBandAutoEligible(r.criticReview as CriticReview | null | undefined),
    )
    return {
      shipments: visible.map((r) => ({
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
        reviewReasons: filterPortMissReasons(r.reviewReasons ?? [], {
          polLinked: !!(r as { polId?: string | null }).polId || !!r.polCode,
          podLinked: !!(r as { podId?: string | null }).podId || !!r.podCode,
        }),
        // compact only — never project raw confidence score (sort stays server-side on confidence ASC)
        criticReviewCompact: compactCriticReview(r.criticReview as CriticReview | null | undefined),
        // #350: Shipment ID anchor (beginning email; UI falls back to createdAt)
        firstEmailAt: isoOrNull(r.firstEmailAt),
        createdAt: isoOrNull(r.createdAt),
        updatedAt: isoOrNull(r.updatedAt),
        poCount: r.poCount ?? 0,
        dismissedAt: isoOrNull(r.dismissedAt),
      })),
    }
  }

  /** Nav badge count of provisional shipments awaiting review (+ dismissed for the queue tab). */
  async reviewQueueCounts() {
    // Exclude high-band auto-eligible from Active badge (same filter as reviewQueue pending).
    const [pendingRows, dismissedRows] = await Promise.all([
      this.shipmentRepo.reviewQueue('pending'),
      this.shipmentRepo.reviewQueue('dismissed'),
    ])
    const pending = pendingRows.filter(
      (r) => !isHighBandAutoEligible(r.criticReview as CriticReview | null | undefined),
    ).length
    const dismissed = dismissedRows.filter(
      (r) => !isHighBandAutoEligible(r.criticReview as CriticReview | null | undefined),
    ).length
    return { provisional: pending, dismissed }
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

  /** Persist edited alert rules. The UI works in DAYS; we store HOURS. Locked rules stay immutable
   *  (checked against the SERVER row — the client copy is never trusted). Severity is user-chosen
   *  per rule (single-severity model; the old A1-A4 warn/critical pinning is gone). After save,
   *  re-evaluate every active confirmed leg immediately so new thresholds apply now
   *  (scheduler still re-runs every ~15 minutes as a safety net). */
  async saveAlertRules(input: SaveAlertRulesDto) {
    const existing = new Map((await this.alertRepo.allRules()).map((r) => [r.id, r]))
    for (const r of input?.rules ?? []) {
      const current = existing.get(r.id)
      if (!current || current.locked) continue // retired A2/A4, built-in A7 — never mutate
      const patch: Record<string, unknown> = {}
      if (typeof r.thresholdDays === 'number') patch.thresholdHours = Math.round(r.thresholdDays * 24)
      if (typeof r.severity === 'string') patch.severity = r.severity
      if (typeof r.enabled === 'boolean') patch.enabled = r.enabled
      if (r.countryThresholds !== undefined) {
        // country_thresholds is nvarchar(max) JSON — must stringify for tedious/MSSQL
        // ("Validation failed for parameter … Invalid string" if an object is bound).
        const hoursMap = sanitizeCountryThresholds(r.countryThresholds)
        patch.countryThresholds = hoursMap != null ? JSON.stringify(hoursMap) : null
      }
      await this.alertRepo.updateRule(r.id, patch)

      // Push severity/message onto existing ACTIVE alert rows NOW (do not wait for re-fire).
      // Alerts store a copy of severity at first fire; without this, Settings→Info leaves cards CRITICAL.
      if (r.enabled === false) {
        await this.alertRepo.resolveAllActiveForRule(r.id)
      } else if (typeof patch.severity === 'string') {
        await this.alertRepo.syncActivePresentation(r.id, {
          severity: String(patch.severity),
          message: current.description || current.name || r.id,
        })
      }
    }
    let evalStats: { evaluated: number; fired: number; resolved: number } | null = null
    try {
      evalStats = await this.alertEvaluator.evaluate()
      this.logger.log(
        `alert rules saved — immediate eval evaluated=${evalStats.evaluated} fired=${evalStats.fired} resolved=${evalStats.resolved}`,
      )
    } catch (err) {
      // Thresholds + presentation already persisted; a failed re-eval must not roll back the save.
      this.logger.warn(
        `alert rules saved but immediate eval failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
    const { rules } = await this.alertRules()
    return { rules, eval: evalStats }
  }

  // resetAlertRules removed with POST /alert-rules/reset (2026-07-23) — see UiAlertRulesController.

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
    // Dashboard "Today's Cargo Set Sail" — ATD (or ETD once sailed) on today's calendar day.
    // Not "most recently updated legs", which mixed booking-request noise into the table.
    const recentLegs = legsSailedToday(legs).slice(0, 12)
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

/** States that mean cargo has already left the origin terminal / vessel has sailed. */
const SAILED_OR_BEYOND = new Set(['SAILED', 'RELEASED', 'DELIVERED'])

/** Calendar-day equality in UTC (date columns are stored as midnight UTC date-only). */
export function isSameUtcDay(a: Date | string | null | undefined, b: Date): boolean {
  if (a == null || a === '') return false
  const d = a instanceof Date ? a : new Date(a)
  if (Number.isNaN(d.getTime())) return false
  return (
    d.getUTCFullYear() === b.getUTCFullYear() &&
    d.getUTCMonth() === b.getUTCMonth() &&
    d.getUTCDate() === b.getUTCDate()
  )
}

/**
 * Legs whose cargo set sail today: ATD falls on today, or (ATD missing) ETD is today and the
 * leg is already past the sailed gate. Sorted latest sail first.
 */
export function legsSailedToday<T extends { atd?: Date | string | null; etd?: Date | string | null; state?: string | null }>(
  legs: T[],
  now: Date = new Date(),
): T[] {
  const match = legs.filter((leg) => {
    if (isSameUtcDay(leg.atd ?? null, now)) return true
    if (isSameUtcDay(leg.etd ?? null, now) && SAILED_OR_BEYOND.has(leg.state ?? '')) return true
    return false
  })
  return match.sort((a, b) => {
    const ta = new Date((a.atd ?? a.etd) as Date | string).getTime()
    const tb = new Date((b.atd ?? b.etd) as Date | string).getTime()
    return (Number.isNaN(tb) ? 0 : tb) - (Number.isNaN(ta) ? 0 : ta)
  })
}
