import { Inject, Injectable } from '@nestjs/common'
import { sql, type Kysely, type Expression, type SqlBool } from 'kysely'
import type { DB } from '../kysely/db'
import { KYSELY } from '../kysely.provider'
import type { SHIPMENT_STATE } from '../enums'

/** Minimal query-builder surface shared by Kysely<DB> and a Transaction<DB> — lets the link helper
 *  upsert rows on either the main connection or inside a tx. */
type DbLike = Pick<Kysely<DB>, 'selectFrom' | 'insertInto' | 'updateTable' | 'deleteFrom'>

/** Insert/patch shape for a shipment leg row. */
export type ShipmentInsert = Partial<{
  bookingId: string
  legNo: number
  kind: string
  linkedShipmentId: string | null
  dismissedAt: Date | null
  mode: string | null
  state: string
  legStatus: string
  supersededById: string | null
  riskLevel: string
  reviewStatus: string
  confidence: number | null
  reviewReasons: string | null
  reviewedBy: string | null
  reviewedAt: Date | null
  confirmedByEmail: boolean
  forwarderId: string | null
  forwarderRaw: string | null
  customerRaw: string | null
  consigneeId: string | null
  bookingNo: string | null
  soNo: string | null
  hblAwbFcrNo: string | null
  mbl: string | null
  containerNo: string | null
  vesselName: string | null
  voyageNo: string | null
  scacCode: string | null
  flightNo: string | null
  mawb: string | null
  polId: string | null
  podId: string | null
  polRaw: string | null
  podRaw: string | null
  originCountry: string | null
  cargoReadyDate: Date | null
  cfsCutoff: Date | null
  warehouseStartDate: Date | null
  warehouseEndDate: Date | null
  etd: Date | null
  atd: Date | null
  eta: Date | null
  ata: Date | null
  inDcDate: Date | null
  qty: number | null
  qtyUnit: string | null
  grossWeight: number | null
  netWeight: number | null
  cargoDescription: string | null
  measurement: number | null
  htsCode: string | null
  itemStyleNo: string | null
  consigneeName: string | null
  consigneeAddress: string | null
  matchKeys: Record<string, unknown> | null
  committerAction: string | null
  committerTargetLegId: string | null
  committerCandidatesConsidered: number | null
}>

/** Kysely/SQL Server port of ShipmentRepository. The Shipment aggregate: shipments, shipment_pos,
 *  shipment_milestones, shipment_emails, shipment_identifiers, shipment_parties.
 *
 *  Postgres → MSSQL notes:
 *  - `returning` → `OUTPUT` (.output/.outputAll).
 *  - `onConflictDoNothing` → check-then-insert (the (shipment,po) / (shipment,graph_id) unique keys).
 *  - `count(*)::int` / `array_agg` / `string_agg` → count(*) (number cast) / STRING_AGG.
 *  - Postgres-qualified `tracking.` / `ingest.` schema refs → unqualified (one `dbo` schema in T-SQL).
 *  - `order by … nulls last` → `case when x is null then 1 else 0 end` ascending tiebreak (SQL Server
 *    puts NULLs first in ASC; we push them last explicitly).
 *  - `poNumbers` (Postgres `text[]`) → STRING_AGG(',') split in TS (the consumer treats it as string[]).
 *  - `updateLeg` / `dismissDocument` / `linkPo` returns are not read by callers (verified) — return void/null. */
@Injectable()
export class ShipmentRepository {
  constructor(@Inject(KYSELY) private readonly db: Kysely<DB>) {}

  allLegs() {
    return this.db.selectFrom('shipments').selectAll().execute()
  }

  /**
   * The indexed CANDIDATE SUPERSET for `findExistingLeg` — replaces the `allLegs()` full-scan on the common
   * (identified) commit path. Returns every leg that could match the group by either:
   *   - a STRONG key: a `shipment_match_keys` (type,value) row in `strongPairs` (the 0003 index); OR
   *   - a SHARED PO: its booking links a `purchase_orders` row whose `po_number_norm` ∈ `posNorm` (0004 index).
   * Both halves use the SAME normalization + source as `findExistingLeg`, so each is a superset of its match
   * branch → running the pure `findExistingLeg` over this set yields the identical result to running it over
   * `allLegs()` whenever the group carries a strong key or a PO. (The zero-identity `conversationId` fallback
   * is NOT covered here — the caller keeps `allLegs()` for that rare branch.) `selectAll()` → same shape as
   * `allLegs()`. Returns [] when the group has neither strong keys nor POs (caller shouldn't call it then).
   */
  candidateLegs(strongPairs: { type: string; value: string }[], posNorm: string[]) {
    if (!strongPairs.length && !posNorm.length) return Promise.resolve([])
    // Linked husks (folded into another leg) must not poison matching: lookup + committer
    // both use this set. Do NOT filter dismissedAt — portal-echo dismissed legs still match
    // so re-ingest does not mint duplicates (#146).
    return this.db
      .selectFrom('shipments')
      .selectAll()
      .where('linkedShipmentId', 'is', null)
      .where((eb) => {
        const ors: Expression<SqlBool>[] = []
        if (strongPairs.length) {
          const keyed = eb
            .selectFrom('shipmentMatchKeys')
            .select('shipmentId')
            .where((eb2) => eb2.or(strongPairs.map((p) => eb2.and([eb2('type', '=', p.type), eb2('value', '=', p.value)]))))
          ors.push(eb('id', 'in', keyed))
        }
        if (posNorm.length) {
          const sharedPo = eb
            .selectFrom('bookingPos')
            .innerJoin('purchaseOrders', 'bookingPos.poId', 'purchaseOrders.id')
            .select('bookingPos.bookingId')
            .where('purchaseOrders.poNumberNorm', 'in', posNorm)
          ors.push(eb('bookingId', 'in', sharedPo))
        }
        return eb.or(ors)
      })
      .execute()
  }

  /** Live legs of one email thread — the adoption candidate set (A2's index can't cover this:
   *  a zero-identity leg has no strong keys, so it only exists in match_keys JSON). */
  legsByConversationId(conversationId: string) {
    return this.db
      .selectFrom('shipments')
      .selectAll()
      .where(sql<boolean>`JSON_VALUE(match_keys, '$.conversation_id') = ${conversationId}`)
      .execute()
  }

  /**
   * Legs for the tracker/dashboard: ACTIVE plus CANCELLED.
   * SUPERSEDED and dismissed husks are hidden (review ruled "not trackable").
   */
  activeLegs() {
    return this.db
      .selectFrom('shipments')
      .where('legStatus', 'in', ['ACTIVE', 'CANCELLED'])
      .where('dismissedAt', 'is', null)
      .selectAll()
      .select(ShipmentRepository.receivedAtMinExpr().as('firstEmailAt'))
      .execute()
  }
  /** Active AND confirmed — provisional (low-confidence) legs are excluded from alerts/automation. */
  activeConfirmedLegs() {
    return this.db
      .selectFrom('shipments')
      .where('legStatus', '=', 'ACTIVE')
      .where('reviewStatus', '=', 'confirmed')
      .selectAll()
      .execute()
  }

  /**
   * Alert candidates: confirmed legs, PLUS the provisional ones the desk auto-cleared.
   *
   * An auto-cleared leg is deliberately never written to `confirmed` — it is filtered from the desk
   * and recomputed on every read, so a later email that puts a real conflict on it brings it straight
   * back (see presentation/auto-clear.ts). The cost was that it stayed `provisional` forever and
   * `activeConfirmedLegs` therefore hid it from alerts: a shipment nobody had to review was also a
   * shipment nobody would be warned about.
   *
   * So the query widens to both states and the CALLER decides, using the same auto-clear verdict the
   * queue uses. Provisional legs that genuinely await a human are still excluded — the reason
   * `activeConfirmedLegs` exists is that automation must not act on unreviewed data.
   */
  activeLegsForAlerts() {
    return this.db
      .selectFrom('shipments')
      .where('legStatus', '=', 'ACTIVE')
      .where('reviewStatus', 'in', ['confirmed', 'provisional'])
      .where('dismissedAt', 'is', null)
      .selectAll()
      .execute()
  }
  /**
   * Candidates for the periodic state refresh: live SHIPMENT legs that are not already terminal.
   *
   * Unlike `activeConfirmedLegs` this does NOT require reviewStatus='confirmed' — a provisional leg's
   * lifecycle is just as real, and its badge/timeline go just as stale. It is a derivation from the
   * leg's own dates, not an automation acting on it. DELIVERED is excluded because nothing outranks
   * it, and superseded/linked husks because they are no longer the leg anyone reads.
   */
  legsForStateRefresh() {
    return this.db
      .selectFrom('shipments')
      .where('legStatus', '=', 'ACTIVE')
      .where('kind', '=', 'SHIPMENT')
      .where('supersededById', 'is', null)
      .where('linkedShipmentId', 'is', null)
      .where('state', '!=', 'DELIVERED')
      .selectAll()
      .execute()
  }

  /** Recorded email TYPES per shipment (shipment_emails) — the evidence half of deriveState. */
  async emailTypesForShipments(shipmentIds: string[]): Promise<Map<string, Set<string>>> {
    const byShipment = new Map<string, Set<string>>()
    if (!shipmentIds.length) return byShipment
    const rows = await this.db
      .selectFrom('shipmentEmails')
      .select(['shipmentId', 'emailType'])
      .where('shipmentId', 'in', shipmentIds)
      .execute()
    for (const r of rows) {
      if (!r.emailType) continue
      const set = byShipment.get(r.shipmentId) ?? new Set<string>()
      set.add(r.emailType)
      byShipment.set(r.shipmentId, set)
    }
    return byShipment
  }

  /** Move a leg's lifecycle state. The caller owns the promote-only rule (see StateRefreshService). */
  async setState(id: string, state: (typeof SHIPMENT_STATE)[number]): Promise<void> {
    await this.db
      .updateTable('shipments')
      .set({ state, updatedAt: new Date() })
      .where('id', '=', id)
      .execute()
  }

  /** Provisional legs awaiting human review (lowest confidence first). Dismissed rows are excluded —
   *  a human already ruled "not a trackable shipment" (see reviewQueue views). */
  /**
   * Legs carrying a raw party name whose master link is still null — the input to the post-Mesh-sync
   * re-link sweep (PartyRelinkService).
   *
   * The forwarder FK lives on the leg and the customer/vendor FKs on the booking, which is why this
   * has to join: "unlinked" is not answerable from the shipments row alone.
   */
  legsWithUnlinkedRawParties() {
    return this.db
      .selectFrom('shipments')
      .innerJoin('bookings', 'shipments.bookingId', 'bookings.id')
      .where('shipments.kind', '=', 'SHIPMENT')
      .where((eb) =>
        eb.or([
          eb.and([eb('shipments.forwarderRaw', 'is not', null), eb('shipments.forwarderId', 'is', null)]),
          eb.and([eb('shipments.vendorRaw', 'is not', null), eb('bookings.vendorId', 'is', null)]),
          eb.and([eb('shipments.customerRaw', 'is not', null), eb('bookings.customerId', 'is', null)]),
        ]),
      )
      .select([
        'shipments.id as id',
        'shipments.bookingId as bookingId',
        'shipments.forwarderRaw as forwarderRaw',
        'shipments.forwarderId as forwarderId',
        'shipments.vendorRaw as vendorRaw',
        'shipments.customerRaw as customerRaw',
        'bookings.vendorId as bookingVendorId',
        'bookings.customerId as bookingCustomerId',
      ])
      .execute()
  }

  provisionalLegs() {
    return this.db
      .selectFrom('shipments')
      .where('reviewStatus', '=', 'provisional')
      .where('dismissedAt', 'is', null)
      .orderBy('confidence', 'asc')
      .selectAll()
      .execute()
  }

  /**
   * The shipment-based Review Queue — kind='SHIPMENT', not SUPERSEDED, enriched with booking customer /
   * forwarder / route / po-count.
   * - `pending` (default): provisional, not dismissed; lowest confidence first
   * - `dismissed`: provisional, dismissed only
   * - `approved`: confirmed legs that still carry criticReview (history); reviewedAt desc, then confidence asc
   */
  reviewQueue(view: 'pending' | 'dismissed' | 'approved' | 'waiting' = 'pending') {
    const base = this.db
      .selectFrom('shipments')
      .innerJoin('bookings', 'shipments.bookingId', 'bookings.id')
      .leftJoin('customers', 'bookings.customerId', 'customers.id')
      // The party masters the raw twins are checked against — the queue has to spot a stale link for
      // itself, or a leg whose only open question is one would be auto-cleared off the desk while its
      // detail page still asked it.
      .leftJoin('vendors', 'bookings.vendorId', 'vendors.id')
      .leftJoin('forwarders', 'shipments.forwarderId', 'forwarders.id')
      .leftJoin('ports as pol', 'shipments.polId', 'pol.id')
      .leftJoin('ports as pod', 'shipments.podId', 'pod.id')
      .where('shipments.kind', '=', 'SHIPMENT')
      .where('shipments.legStatus', '<>', 'SUPERSEDED')

    const selectCols = [
      'shipments.id as id', 'shipments.bookingNo as bookingNo', 'shipments.soNo as soNo', 'shipments.state as state',
      'shipments.legStatus as legStatus', 'shipments.reviewReasons as reviewReasons', 'shipments.confidence as confidence',
      'shipments.createdAt as createdAt', 'shipments.updatedAt as updatedAt', 'shipments.dismissedAt as dismissedAt',
      'shipments.waitingAt as waitingAt', 'shipments.waitingReason as waitingReason',
      // Columns openDecisions() compares the critic's proposals against — without them every conflict
      // reads as unsettled on the queue list.
      'shipments.bookingNo as legBookingNo', 'shipments.soNo as legSoNo',
      'shipments.hblAwbFcrNo as hblAwbFcrNo', 'shipments.mbl as mbl', 'shipments.containerNo as containerNo',
      'shipments.scacCode as scacCode', 'shipments.vesselName as vesselName', 'shipments.voyageNo as voyageNo',
      'shipments.consigneeName as consigneeName', 'shipments.consigneeAddress as consigneeAddress',
      'shipments.qty as qty', 'shipments.qtyUnit as qtyUnit',
      'shipments.cargoReadyDate as cargoReadyDate', 'shipments.cfsCutoff as cfsCutoff',
      'shipments.etd as etd', 'shipments.atd as atd', 'shipments.eta as eta', 'shipments.ata as ata',
      'shipments.warehouseStartDate as warehouseStartDate', 'shipments.warehouseEndDate as warehouseEndDate',
      'shipments.inDcDate as inDcDate', 'shipments.customerRaw as customerRaw',
      'shipments.vendorRaw as vendorRaw', 'shipments.flightNo as flightNo', 'shipments.mawb as mawb',
      'shipments.committerAction as committerAction',
      'shipments.committerCandidatesConsidered as committerCandidatesConsidered',
      'shipments.criticReview as criticReview',
      'customers.id as customerId', 'customers.name as customerName',
      'customers.code as customerCode', 'customers.nameCh as customerNameCh',
      // partyMismatch compares the raw twin against code / name / nameCh before claiming a divergence.
      'vendors.id as vendorId', 'vendors.name as vendorName',
      'vendors.code as vendorCode', 'vendors.nameCh as vendorNameCh',
      'forwarders.id as forwarderId', 'forwarders.name as forwarderName',
      'shipments.forwarderRaw as forwarderRaw', 'shipments.mode as mode', 'pol.unlocode as polCode', 'pod.unlocode as podCode',
        'shipments.journey as journey',
      'pol.iata as polIata', 'pod.iata as podIata', 'shipments.polRaw as polRaw', 'shipments.podRaw as podRaw',
      sql<number>`(select count(*) from booking_pos bp where bp.booking_id = ${sql.ref('shipments.bookingId')})`.as('poCount'),
      // #350: beginning email — anchors the derived Shipment ID the queue's first column shows
      ShipmentRepository.receivedAtMinExpr().as('firstEmailAt'),
    ] as const

    if (view === 'approved') {
      // Prefer legs with criticReview so Approved is a useful resolved-history tab (not every confirmed leg).
      return base
        .where('shipments.reviewStatus', '=', 'confirmed')
        .where('shipments.criticReview', 'is not', null)
        .orderBy('shipments.reviewedAt', 'desc')
        .orderBy('shipments.confidence', 'asc')
        .select(selectCols)
        .execute()
    }

    if (view === 'waiting') {
      // Parked legs, oldest park first: the one waiting longest is the one whose answer is overdue.
      return base
        .where('shipments.reviewStatus', '=', 'provisional')
        .where('shipments.dismissedAt', 'is', null)
        .where('shipments.waitingAt', 'is not', null)
        .orderBy('shipments.waitingAt', 'asc')
        .select(selectCols)
        .execute()
    }

    return base
      .where('shipments.reviewStatus', '=', 'provisional')
      .where('shipments.dismissedAt', view === 'dismissed' ? 'is not' : 'is', null)
      // Waiting legs are parked OFF the active desk — the whole point of parking them. Dismissed keeps
      // showing them: a leg can be parked and then rejected, and the Rejected tab must not lose it.
      .$if(view === 'pending', (qb) => qb.where('shipments.waitingAt', 'is', null))
      .orderBy('shipments.confidence', 'asc')
      .orderBy('shipments.createdAt', 'desc')
      .select(selectCols)
      .execute()
  }

  /** Pending / waiting / dismissed provisional counts — nav badge reads pending; the queue tabs read all three.
   *  `pending` excludes parked legs so the badge matches what the Active tab actually lists. */
  async reviewQueueCounts(): Promise<{ pending: number; dismissed: number; waiting: number }> {
    const row = await this.db
      .selectFrom('shipments')
      .where('kind', '=', 'SHIPMENT')
      .where('reviewStatus', '=', 'provisional')
      .where('legStatus', '<>', 'SUPERSEDED')
      .select([
        sql<number>`sum(case when dismissed_at is null and waiting_at is null then 1 else 0 end)`.as('pending'),
        sql<number>`sum(case when dismissed_at is not null then 1 else 0 end)`.as('dismissed'),
        sql<number>`sum(case when dismissed_at is null and waiting_at is not null then 1 else 0 end)`.as('waiting'),
      ])
      .executeTakeFirst()
    return {
      pending: Number(row?.pending ?? 0),
      dismissed: Number(row?.dismissed ?? 0),
      waiting: Number(row?.waiting ?? 0),
    }
  }

  legsForBooking(bookingId: string) {
    return this.db.selectFrom('shipments').where('bookingId', '=', bookingId).orderBy('legNo', 'asc').selectAll().execute()
  }

  /** Lean by design — this also runs inside committer/edit transactions, so no shipment_emails
   *  subquery here (it widens lock interleavings). List/alert reads carry firstEmailAt via
   *  activeLegs()/findByIds(); the detail derives it from its already-loaded related emails (#350). */
  async findById(id: string) {
    const row = await this.db.selectFrom('shipments').where('id', '=', id).selectAll().executeTakeFirst()
    return row ?? null
  }

  /** Fetch many legs in ONE query (id -> leg) — replaces per-item findById in read loops (alert
   *  summaries). Unlike findById it carries firstEmailAt (the beginning email) so alert summaries can
   *  anchor the derived Shipment ID (#350) — these are pure reads, never inside a write transaction. */
  async findByIds(ids: string[]) {
    const rows = ids.length
      ? await this.db
          .selectFrom('shipments')
          .where('id', 'in', ids)
          .selectAll()
          .select(ShipmentRepository.receivedAtMinExpr().as('firstEmailAt'))
          .execute()
      : []
    return new Map(rows.map((s) => [s.id, s] as const))
  }

  /** matchKeys + reviewReasons + criticReview are JSON nvarchar(max) columns — stringify when present
   *  (callers pass raw objects/arrays like they did to Drizzle jsonb; tedious rejects non-strings). */
  private jsonifyLegColumns(values: Record<string, unknown>): Record<string, unknown> {
    const payload: Record<string, unknown> = { ...values }
    for (const k of ['matchKeys', 'reviewReasons', 'criticReview']) {
      if (k in payload) payload[k] = payload[k] != null ? JSON.stringify(payload[k]) : null
    }
    return payload
  }

  async insertLeg(values: Record<string, unknown>) {
    const payload = this.jsonifyLegColumns(values)
    if (!('matchKeys' in payload)) payload.matchKeys = null
    const row = await this.db
      .insertInto('shipments')
      .values(payload as never)
      .outputAll('inserted')
      .executeTakeFirstOrThrow()
    return row
  }

  async updateLeg(id: string, patch: Record<string, unknown>) {
    const row = await this.db
      .updateTable('shipments')
      .set({ ...this.jsonifyLegColumns(patch), updatedAt: new Date() })
      .where('id', '=', id)
      .outputAll('inserted')
      .executeTakeFirst()
    return row ?? null
  }

  /**
   * Active legs enriched with booking + customer + forwarder + route, for the Shipment Tracker list.
   * Dismissed provisional husks stay out of the list (review ruled "not trackable"); matching still
   * sees them via candidateLegs so re-ingest does not mint duplicates.
   */
  legsForTracker(status?: string) {
    let q = this.db
      .selectFrom('shipments')
      .innerJoin('bookings', 'shipments.bookingId', 'bookings.id')
      .leftJoin('customers', 'bookings.customerId', 'customers.id')
      .leftJoin('forwarders', 'shipments.forwarderId', 'forwarders.id')
      .leftJoin('ports as pol', 'shipments.polId', 'pol.id')
      .leftJoin('ports as pod', 'shipments.podId', 'pod.id')
      .where('shipments.legStatus', '=', 'ACTIVE')
      .where('shipments.dismissedAt', 'is', null)
      .orderBy('shipments.updatedAt', 'desc')
      .select([
        'shipments.id as id', 'shipments.bookingId as bookingId', 'bookings.jobNo as jobNo',
        'shipments.bookingNo as bookingNo', 'shipments.soNo as soNo', 'shipments.hblAwbFcrNo as hblAwbFcrNo',
        'shipments.mbl as mbl', 'shipments.containerNo as containerNo', 'shipments.mode as mode',
        'shipments.state as status', 'shipments.riskLevel as riskLevel', 'shipments.reviewStatus as reviewStatus',
        'shipments.confidence as confidence', 'shipments.etd as etd', 'shipments.eta as eta',
        'shipments.updatedAt as updatedAt', 'customers.id as customerId', 'customers.name as customerName',
        'customers.code as customerCode', 'forwarders.id as forwarderId', 'forwarders.name as forwarderName',
        'shipments.forwarderRaw as forwarderRaw', 'pol.unlocode as polCode', 'pod.unlocode as podCode',
        'pol.iata as polIata', 'pod.iata as podIata', 'shipments.polRaw as polRaw', 'shipments.podRaw as podRaw',
      ])
    if (status) q = q.where('shipments.state', '=', status as (typeof SHIPMENT_STATE)[number])
    return q.execute()
  }

  /** One leg enriched like the tracker list (customer / forwarder / route) — any legStatus, for the detail page. */
  async legDetailById(id: string) {
    const row = await this.db
      .selectFrom('shipments')
      .innerJoin('bookings', 'shipments.bookingId', 'bookings.id')
      .leftJoin('customers', 'bookings.customerId', 'customers.id')
      .leftJoin('forwarders', 'shipments.forwarderId', 'forwarders.id')
      .leftJoin('ports as pol', 'shipments.polId', 'pol.id')
      .leftJoin('ports as pod', 'shipments.podId', 'pod.id')
      .where('shipments.id', '=', id)
      .select([
        'shipments.id as id', 'shipments.bookingId as bookingId', 'bookings.jobNo as jobNo',
        'shipments.bookingNo as bookingNo', 'shipments.soNo as soNo', 'shipments.hblAwbFcrNo as hblAwbFcrNo',
        'shipments.mbl as mbl', 'shipments.containerNo as containerNo', 'shipments.mode as mode',
        'shipments.state as state', 'shipments.legStatus as legStatus', 'shipments.riskLevel as riskLevel',
        'shipments.reviewStatus as reviewStatus', 'shipments.confidence as confidence',
        'shipments.reviewReasons as reviewReasons', 'shipments.etd as etd', 'shipments.atd as atd',
        'shipments.eta as eta', 'shipments.updatedAt as updatedAt', 'customers.id as customerId',
        'customers.name as customerName', 'customers.code as customerCode', 'forwarders.id as forwarderId',
        'forwarders.name as forwarderName', 'shipments.forwarderRaw as forwarderRaw',
        'pol.unlocode as polCode', 'pod.unlocode as podCode', 'pol.iata as polIata', 'pod.iata as podIata',
        'shipments.polRaw as polRaw', 'shipments.podRaw as podRaw',
      ])
      .executeTakeFirst()
    return row ?? null
  }

  /** A booking's POs (number + vendor + qty) — the expandable child rows on a shipment. */
  linkedPosForBooking(bookingId: string) {
    return this.db
      .selectFrom('bookingPos')
      .innerJoin('purchaseOrders', 'bookingPos.poId', 'purchaseOrders.id')
      .leftJoin('vendors', 'purchaseOrders.vendorId', 'vendors.id')
      .where('bookingPos.bookingId', '=', bookingId)
      .select([
        'purchaseOrders.id as id', 'purchaseOrders.poNumber as poNumber',
        'purchaseOrders.totalQuantity as totalQuantity', 'purchaseOrders.quantityUnit as quantityUnit',
        'purchaseOrders.itemStyleNo as itemStyleNo', 'purchaseOrders.brand as brand',
        'vendors.name as vendorName',
      ])
      .execute()
  }

  /** Per-leg PO links via shipment_pos (same shape as linkedPosForBooking). #151: detail must not
   *  show every booking PO on every sibling leg. */
  linkedPosForShipment(shipmentId: string) {
    return this.db
      .selectFrom('shipmentPos')
      .innerJoin('purchaseOrders', 'shipmentPos.poId', 'purchaseOrders.id')
      .leftJoin('vendors', 'purchaseOrders.vendorId', 'vendors.id')
      .where('shipmentPos.shipmentId', '=', shipmentId)
      .select([
        'purchaseOrders.id as id', 'purchaseOrders.poNumber as poNumber',
        'purchaseOrders.totalQuantity as totalQuantity', 'purchaseOrders.quantityUnit as quantityUnit',
        'purchaseOrders.itemStyleNo as itemStyleNo', 'purchaseOrders.brand as brand',
        'vendors.name as vendorName',
        'shipmentPos.id as linkId', 'shipmentPos.quantity as legQty', 'shipmentPos.quantityUnit as legQtyUnit',
        'shipmentPos.inferred as inferred',
      ])
      .execute()
  }

  /** Drop a PO link by its shipment_pos id — the displacement half of the claim-strength rule (0029).
   *  Only ever called for a link stored `inferred = 1`; a stated link is never removed automatically. */
  async unlinkPoById(linkId: string) {
    await this.db.deleteFrom('shipmentPos').where('id', '=', linkId).execute()
  }

  /**
   * Bulk form of linkedPosForShipment — ONE query for the tracker list.
   * Root cause of ~4s GET /shipments: sequential per-leg linkedPosForShipment in a for-loop.
   */
  async linkedPosForShipments(
    shipmentIds: string[],
  ): Promise<
    Map<
      string,
      Awaited<ReturnType<ShipmentRepository['linkedPosForShipment']>>
    >
  > {
    const map = new Map<string, Awaited<ReturnType<ShipmentRepository['linkedPosForShipment']>>>()
    if (!shipmentIds.length) return map
    const rows = await this.db
      .selectFrom('shipmentPos')
      .innerJoin('purchaseOrders', 'shipmentPos.poId', 'purchaseOrders.id')
      .leftJoin('vendors', 'purchaseOrders.vendorId', 'vendors.id')
      .where('shipmentPos.shipmentId', 'in', shipmentIds)
      .select([
        'shipmentPos.shipmentId as shipmentId',
        'purchaseOrders.id as id',
        'purchaseOrders.poNumber as poNumber',
        'purchaseOrders.totalQuantity as totalQuantity',
        'purchaseOrders.quantityUnit as quantityUnit',
        'purchaseOrders.itemStyleNo as itemStyleNo',
        'purchaseOrders.brand as brand',
        'vendors.name as vendorName',
        'shipmentPos.id as linkId',
        'shipmentPos.quantity as legQty',
        'shipmentPos.quantityUnit as legQtyUnit',
        'shipmentPos.inferred as inferred',
      ])
      .execute()
    for (const r of rows) {
      const { shipmentId, ...rest } = r
      const arr = map.get(shipmentId)
      if (arr) arr.push(rest)
      else map.set(shipmentId, [rest])
    }
    return map
  }

  /**
   * The OTHER legs that carry any of this leg's POs — the reference behind "this PO is already on
   * another shipment".
   *
   * That review reason was prose with nothing under it: the desk knew a PO was shared but could not
   * name where, so the operator had no way to tell a cross-mode split from a mis-link, and the card
   * fell back to offering PO editing. One self-join answers it, and carries the fields the judgement
   * actually needs — mode, ETD/ATD and the sibling's own shipped quantity.
   *
   * REJECTED siblings are excluded. A dismissed leg is not a competing claim on the cargo — if every
   * other holder of a PO has been rejected then this leg IS the only shipment for it, and there is
   * nothing to confirm. Leaving them in produced the worst version of this panel: leg 256BB7D0 raised
   * "7 POs are also on other shipments" where all seven pointed at the SAME rejected header-row leg
   * (`PO # :`), i.e. seven alarms about a row someone had already thrown away.
   */
  /**
   * The same rows for a WHOLE PAGE of the queue, in one round trip.
   *
   * The review queue renders the full card per row, so it needs the shared-PO block too — without it
   * the card asked "is the order split, or is this the wrong shipment?", flagged itself `needs
   * answer`, and offered no control, because the evidence and the answers only existed on the detail
   * payload. Calling `poSiblingLegs` per row would have put an N+1 back into a service that had all
   * of them removed, so the page's ids go in together and the caller groups the result.
   */
  poSiblingLegsFor(shipmentIds: string[]) {
    if (shipmentIds.length === 0) return Promise.resolve([])
    return this.db
      .selectFrom('shipmentPos as mine')
      .innerJoin('shipmentPos as theirs', (join) =>
        join.onRef('theirs.poId', '=', 'mine.poId').onRef('theirs.shipmentId', '!=', 'mine.shipmentId'),
      )
      .innerJoin('purchaseOrders', 'purchaseOrders.id', 'mine.poId')
      .innerJoin('shipments', 'shipments.id', 'theirs.shipmentId')
      .where('mine.shipmentId', 'in', shipmentIds)
      .where('shipments.kind', '=', 'SHIPMENT')
      .where('shipments.dismissedAt', 'is', null)
      .select([
        // Which of the requested legs this sibling belongs to — the grouping key.
        'mine.shipmentId as ownerShipmentId',
        'purchaseOrders.poNumber as poNumber',
        'shipments.id as shipmentId',
        'shipments.bookingNo as bookingNo',
        'shipments.soNo as soNo',
        'shipments.hblAwbFcrNo as hblAwbFcrNo',
        'shipments.mode as mode',
        'shipments.etd as etd',
        'shipments.atd as atd',
        'shipments.state as state',
        'shipments.legNo as legNo',
        'shipments.dismissedAt as dismissedAt',
        'shipments.reviewStatus as reviewStatus',
        'shipments.qty as legQty',
        'shipments.qtyUnit as legQtyUnit',
        'shipments.createdAt as shipmentCreatedAt',
        sql<Date | null>`(select min(se.received_at) from shipment_emails se where se.shipment_id = shipments.id)`.as(
          'firstEmailAt',
        ),
      ])
      .execute()
  }

  poSiblingLegs(shipmentId: string) {
    return this.db
      .selectFrom('shipmentPos as mine')
      .innerJoin('shipmentPos as theirs', (join) =>
        join
          .onRef('theirs.poId', '=', 'mine.poId')
          .on('theirs.shipmentId', '!=', shipmentId),
      )
      .innerJoin('purchaseOrders', 'purchaseOrders.id', 'mine.poId')
      .innerJoin('shipments', 'shipments.id', 'theirs.shipmentId')
      .where('mine.shipmentId', '=', shipmentId)
      .where('shipments.kind', '=', 'SHIPMENT')
      .where('shipments.dismissedAt', 'is', null)
      .select([
        'purchaseOrders.poNumber as poNumber',
        'shipments.id as shipmentId',
        'shipments.bookingNo as bookingNo',
        'shipments.soNo as soNo',
        'shipments.hblAwbFcrNo as hblAwbFcrNo',
        'shipments.mode as mode',
        'shipments.etd as etd',
        'shipments.atd as atd',
        'shipments.state as state',
        'shipments.legNo as legNo',
        'shipments.dismissedAt as dismissedAt',
        'shipments.reviewStatus as reviewStatus',
        /**
         * The sibling's OWN cargo total — the number its detail page prints as
         * "shipment total N <unit>". Not `theirs.quantity`: the shipment_pos link carries the PO's
         * ordered unit, which routinely disagrees with what the leg shipped ("unit differs: shipped
         * in cartons, ordered in pieces"), and the panel would then state a shipment's cargo in a
         * unit no other screen uses.
         */
        'shipments.qty as legQty',
        'shipments.qtyUnit as legQtyUnit',
        // #350/#354 anchors for the derived Shipment ID — a leg is NAMED by that, not by its booking
        // number, and the desk must not give one leg two names on two screens.
        'shipments.createdAt as shipmentCreatedAt',
        sql<Date | null>`(select min(se.received_at) from shipment_emails se where se.shipment_id = shipments.id)`.as(
          'firstEmailAt',
        ),
      ])
      .execute()
  }

  /** Bulk form of linkedPosForBooking — ONE query for booking-PO fallback on the tracker list. */
  async linkedPosForBookings(
    bookingIds: string[],
  ): Promise<Map<string, Awaited<ReturnType<ShipmentRepository['linkedPosForBooking']>>>> {
    const map = new Map<string, Awaited<ReturnType<ShipmentRepository['linkedPosForBooking']>>>()
    if (!bookingIds.length) return map
    const rows = await this.db
      .selectFrom('bookingPos')
      .innerJoin('purchaseOrders', 'bookingPos.poId', 'purchaseOrders.id')
      .leftJoin('vendors', 'purchaseOrders.vendorId', 'vendors.id')
      .where('bookingPos.bookingId', 'in', bookingIds)
      .select([
        'bookingPos.bookingId as bookingId',
        'purchaseOrders.id as id',
        'purchaseOrders.poNumber as poNumber',
        'purchaseOrders.totalQuantity as totalQuantity',
        'purchaseOrders.quantityUnit as quantityUnit',
        'purchaseOrders.itemStyleNo as itemStyleNo',
        'purchaseOrders.brand as brand',
        'vendors.name as vendorName',
      ])
      .execute()
    for (const r of rows) {
      const { bookingId, ...rest } = r
      const arr = map.get(bookingId)
      if (arr) arr.push(rest)
      else map.set(bookingId, [rest])
    }
    return map
  }

  // --- shipment_pos ---

  /** Idempotently link a shipment to a PO (the `uq_shipment_pos` unique absorbs replays). */
  /** `inferred` (0029): the group SWEPT this PO up rather than stating it — a weaker claim that a
   *  later stated one may displace. Defaults false, so every existing caller keeps writing a strong link. */
  async linkPo(
    shipmentId: string,
    poId: string,
    quantity: number | null,
    unit: string | null,
    inferred = false,
  ) {
    const existing = await this.db
      .selectFrom('shipmentPos')
      .where('shipmentId', '=', shipmentId)
      .where('poId', '=', poId)
      .select(['id', 'inferred'])
      .executeTakeFirst()
    if (existing) {
      // 0029: claim strength is relative to the B/L that OWNS the leg now, so a re-link restates it.
      // A nascent leg's links are written by the pre-B/L booking request, which states the whole
      // programme — Set 5's 2026-01-16 email states all nine POs before any AWB exists. When an AWB
      // later ADOPTS that leg, its own view is the one that counts: the POs it merely swept off an
      // attachment become inferred, and a later email that names them can take them back.
      if (existing.inferred !== inferred) {
        await this.db.updateTable('shipmentPos').set({ inferred }).where('id', '=', existing.id).execute()
      }
      return null
    }
    try {
      const row = await this.db
        .insertInto('shipmentPos')
        .values({ shipmentId, poId, quantity, quantityUnit: unit, inferred })
        .outputAll('inserted')
        .executeTakeFirst()
      return row ?? null
    } catch (e) {
      // unique violation (shipment_id, po_id) — a concurrent insert won the race; idempotent
      if (!/unique|duplicate/i.test((e as Error).message)) throw e
      return null
    }
  }

  posFor(shipmentId: string) {
    return this.db.selectFrom('shipmentPos').where('shipmentId', '=', shipmentId).selectAll().execute()
  }

  /** PO numbers linked via shipment_pos for many legs in ONE query (shipmentId → poNumbers).
   *  Companion to bookingRepo.poNumbersByBooking — summaries union both sources (#121). */
  async poNumbersByShipment(shipmentIds: string[]): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>()
    if (!shipmentIds.length) return map
    const rows = await this.db
      .selectFrom('shipmentPos')
      .innerJoin('purchaseOrders', 'shipmentPos.poId', 'purchaseOrders.id')
      .where('shipmentPos.shipmentId', 'in', shipmentIds)
      .select(['shipmentPos.shipmentId as shipmentId', 'purchaseOrders.poNumber as poNumber'])
      .execute()
    for (const r of rows) {
      const arr = map.get(r.shipmentId)
      if (arr) arr.push(r.poNumber)
      else map.set(r.shipmentId, [r.poNumber])
    }
    return map
  }

  // --- shipment_milestones ---

  milestonesFor(shipmentId: string) {
    return this.db
      .selectFrom('shipmentMilestones')
      .where('shipmentId', '=', shipmentId)
      .orderBy('occurredAt', 'asc')
      .selectAll()
      .execute()
  }

  /** milestonesFor many shipments in ONE query (shipmentId -> milestones, occurredAt order). */
  async milestonesForShipments(ids: string[]) {
    const map = new Map<string, Awaited<ReturnType<ShipmentRepository['milestonesFor']>>>()
    if (!ids.length) return map
    const rows = await this.db
      .selectFrom('shipmentMilestones')
      .where('shipmentId', 'in', ids)
      .orderBy('occurredAt', 'asc')
      .selectAll()
      .execute()
    for (const m of rows) {
      const arr = map.get(m.shipmentId)
      if (arr) arr.push(m)
      else map.set(m.shipmentId, [m])
    }
    return map
  }

  async replaceMilestones(shipmentId: string, rows: Record<string, unknown>[]) {
    await this.db.deleteFrom('shipmentMilestones').where('shipmentId', '=', shipmentId).execute()
    if (rows.length) await this.db.insertInto('shipmentMilestones').values(rows as never).execute()
  }

  /** Every source email that contributed to this shipment (the Related Emails list).
   *  Empty `rows` is a NO-OP (never wipe existing links) — a partial rematch without events
   *  must not blank Related Emails on the UI. Non-empty replaces the full set. */
  async replaceEmails(shipmentId: string, rows: Record<string, unknown>[]) {
    if (!rows.length) return
    await this.db.deleteFrom('shipmentEmails').where('shipmentId', '=', shipmentId).execute()
    // insert idempotently on (shipment_id, graph_message_id) — check-then-insert per row
    for (const r of rows) {
      const graphMessageId = r.graphMessageId as string | null
      if (!graphMessageId) continue
      const existing = await this.db
        .selectFrom('shipmentEmails')
        .where('shipmentId', '=', shipmentId)
        .where('graphMessageId', '=', graphMessageId)
        .select('id')
        .executeTakeFirst()
      if (existing) continue
      try {
        await this.db.insertInto('shipmentEmails').values(r as never).execute()
      } catch (e) {
        if (!/unique|duplicate/i.test((e as Error).message)) throw e
      }
    }
  }

  /** The graph message id of the most recent source email for this shipment. Null when none linked. */
  async sourceGraphIdFor(shipmentId: string): Promise<string | null> {
    // Kysely MSSQL emits `limit` verbatim → use TOP 1 via modifyFront.
    const row = await this.db
      .selectFrom('shipmentEmails')
      .where('shipmentId', '=', shipmentId)
      .where('graphMessageId', 'is not', null)
      .orderBy('receivedAt', 'desc')
      .modifyFront(sql`top ${sql.lit(1)}`)
      .select('graphMessageId as g')
      .executeTakeFirst()
    return row?.g ?? null
  }

  // --- shipment_identifiers (every value each identity field ever held — current first) ---

  identifiersFor(shipmentId: string) {
    return this.db
      .selectFrom('shipmentIdentifiers')
      .where('shipmentId', '=', shipmentId)
      .orderBy('isCurrent', 'desc')
      .orderBy('rank', 'desc')
      .selectAll()
      .execute()
  }

  async replaceIdentifiers(shipmentId: string, rows: Record<string, unknown>[]) {
    await this.db.deleteFrom('shipmentIdentifiers').where('shipmentId', '=', shipmentId).execute()
    if (rows.length) await this.db.insertInto('shipmentIdentifiers').values(rows as never).execute()
  }

  // --- shipment_match_keys (normalized strong-key INDEX derived from match_keys — the queryable form of
  //     strongKeys() that candidateLegs uses in place of the allLegs() scan; committer + matcher lookup) ---

  /** Rewrite a leg's strong-key index rows (delete+insert per shipment) — idempotent, like replaceIdentifiers. */
  async replaceMatchKeys(shipmentId: string, rows: Record<string, unknown>[]) {
    await this.db.deleteFrom('shipmentMatchKeys').where('shipmentId', '=', shipmentId).execute()
    if (rows.length) await this.db.insertInto('shipmentMatchKeys').values(rows as never).execute()
  }

  // --- shipment_parties (co-valid customer entities with roles — the primary first) ---

  partiesFor(shipmentId: string) {
    return this.db
      .selectFrom('shipmentParties')
      .where('shipmentId', '=', shipmentId)
      .orderBy('isPrimary', 'desc')
      .orderBy('rank', 'desc')
      .selectAll()
      .execute()
  }

  async replaceParties(shipmentId: string, rows: Record<string, unknown>[]) {
    await this.db.deleteFrom('shipmentParties').where('shipmentId', '=', shipmentId).execute()
    if (rows.length) await this.db.insertInto('shipmentParties').values(rows as never).execute()
  }

  // --- documents (kind='DOCUMENT' orphan legs — the Unlinked Documents view) ---

  private static poNumbersSubquery(tableAlias = 'shipments') {
    // Postgres array_agg → STRING_AGG(','); split in TS (the consumer treats it as string[]).
    // (SQL Server STRING_AGG has no DISTINCT — distinct is applied to the inner SELECT here.)
    return sql<string>`coalesce((select string_agg(po.po_number, ',') from (select distinct p2.po_number from shipment_pos sp join purchase_orders p2 on p2.id = sp.po_id where sp.shipment_id = ${sql.ref(tableAlias)}.id) po), '')`.as('poNumbers')
  }

  private static receivedAtMaxExpr(tableAlias = 'shipments') {
    return sql<Date | null>`(select max(se.received_at) from shipment_emails se where se.shipment_id = ${sql.ref(tableAlias)}.id)`
  }

  /** Earliest source-email received_at — the beginning email; anchors the derived Shipment ID month (#350). */
  private static receivedAtMinExpr(tableAlias = 'shipments') {
    return sql<Date | null>`(select min(se.received_at) from shipment_emails se where se.shipment_id = ${sql.ref(tableAlias)}.id)`
  }

  /**
   * Unlinked documents: kind='DOCUMENT' legs not yet linked onto a real shipment. Enriched with the
   * booking's customer name, distinct email type(s), a best-effort sender type, the PO numbers it carries,
   * and the newest received-at. Ordered newest-first (nulls last). Single query.
   */
  async documents() {
    const rows = await this.db
      .selectFrom('shipments')
      .leftJoin('bookings', 'shipments.bookingId', 'bookings.id')
      .leftJoin('customers', 'bookings.customerId', 'customers.id')
      .where('shipments.kind', '=', 'DOCUMENT')
      .where('shipments.linkedShipmentId', 'is', null)
      .where('shipments.dismissedAt', 'is', null)
      .orderBy(sql`case when ${ShipmentRepository.receivedAtMaxExpr()} is null then 1 else 0 end`, 'asc')
      .orderBy(ShipmentRepository.receivedAtMaxExpr(), 'desc')
      .select([
        'shipments.id as id', 'customers.name as customerName', 'shipments.qty as qty', 'shipments.qtyUnit as qtyUnit',
        sql<string | null>`(select string_agg(se.email_type, ', ') from (select distinct se2.email_type from shipment_emails se2 where se2.shipment_id = ${sql.ref('shipments.id')} and se2.email_type is not null) se)`.as('emailType'),
        sql<string | null>`(select top 1 pr.sender_type from shipment_emails se join parsed_record pr on pr.graph_message_id = se.graph_message_id where se.shipment_id = ${sql.ref('shipments.id')} and pr.sender_type is not null)`.as('senderType'),
        ShipmentRepository.poNumbersSubquery(),
        ShipmentRepository.receivedAtMaxExpr().as('receivedAt'),
      ])
      .execute()
    return rows.map((r) => ({ ...r, poNumbers: splitPoNumbers(r.poNumbers) }))
  }

  /**
   * One unlinked document's detail (the detail panel): booking customer + email type(s) + sender type +
   * PO numbers + qty + newest received-at, plus the email_message id of its most-recent source email
   * (joined shipment_emails.graph_message_id → email_message.graph_message_id). Null when not a document.
   */
  async documentDetail(id: string) {
    const row = await this.db
      .selectFrom('shipments')
      .leftJoin('bookings', 'shipments.bookingId', 'bookings.id')
      .leftJoin('customers', 'bookings.customerId', 'customers.id')
      .where('shipments.id', '=', id)
      .where('shipments.kind', '=', 'DOCUMENT')
      .select([
        'shipments.id as id', 'customers.name as customerName', 'shipments.qty as qty', 'shipments.qtyUnit as qtyUnit',
        sql<string | null>`(select string_agg(se.email_type, ', ') from (select distinct se2.email_type from shipment_emails se2 where se2.shipment_id = ${sql.ref('shipments.id')} and se2.email_type is not null) se)`.as('emailType'),
        sql<string | null>`(select top 1 pr.sender_type from shipment_emails se join parsed_record pr on pr.graph_message_id = se.graph_message_id where se.shipment_id = ${sql.ref('shipments.id')} and pr.sender_type is not null)`.as('senderType'),
        ShipmentRepository.poNumbersSubquery(),
        ShipmentRepository.receivedAtMaxExpr().as('receivedAt'),
        sql<string | null>`(select top 1 qm.id from shipment_emails se join email_message qm on qm.graph_message_id = se.graph_message_id where se.shipment_id = ${sql.ref('shipments.id')} order by case when se.received_at is null then 1 else 0 end asc, se.received_at desc)`.as('emailId'),
      ])
      .executeTakeFirst()
    if (!row) return null
    return { ...row, poNumbers: splitPoNumbers(row.poNumbers) }
  }

  /** Mark an unlinked document dismissed (idempotent) — it drops off the Unlinked Documents list. */
  async dismissDocument(id: string) {
    await this.db
      .updateTable('shipments')
      .set({ dismissedAt: new Date(), updatedAt: new Date() })
      .where('id', '=', id)
      .where('kind', '=', 'DOCUMENT')
      .execute()
  }

  /** kind lookup for a leg (null when the id doesn't exist) — link-validation. */
  async kindOf(id: string): Promise<'SHIPMENT' | 'DOCUMENT' | null> {
    const row = await this.db.selectFrom('shipments').where('id', '=', id).select('kind as kind').executeTakeFirst()
    return (row?.kind as 'SHIPMENT' | 'DOCUMENT' | undefined) ?? null
  }

  /**
   * Link a DOCUMENT onto a target SHIPMENT in one transaction: copy its POs and source-emails onto the
   * target (idempotent against the (shipment,po) / (shipment,graph_id) unique keys), then stamp the
   * document's linked_shipment_id so it leaves the Unlinked Documents view.
   */
  async linkDocument(documentId: string, targetShipmentId: string) {
    await this.db.transaction().execute(async (tx) => {
      const poRows = await tx
        .selectFrom('shipmentPos')
        .where('shipmentId', '=', documentId)
        .select(['poId', 'quantity', 'quantityUnit'])
        .execute()
      for (const r of poRows) {
        await upsertShipmentPo(tx, targetShipmentId, r.poId, r.quantity, r.quantityUnit)
      }
      const emailRows = await tx
        .selectFrom('shipmentEmails')
        .where('shipmentId', '=', documentId)
        .select(['graphMessageId', 'emailType', 'receivedAt'])
        .execute()
      for (const r of emailRows) {
        await upsertShipmentEmail(tx, targetShipmentId, r.graphMessageId, r.emailType, r.receivedAt)
      }
      await tx
        .updateTable('shipments')
        .set({ linkedShipmentId: targetShipmentId, updatedAt: new Date() })
        .where('id', '=', documentId)
        .execute()
    })
  }

  /**
   * Fold a zero-identity provisional SHIPMENT leg into an existing shipment: copy POs + source-emails
   * onto the target (same idempotent upserts as linkDocument), then stamp linkedShipmentId + dismissedAt
   * so the source leaves the Active queue. Deliberately does NOT clear the source's match_keys — a matcher
   * re-ingest of the still-keyless thread must A2-match this retired husk (committer never touches
   * dismissedAt) instead of minting a fresh queue item.
   */
  async linkProvisionalLeg(sourceShipmentId: string, targetShipmentId: string) {
    await this.db.transaction().execute(async (tx) => {
      const poRows = await tx
        .selectFrom('shipmentPos')
        .where('shipmentId', '=', sourceShipmentId)
        .select(['poId', 'quantity', 'quantityUnit'])
        .execute()
      for (const r of poRows) {
        await upsertShipmentPo(tx, targetShipmentId, r.poId, r.quantity, r.quantityUnit)
      }
      const emailRows = await tx
        .selectFrom('shipmentEmails')
        .where('shipmentId', '=', sourceShipmentId)
        .select(['graphMessageId', 'emailType', 'receivedAt'])
        .execute()
      for (const r of emailRows) {
        await upsertShipmentEmail(tx, targetShipmentId, r.graphMessageId, r.emailType, r.receivedAt)
      }
      await tx
        .updateTable('shipments')
        .set({ linkedShipmentId: targetShipmentId, dismissedAt: new Date(), updatedAt: new Date() })
        .where('id', '=', sourceShipmentId)
        .execute()
    })
  }
}

/** Split the STRING_AGG'd po_numbers column into the string[] the consumer expects ('' → []). */
function splitPoNumbers(s: string | null | undefined): string[] {
  if (!s) return []
  return s.split(',').filter(Boolean)
}

/** Idempotent upsert of a (shipment, po) link — check-then-insert, `uq_shipment_pos` absorbs replays. */
async function upsertShipmentPo(
  tx: DbLike,
  shipmentId: string,
  poId: string,
  quantity: number | null,
  quantityUnit: string | null,
) {
  const existing = await tx.selectFrom('shipmentPos').where('shipmentId', '=', shipmentId).where('poId', '=', poId).select('id').executeTakeFirst()
  if (existing) return
  try {
    await tx.insertInto('shipmentPos').values({ shipmentId, poId, quantity, quantityUnit }).execute()
  } catch (e) {
    if (!/unique|duplicate/i.test((e as Error).message)) throw e
  }
}

/** Idempotent upsert of a (shipment, graph_message_id) email link. */
async function upsertShipmentEmail(
  tx: DbLike,
  shipmentId: string,
  graphMessageId: string | null,
  emailType: string | null,
  receivedAt: Date | null,
) {
  if (!graphMessageId) return
  const existing = await tx.selectFrom('shipmentEmails').where('shipmentId', '=', shipmentId).where('graphMessageId', '=', graphMessageId).select('id').executeTakeFirst()
  if (existing) return
  try {
    await tx.insertInto('shipmentEmails').values({ shipmentId, graphMessageId, emailType, receivedAt }).execute()
  } catch (e) {
    if (!/unique|duplicate/i.test((e as Error).message)) throw e
  }
}
