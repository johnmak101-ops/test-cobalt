import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { ShipmentRepository } from '../db/repositories/shipment.repository'
import { BookingRepository } from '../db/repositories/booking.repository'
import { FieldLockRepository } from '../db/repositories/field-lock.repository'
import { AuditRepository } from '../db/repositories/audit.repository'
import { CriticCalibrationRepository } from '../db/repositories/critic-calibration.repository'
import { MastersRepository } from '../db/repositories/masters.repository'
import type { CalibrationOutcome } from '../db/kysely/db'
import type { CriticReview } from '../decisions/critic-review.types'
import { QueueLearningClient } from './queue-learning.client'
import { syncIdentityMatchKeys } from '../shipments/identity-keys'
import { coerceLegField } from '../shipments/coerce-field'
import { keysOverlap, normBookingKey, normKey, strongKeys } from '../reconcile/match-keys'
import type { CorrectDto, IdentifyDto, LinkDto } from './dto'
import { logAmbiguityPickFromLink } from './ambiguity-pick-log'
import { queueLearningValue } from './queue-field-value'

/** IdentifyDto snake_case strong-key field → camelCase shipment column. */
const KEY_TO_LEG_COLUMN: Record<IdentifyDto['field'], string> = {
  booking_no: 'bookingNo',
  so_no: 'soNo',
  hbl_awb_fcr_no: 'hblAwbFcrNo',
  mbl: 'mbl',
  container_no: 'containerNo',
}

/**
 * Columns /correct may write. Must stay aligned with frontend mapCriticFieldToColumn /
 * EDITABLE_FIELDS + critic extras (polRaw, mode, …). Unknown keys → BadRequest (never SQL explode).
 */
/**
 * Leg columns a reviewer may write. MUST be a superset of every `column` in the review form's
 * EDITABLE_FIELDS (frontend/src/lib/review-fields.ts) — the form renders an input, the operator types,
 * and this set decides whether the save 400s. `review.service.spec.ts` pins the two together.
 *
 * `warehouseSo` was missing: the 入仓 SO got its own input in 2026-07-24 (it used to share the SO#
 * row) and the form shipped without this set being widened, so editing it 400'd with
 * "field not correctable: warehouseSo" — and the queue page reported that through the SUCCESS toast,
 * so the operator saw a green tick over a save that never happened.
 */
export const CORRECTABLE_COLUMNS = new Set([
  'bookingNo', 'soNo', 'warehouseSo', 'itemStyleNo', 'qty', 'qtyUnit', 'grossWeight', 'measurement', 'htsCode',
  'containerNo', 'hblAwbFcrNo', 'mbl', 'scacCode', 'consigneeName', 'consigneeAddress',
  'vesselName', 'voyageNo', 'cargoReadyDate', 'cfsCutoff', 'etd', 'atd', 'eta', 'ata',
  'warehouseStartDate', 'warehouseEndDate', 'inDcDate',
  // critic extras (not all on Order Details form). customerRaw/vendorRaw are the free-text stand-ins a
  // reviewer sets when no Mesh master resolves — masters are read-only (synced ~every 2 months), so the
  // raw column is the only place to record the correct party until the master arrives (it then wins display).
  'mode', 'polRaw', 'podRaw', 'forwarderRaw', 'customerRaw', 'vendorRaw', 'flightNo', 'mawb',
])

const toStr = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v))

/** Leg (camelCase) column → the queue's snake_case parse-field name (booking_no, hbl_awb_fcr_no, …).
 *  MOSTLY a plain camel→snake conversion — EXCEPT the five party/port columns, whose leg names carry a
 *  `Raw` suffix the parser never had. Without the alias map the feed posted `pol_raw`/`forwarder_raw`/…
 *  — names the queue's re-parse can never reproduce, so every such correction was fuel that could not
 *  burn: it counted toward the batch trigger, taught the refiner a nonexistent vocabulary, and was a
 *  guaranteed holdout miss for BOTH candidate souls. The aliases speak the parser's own names. */
const QUEUE_FIELD_ALIAS: Record<string, string> = {
  polRaw: 'pol',
  podRaw: 'pod',
  forwarderRaw: 'forwarder_name',
  customerRaw: 'customer_code',
  vendorRaw: 'vendor_code',
}
const toQueueField = (col: string): string =>
  QUEUE_FIELD_ALIAS[col] ?? col.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()

/** The parse-derived leg columns a reviewer can accept ("looks right") — the same set the review UI edits
 *  (frontend review-fields.ts). `isDate` cols are frozen as YYYY-MM-DD to match the parser's date format so
 *  the confirm actually matches on the queue's re-parse.
 *
 *  `cfsCutoff` is deliberately NOT confirmable: the parser structurally cannot emit it (absent from the
 *  soul and the queue's field registry), so its values are always human-entered. A confirm would freeze a
 *  value the re-parse can never reproduce — a PERMANENT phantom "regression" that trips the queue's
 *  confirm-regression scan (threshold 2) every night, forever. It stays correctable/editable.
 *
 *  The four DESK-HIDDEN columns (`itemStyleNo`, `grossWeight`, `measurement`, `htsCode` — suppressed by
 *  DESK_HIDDEN_FIELDS on the queue card and HIDDEN_FIELD_LABELS on the detail page) are NOT confirmable
 *  either: a one-click confirm was emitting "this is right" labels for values the operator never saw —
 *  blind endorsements feeding the learning eval. Rule: never confirm what the desk does not show.
 *  All four stay correctable (they are edited on other surfaces). */
const CONFIRMABLE_FIELDS: string[] = [
  'bookingNo', 'soNo', 'qty', 'qtyUnit', 'hblAwbFcrNo', 'mbl', 'containerNo', 'scacCode',
  'vesselName', 'voyageNo', 'consigneeName', 'consigneeAddress', 'cargoReadyDate',
  'etd', 'atd', 'eta', 'ata', 'warehouseStartDate', 'warehouseEndDate',
]

/**
 * The human review workflow over the commit-first model: provisional shipments are listed here,
 * and a reviewer either confirms them as-is or corrects fields. A correction LOCKS each edited field —
 * which keeps the reviewer's value on record rather than blocking the agent (latest-email-wins since
 * PR #232; a later disagreeing email overwrites the column and the field reads CONTESTED) — records the
 * reason, and audits every change.
 */
@Injectable()
export class ReviewService {
  private readonly logger = new Logger(ReviewService.name)

  constructor(
    private readonly shipments: ShipmentRepository,
    private readonly bookings: BookingRepository,
    private readonly fieldLocks: FieldLockRepository,
    private readonly audit: AuditRepository,
    private readonly queueLearning: QueueLearningClient,
    private readonly calibration: CriticCalibrationRepository,
    private readonly masters: MastersRepository,
  ) {}

  private bandFromLeg(leg: { criticReview?: CriticReview | null | unknown }): 'low' | 'medium' | 'high' | null {
    const cr = leg.criticReview as CriticReview | null | undefined
    const b = cr?.confidence?.band
    return b === 'low' || b === 'medium' || b === 'high' ? b : null
  }

  /** Best-effort: never fail the human review action if calibration logging fails. */
  private async recordCalibration(opts: {
    shipmentId: string
    leg: { criticReview?: unknown }
    outcome: CalibrationOutcome
    correctedFieldCount: number
    actorId: string
    reasons?: string[] | null
  }): Promise<void> {
    try {
      await this.calibration.insert({
        shipmentId: opts.shipmentId,
        band: this.bandFromLeg(opts.leg),
        outcome: opts.outcome,
        correctedFieldCount: opts.correctedFieldCount,
        actorId: opts.actorId,
        reasons: opts.reasons ?? null,
      })
    } catch (err) {
      this.logger.warn(
        `critic_calibration insert failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  /** Provisional shipments awaiting review, lowest confidence first, with booking context. */
  async queue() {
    const legs = await this.shipments.provisionalLegs()
    // Two bulk loads (bookings + PO numbers) keyed by bookingId instead of a findById + poNumbersFor per
    // leg — the review queue was 2N round-trips; now 2, regardless of how many legs await review.
    const bookingIds = legs.map((l) => l.bookingId)
    const [bookingsById, posByBooking] = await Promise.all([
      this.bookings.findByIds(bookingIds),
      this.bookings.poNumbersByBooking(bookingIds),
    ])
    return legs.map((leg) => ({
      ...leg,
      jobNo: bookingsById.get(leg.bookingId)?.jobNo ?? null,
      pos: posByBooking.get(leg.bookingId) ?? [],
    }))
  }

  /** Load a leg and enforce confirm/correct preconditions: exists, provisional, optional optimistic concurrency. */
  private async loadLegForReview(shipmentId: string, expectedUpdatedAt?: string) {
    const leg = await this.shipments.findById(shipmentId)
    if (!leg) throw new NotFoundException(`shipment ${shipmentId} not found`)
    if (leg.reviewStatus !== 'provisional') {
      throw new ConflictException('shipment is not provisional')
    }
    if (expectedUpdatedAt != null && expectedUpdatedAt !== '') {
      const expectedMs = new Date(expectedUpdatedAt).getTime()
      const actualMs = new Date(leg.updatedAt).getTime()
      if (expectedMs !== actualMs) {
        throw new ConflictException('shipment was modified; reload and try again')
      }
    }
    return leg
  }

  /**
   * Graph message id for queue learning attribution (queue resolves it to the parsed record).
   * When no source email is linked, return null and log loud — NEVER fall back to the shipment UUID
   * (#236 P2): the queue cannot resolve a leg id → dead / poison TRAIN fuel.
   */
  private async resolveLearningMessageId(shipmentId: string): Promise<string | null> {
    const graphId = await this.shipments.sourceGraphIdFor(shipmentId)
    if (graphId) return graphId
    this.logger.error(
      `QUEUE LEARNING SKIPPED — no source graph message id for shipment=${shipmentId}; refusing shipment UUID as messageId (would poison the queue)`,
    )
    return null
  }

  /** Accept a provisional shipment as-is. An optional reviewer note is audited (soul feedback). A "looks
   *  right" acceptance also vouches for every parse-derived field, so we emit a confirm-sentinel per field
   *  to the queue's learning feed (guards its held-out eval — a soul that starts mis-parsing a confirmed
   *  field regresses the score). Nothing was edited → the edited set is empty. */
  async confirm(
    shipmentId: string,
    actorId: string,
    note?: string,
    expectedUpdatedAt?: string,
    /** Per-field keep rulings (see lockKeptFields). A card whose only decision is "these stored
     *  values are right" writes no field, so it lands here rather than on /correct. */
    keep?: string[],
  ) {
    const leg = await this.loadLegForReview(shipmentId, expectedUpdatedAt)
    const keeping = this.keepFields(keep, new Set())
    // Clear any waiting stamp: the question has now been answered, so a leftover "parked" mark would
    // re-park the leg if it were ever restored to provisional.
    await this.shipments.updateLeg(shipmentId, {
      reviewStatus: 'confirmed', reviewedBy: actorId, reviewedAt: new Date(),
      waitingAt: null, waitingReason: null,
    })
    await this.audit.write({
      entityType: 'shipment', entityId: shipmentId, field: null,
      oldValue: leg.reviewStatus, newValue: 'confirmed', changeType: 'update',
      sourceType: 'review', actorUserId: actorId, note: note?.trim() || 'review: confirmed as-is',
    })
    /**
     * "Confirmed as-is" must not leave the leg naming one company while its master link names
     * another. Keeping the raw value is a decision FOR that value, so the link follows it — and this
     * is the only branch that can close the gap, since keeping the current value writes no field and
     * therefore never reaches correctField's re-resolve.
     */
    await this.reResolveBookingParties(leg as Record<string, unknown>, actorId)
    const kept = await this.lockKeptFields(shipmentId, leg as Record<string, unknown>, keeping, actorId)
    const messageId = await this.resolveLearningMessageId(shipmentId)
    const forwarder = ((leg as Record<string, unknown>).forwarderRaw as string | null) ?? null
    await this.emitConfirms(leg as Record<string, unknown>, new Set(), messageId, forwarder)
    await this.recordCalibration({
      shipmentId, leg, outcome: 'approved', correctedFieldCount: 0, actorId,
      reasons: note?.trim() ? [note.trim()] : null,
    })
    return { shipmentId, reviewStatus: 'confirmed', kept }
  }

  /** Emit a "looks right" confirm-sentinel to the queue learning feed for every confirmable parse field that
   *  is non-null and was NOT just edited. Each is one POST with kind:'confirm', agentSaid == humanCorrected
   *  == the frozen value the reviewer saw (dates as YYYY-MM-DD, the parser's format, so a later soul re-parse
   *  compares equal). Best-effort — postCorrection swallows its own errors and never breaks the review save.
   *  Skips entirely when messageId is null (no resolvable source graph id — do not poison the queue). */
  private async emitConfirms(leg: Record<string, unknown>, edited: Set<string>, messageId: string | null, forwarder: string | null) {
    if (messageId == null) return
    for (const column of CONFIRMABLE_FIELDS) {
      if (edited.has(column)) continue
      const frozen = queueLearningValue(column, leg[column])
      if (frozen == null) continue
      await this.queueLearning.postCorrection({
        messageId, field: toQueueField(column), agentSaid: frozen, humanCorrected: frozen, forwarder, note: null, kind: 'confirm',
      })
    }
  }

  /** One human field write with the full review guarantees: column + lock (the value on record, contested
   *  if a later email disagrees) + audit + learning feed. */
  private async applyHumanFieldWrite(
    shipmentId: string,
    current: Record<string, unknown>,
    field: string,
    raw: unknown,
    actorId: string,
    note: string,
    messageId: string | null,
    forwarder: string | null,
    learningNote: string | null = note,
  ): Promise<unknown> {
    if (!CORRECTABLE_COLUMNS.has(field)) {
      throw new BadRequestException(`field not correctable: ${field}`)
    }
    const value = coerceLegField(field, raw)
    const patch: Record<string, unknown> = { [field]: value }
    // Stale-FK guard, same class as the detail-edit fix: display prefers the resolved master
    // (port label from polId, forwarder/party names from their FKs), so a human raw-value write
    // must re-link the master (exact code/name) or unlink it — otherwise the old master keeps
    // winning and the correction looks like it never saved.
    if (field === 'polRaw' || field === 'podRaw') {
      patch[field === 'polRaw' ? 'polId' : 'podId'] =
        value == null ? null : await this.masters.portIdByUnlocode(String(value))
    }
    if (field === 'forwarderRaw') {
      patch.forwarderId = value == null ? null : await this.masters.forwarderIdExact(String(value))
    }
    await this.shipments.updateLeg(shipmentId, patch)
    if ((field === 'vendorRaw' || field === 'customerRaw') && current.bookingId) {
      const masterId =
        value == null
          ? null
          : field === 'vendorRaw'
            ? await this.masters.vendorIdExact(String(value))
            : await this.masters.customerIdExact(String(value))
      await this.bookings.update(String(current.bookingId), {
        [field === 'vendorRaw' ? 'vendorId' : 'customerId']: masterId,
      })
    }
    await this.fieldLocks.lock('shipment', shipmentId, field, toStr(value), actorId)
    await this.audit.write({
      entityType: 'shipment', entityId: shipmentId, field,
      oldValue: toStr(current[field]), newValue: toStr(value), changeType: 'update',
      sourceType: 'review', actorUserId: actorId, note,
    })
    // Feed the correction to the queue learning loop (best-effort; never breaks the review save). Post the
    // queue's snake_case parse-field name — the leg column `soNo` is the parser's `so_no`, and the queue
    // scores on the parse field, so a camelCase name would silently never match. Skip when no graph id
    // (#236 P2) — shipment UUID is not a valid messageId for the queue.
    if (messageId != null) {
      await this.queueLearning.postCorrection({
        // queueLearningValue, not toStr: a leg date is a Date, and toStr's ISO string is a format the
        // parser never emits — every date correction was a guaranteed holdout miss. Same reason the
        // field NAME is aliased above; this is the same fix one layer down, on the VALUE.
        messageId, field: toQueueField(field),
        agentSaid: queueLearningValue(field, current[field]), humanCorrected: queueLearningValue(field, value),
        forwarder, note: learningNote, kind: 'correction',
      })
    }
    return value
  }

  /**
   * Point the booking's customer/vendor master at whatever the leg's raw twin now names — or unlink
   * it when nothing matches, so display falls back to the raw rather than asserting a company the
   * leg does not name.
   *
   * The same stale-FK rule correctField and the detail edit already apply; this covers the branch
   * neither could reach — a confirmation that writes no field. Leg 20260405F1 sat with
   * `vendor_raw = ELSMCO` under `booking.vendor_id = SOUOCE`, so Order Details printed SOUOCE while
   * the review desk read ELSMCO, and no click available to the operator could reconcile them.
   */
  private async reResolveBookingParties(leg: Record<string, unknown>, actorId: string) {
    const bookingId = leg.bookingId == null ? null : String(leg.bookingId)
    if (!bookingId) return
    const booking = await this.bookings.findById(bookingId)
    if (!booking) return
    const slots = [
      { raw: 'vendorRaw', fk: 'vendorId', exact: (v: string) => this.masters.vendorIdExact(v) },
      { raw: 'customerRaw', fk: 'customerId', exact: (v: string) => this.masters.customerIdExact(v) },
    ] as const
    const patch: Record<string, unknown> = {}
    for (const slot of slots) {
      const raw = String(leg[slot.raw] ?? '').trim()
      if (raw === '') continue // no claim on this slot — leave the existing link alone
      const linked = ((booking as Record<string, unknown>)[slot.fk] as string | null) ?? null
      const resolved = (await slot.exact(raw)) ?? null
      if (resolved === linked) continue
      patch[slot.fk] = resolved
      await this.audit.write({
        entityType: 'shipment', entityId: String(leg.id), field: slot.fk,
        oldValue: linked, newValue: resolved, changeType: 'update',
        sourceType: 'review', actorUserId: actorId,
        note: `master re-linked from ${slot.raw} "${raw}" on confirm`,
      })
    }
    if (Object.keys(patch).length) await this.bookings.update(bookingId, patch)
  }

  /**
   * "What the leg already holds is right" — a per-field DECISION that writes no value.
   *
   * The review desk previously had no way to express this: a row resolved to the stored value
   * contributed nothing to `fields`, so the approve posted an empty set and the ruling evaporated.
   * Meanwhile the shipment detail page locks every field a human edits — the same person making the
   * same call got an audit trail on one screen and silence on the other.
   *
   * Locking at the STORED value, never at a value from the request: the client names the field, the
   * leg supplies the value. A `keep` that could carry its own value would be a write wearing a
   * different name.
   *
   * Per PR #232 a lock no longer blocks a later email — a disagreeing email still wins and the field
   * is flagged CONTESTED. So the whole observable effect is that the next disagreement surfaces
   * instead of passing silently, which is exactly what a recorded human ruling should buy.
   *
   * `written` is the set this same request is writing. A field in both is a contradictory
   * instruction ("write X" and "do not write"), not something to silently resolve — 400.
   */
  private keepFields(keep: string[] | undefined, written: Set<string>): string[] {
    const fields = [...new Set((keep ?? []).map((f) => String(f).trim()).filter(Boolean))]
    for (const field of fields) {
      if (!CORRECTABLE_COLUMNS.has(field)) throw new BadRequestException(`field not correctable: ${field}`)
      if (written.has(field)) throw new BadRequestException(`field cannot be both written and kept: ${field}`)
    }
    return fields
  }

  /** Apply what `keepFields` validated. Split from it so `correct` can reject a bad `keep` BEFORE its
   *  first field write, keeping the endpoint's all-or-nothing contract. */
  private async lockKeptFields(
    shipmentId: string,
    leg: Record<string, unknown>,
    fields: string[],
    actorId: string,
  ): Promise<string[]> {
    for (const field of fields) {
      const value = toStr(leg[field])
      await this.fieldLocks.lock('shipment', shipmentId, field, value, actorId)
      // old === new is the point: a ruling, not a change. The note is what distinguishes it from a
      // no-op write in Change History, so it must say so plainly.
      await this.audit.write({
        entityType: 'shipment', entityId: shipmentId, field,
        oldValue: value, newValue: value, changeType: 'update',
        sourceType: 'review', actorUserId: actorId,
        note: 'review: kept the stored value — nothing written, field locked',
      })
    }
    return fields
  }

  /** Correct fields on a provisional shipment: edits win, lock, are audited, and confirm the leg. */
  async correct(shipmentId: string, dto: CorrectDto, actorId: string) {
    const leg = await this.loadLegForReview(shipmentId, dto.expectedUpdatedAt)
    const current = leg as Record<string, unknown>
    // All-or-nothing: reject unknown columns and coerce + sanity-gate every value BEFORE the first write,
    // so a bad value (e.g. a negative quantity) 400s without leaving a partial, half-corrected leg.
    for (const [field, raw] of Object.entries(dto.fields ?? {})) {
      if (!CORRECTABLE_COLUMNS.has(field)) throw new BadRequestException(`field not correctable: ${field}`)
      coerceLegField(field, raw)
    }
    const keeping = this.keepFields(dto.keep, new Set(Object.keys(dto.fields ?? {})))
    const corrected: string[] = []
    // Attribute learning to a source email graph id (queue resolves it to the parsed record). When none
    // is linked, skip queue emits rather than posting the shipment UUID (#236 P2).
    const messageId = await this.resolveLearningMessageId(shipmentId)
    const forwarder = ((leg as Record<string, unknown>).forwarderRaw as string | null) ?? null

    const correctedValues: Record<string, unknown> = {}
    for (const [field, raw] of Object.entries(dto.fields ?? {})) {
      const value = await this.applyHumanFieldWrite(
        shipmentId, current, field, raw, actorId,
        dto.reason ?? 'review: corrected', messageId, forwarder, dto.reason ?? null,
      )
      corrected.push(field)
      correctedValues[field] = value
    }

    await syncIdentityMatchKeys(this.shipments, shipmentId, correctedValues)
    // Kept fields are disjoint from the written ones (keepFields rejects an overlap), so `current`
    // still holds exactly the values these rulings are about.
    const kept = await this.lockKeptFields(shipmentId, current, keeping, actorId)

    // The parse-derived fields the reviewer looked at and left untouched are an implicit "looks right".
    await this.emitConfirms(current, new Set(corrected), messageId, forwarder)

    await this.shipments.updateLeg(shipmentId, { reviewStatus: 'confirmed', reviewedBy: actorId, reviewedAt: new Date() })
    await this.recordCalibration({
      shipmentId, leg, outcome: 'corrected',
      correctedFieldCount: corrected.length,
      actorId,
      reasons: dto.reason ? [dto.reason] : null,
    })
    return { shipmentId, reviewStatus: 'confirmed', corrected, kept }
  }

  /** The zero-identity resolution flow: typed key exists elsewhere → offer a link candidate (never a
   *  silent merge — a typo must not fuse two shipments); exists nowhere → set it as a normal correction
   *  WITHOUT confirming the leg. */
  async identify(shipmentId: string, dto: IdentifyDto, actorId: string) {
    const norm = dto.field === 'booking_no' ? normBookingKey(dto.value) : normKey(dto.value)
    if (!norm) throw new BadRequestException('value normalizes to nothing')
    const others = (await this.shipments.candidateLegs([{ type: dto.field, value: norm }], []))
      .filter((l) => l.id !== shipmentId)
    if (others.length === 1) {
      const target = others[0]!
      const booking = await this.bookings.findById(target.bookingId)
      return {
        outcome: 'candidate' as const,
        candidate: { shipmentId: target.id, jobNo: booking?.jobNo ?? '(unknown)', matchedValue: dto.value },
      }
    }
    if (others.length > 1) return { outcome: 'ambiguous' as const, count: others.length }

    const leg = await this.loadLegForReview(shipmentId, undefined)
    const current = leg as Record<string, unknown>
    const messageId = await this.resolveLearningMessageId(shipmentId)
    const forwarder = (current.forwarderRaw as string | null) ?? null
    const col = KEY_TO_LEG_COLUMN[dto.field]
    const value = await this.applyHumanFieldWrite(
      shipmentId, current, col, dto.value, actorId, 'review: identified', messageId, forwarder,
    )
    await syncIdentityMatchKeys(this.shipments, shipmentId, { [col]: value })
    return { outcome: 'set' as const, field: dto.field, value: dto.value }
  }

  /**
   * Fold a provisional into an existing shipment. Optionally apply human field decisions to the
   * **target** first (Link & apply flow), then copy emails/POs and dismiss the source.
   */
  async link(shipmentId: string, dto: LinkDto, actorId: string) {
    if (dto.targetShipmentId === shipmentId) throw new BadRequestException('cannot link a leg into itself')
    const source = await this.shipments.findById(shipmentId)
    if (!source) throw new NotFoundException('shipment not found')
    if (source.kind !== 'SHIPMENT' || source.reviewStatus !== 'provisional' || source.dismissedAt != null)
      throw new BadRequestException('only an active provisional shipment leg can be linked')
    const target = await this.shipments.findById(dto.targetShipmentId)
    if (!target || target.kind !== 'SHIPMENT') throw new NotFoundException('target shipment not found')
    const srcKeys = strongKeys((source.matchKeys ?? {}) as Record<string, unknown>)
    const tgtKeys = strongKeys((target.matchKeys ?? {}) as Record<string, unknown>)
    // zero-identity fold (Wave 2) stays; a STRONG-keyed source is allowed ONLY as a duplicate fold —
    // it must share at least one strong key with the target (overlapping identity = same shipment).
    // Disjoint identities are two different shipments; folding them is over-merge.
    if (srcKeys.size > 0 && !keysOverlap(srcKeys, tgtKeys))
      throw new BadRequestException('leg carries a different identity than the target — not a duplicate; edit it on the shipment page instead')

    // Validate + coerce field patches on the TARGET before any write.
    const fieldEntries = Object.entries(dto.fields ?? {})
    for (const [field, raw] of fieldEntries) {
      if (!CORRECTABLE_COLUMNS.has(field)) throw new BadRequestException(`field not correctable: ${field}`)
      coerceLegField(field, raw)
    }

    const messageId = await this.resolveLearningMessageId(shipmentId)
    const forwarder = ((source as Record<string, unknown>).forwarderRaw as string | null) ?? null
    const note = dto.reason?.trim() || 'review: linked into existing shipment'
    let correctedFieldCount = 0

    // Apply human field decisions to the target (not the husk), then merge.
    const targetCurrent = target as Record<string, unknown>
    for (const [field, raw] of fieldEntries) {
      await this.applyHumanFieldWrite(
        dto.targetShipmentId,
        targetCurrent,
        field,
        raw,
        actorId,
        note,
        messageId,
        forwarder,
        dto.reason ?? null,
      )
      targetCurrent[field] = coerceLegField(field, raw)
      correctedFieldCount++
    }

    await this.shipments.linkProvisionalLeg(shipmentId, dto.targetShipmentId)
    await this.audit.write({
      entityType: 'shipment', entityId: shipmentId, field: null,
      oldValue: 'provisional', newValue: `linked:${dto.targetShipmentId}`, changeType: 'update',
      sourceType: 'review', actorUserId: actorId, note,
    })
    await this.audit.write({
      entityType: 'shipment', entityId: dto.targetShipmentId, field: null,
      oldValue: null, newValue: `absorbed:${shipmentId}`, changeType: 'update',
      sourceType: 'review', actorUserId: actorId,
      note:
        correctedFieldCount > 0
          ? `review: absorbed provisional + applied ${correctedFieldCount} field(s)`
          : 'review: absorbed a provisional leg (emails + POs copied)',
    })
    await this.recordCalibration({
      shipmentId,
      leg: source,
      outcome: 'corrected',
      correctedFieldCount,
      actorId,
      reasons: ['linked-into-existing'],
    })
    try {
      logAmbiguityPickFromLink({
        sourceShipmentId: shipmentId,
        humanChoiceShipmentId: dto.targetShipmentId,
        actorId,
        criticReview: (source.criticReview ?? null) as CriticReview | null,
      })
    } catch {
      /* never fail link */
    }
    return { ok: true as const, targetShipmentId: dto.targetShipmentId }
  }

  /** Bulk "not a trackable shipment": stamp dismissed_at so the leg leaves the review queue WITHOUT
   *  vouching for its data. reviewStatus stays 'provisional' (confirmed would enter alerts/automation)
   *  and NO confirm-sentinels are posted (approving noise would poison the queue's learning feed).
   *  Sticky by design: the committer never touches dismissed_at, so a recurring portal echo does not
   *  resurface daily. Rows that are not pending provisional SHIPMENTs are skipped, not errors — the
   *  queue may have moved under a stale selection. */
  async dismiss(shipmentIds: string[], actorId: string, note?: string) {
    let dismissed = 0
    for (const id of shipmentIds) {
      const leg = await this.shipments.findById(id)
      if (!leg || leg.kind !== 'SHIPMENT' || leg.reviewStatus !== 'provisional' || leg.dismissedAt != null) continue
      // Clears any waiting stamp too: rejecting a parked leg is a verdict, and it must not keep
      // counting toward Waiting (nor re-park itself if the dismiss is later restored).
      await this.shipments.updateLeg(id, {
        dismissedAt: new Date(), reviewedBy: actorId, reviewedAt: new Date(),
        waitingAt: null, waitingReason: null,
      })
      await this.audit.write({
        entityType: 'shipment', entityId: id, field: null,
        oldValue: 'provisional', newValue: 'dismissed', changeType: 'update',
        sourceType: 'review', actorUserId: actorId,
        note: note?.trim() ? `review: dismissed — ${note.trim()}` : 'review: dismissed — not a trackable shipment',
      })
      await this.recordCalibration({
        shipmentId: id, leg, outcome: 'dismissed', correctedFieldCount: 0, actorId,
        reasons: note?.trim() ? [note.trim()] : null,
      })
      dismissed += 1
    }
    return { dismissed }
  }

  /**
   * "Parked — I have to go and ask": stamp waiting_at so the leg leaves the ACTIVE desk without
   * anyone pretending to have answered it. The third honest outcome beside confirm and dismiss —
   * the desk previously had only "yes" and "no", so a question whose answer lived outside the system
   * (is this thin mail real freight? who is this customer?) either rotted in Active or got dismissed
   * as noise when it might have been real.
   *
   * Like dismiss: reviewStatus stays 'provisional', no confirm-sentinels reach the queue's learning
   * feed (nobody vouched for the data), and the committer never clears the stamp — so a later email on
   * the same leg does NOT silently un-park it. Unlike dismiss it is not a verdict, so no calibration
   * outcome is recorded: there is nothing yet to score the agent against.
   *
   * Reversed by restore(), the same way a dismiss is.
   */
  async wait(shipmentId: string, actorId: string, reason?: string) {
    const leg = await this.shipments.findById(shipmentId)
    if (!leg) throw new NotFoundException(`shipment ${shipmentId} not found`)
    if (leg.kind !== 'SHIPMENT') throw new BadRequestException('only shipment legs can be parked')
    if (leg.reviewStatus !== 'provisional' || leg.dismissedAt != null) {
      // Already answered (confirmed) or already off the desk (dismissed) — nothing to park.
      return { shipmentId, waiting: false as const }
    }
    const trimmed = reason?.trim() || null
    await this.shipments.updateLeg(shipmentId, {
      waitingAt: new Date(),
      // Re-parking replaces the reason rather than appending: the note answers "what am I waiting for
      // NOW", and a stale first reason is worse than none. The history keeps every one via audit.
      waitingReason: trimmed,
    })
    await this.audit.write({
      entityType: 'shipment', entityId: shipmentId, field: null,
      oldValue: 'provisional', newValue: 'waiting', changeType: 'update',
      sourceType: 'review', actorUserId: actorId,
      note: trimmed ? `review: parked as waiting — ${trimmed}` : 'review: parked as waiting',
    })
    return { shipmentId, waiting: true as const }
  }

  /** Undo a dismiss OR un-park a waiting leg: either way the leg returns to the ACTIVE review queue.
   *  One reversal for both stamps — from the operator's side "put it back on my desk" is one idea, and
   *  a leg that was parked and then rejected needs a single button that undoes both. */
  async restore(shipmentId: string, actorId: string) {
    const leg = await this.shipments.findById(shipmentId)
    if (!leg) throw new NotFoundException(`shipment ${shipmentId} not found`)
    const wasDismissed = leg.dismissedAt != null
    const wasWaiting = leg.waitingAt != null
    if (!wasDismissed && !wasWaiting) return { shipmentId, restored: false }
    await this.shipments.updateLeg(shipmentId, {
      ...(wasDismissed ? { dismissedAt: null } : {}),
      ...(wasWaiting ? { waitingAt: null, waitingReason: null } : {}),
    })
    await this.audit.write({
      entityType: 'shipment', entityId: shipmentId, field: null,
      oldValue: wasDismissed ? 'dismissed' : 'waiting', newValue: 'provisional', changeType: 'update',
      sourceType: 'review', actorUserId: actorId, note: 'review: restored to queue',
    })
    return { shipmentId, restored: true }
  }
}
