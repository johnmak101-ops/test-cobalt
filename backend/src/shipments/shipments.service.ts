import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common'
import { ShipmentRepository } from '../db/repositories/shipment.repository'
import { MastersRepository } from '../db/repositories/masters.repository'
import { BookingRepository } from '../db/repositories/booking.repository'
import { FieldLockRepository } from '../db/repositories/field-lock.repository'
import { AuditRepository } from '../db/repositories/audit.repository'
import { CommitterService, type ReconGroup } from '../reconcile/committer.service'
import { strongKeys, keysOverlap, normKey, str } from '../reconcile/match-keys'
import { deriveRoute } from '../presentation/adapters/derive'
import { syncIdentityMatchKeys } from './identity-keys'
import { coerceLegField, DATE_FIELDS } from './coerce-field'
import { QueueLearningClient } from '../review/queue-learning.client'
import { queueLearningValue } from '../review/queue-field-value'

/** A human-entered new-shipment form. Every field optional; at least one identity OR a PO is required. */
export interface ManualShipmentInput {
  bookingNo?: string; soNo?: string; warehouseSo?: string; hblAwbFcrNo?: string; mbl?: string; containerNo?: string; scacCode?: string
  customerCode?: string; vendorCode?: string; forwarderName?: string; pol?: string; pod?: string; mode?: string
  qty?: number | string; qtyUnit?: string; grossWeight?: number | string; measurement?: number | string
  itemStyleNo?: string; htsCode?: string; consigneeName?: string; consigneeAddress?: string
  vesselName?: string; voyageNo?: string; flightNo?: string; mawb?: string
  cargoReadyDate?: string; cfsCutoff?: string; warehouseStartDate?: string; warehouseEndDate?: string
  etd?: string; atd?: string; eta?: string; ata?: string; inDcDate?: string
  pos?: string[]; note?: string
}

/** dto key → committer parser field → leg column (null = master-resolved, so committed but not lock-per-column). */
const CREATE_FIELD_MAP: { dto: keyof ManualShipmentInput; parser: string; leg: string | null }[] = [
  { dto: 'bookingNo', parser: 'booking_no', leg: 'bookingNo' },
  { dto: 'soNo', parser: 'so_no', leg: 'soNo' },
  { dto: 'warehouseSo', parser: 'warehouse_so', leg: 'warehouseSo' },
  { dto: 'hblAwbFcrNo', parser: 'hbl_awb_fcr_no', leg: 'hblAwbFcrNo' },
  { dto: 'mbl', parser: 'mbl', leg: 'mbl' },
  { dto: 'containerNo', parser: 'container_no', leg: 'containerNo' },
  { dto: 'scacCode', parser: 'scac_code', leg: 'scacCode' },
  { dto: 'customerCode', parser: 'customer_code', leg: null },
  { dto: 'vendorCode', parser: 'vendor_code', leg: null },
  { dto: 'forwarderName', parser: 'forwarder_name', leg: null },
  { dto: 'pol', parser: 'pol', leg: null },
  { dto: 'pod', parser: 'pod', leg: null },
  { dto: 'mode', parser: 'mode', leg: 'mode' },
  { dto: 'qty', parser: 'qty', leg: 'qty' },
  { dto: 'qtyUnit', parser: 'qty_unit', leg: 'qtyUnit' },
  { dto: 'grossWeight', parser: 'gross_weight', leg: 'grossWeight' },
  { dto: 'measurement', parser: 'measurement', leg: 'measurement' },
  { dto: 'itemStyleNo', parser: 'item_style_no', leg: 'itemStyleNo' },
  { dto: 'htsCode', parser: 'hts_code', leg: 'htsCode' },
  { dto: 'consigneeName', parser: 'consignee_name', leg: 'consigneeName' },
  { dto: 'consigneeAddress', parser: 'consignee_address', leg: 'consigneeAddress' },
  { dto: 'vesselName', parser: 'vessel_name', leg: 'vesselName' },
  { dto: 'voyageNo', parser: 'voyage_no', leg: 'voyageNo' },
  { dto: 'flightNo', parser: 'flight_no', leg: 'flightNo' },
  { dto: 'mawb', parser: 'mawb', leg: 'mawb' },
  { dto: 'cargoReadyDate', parser: 'cargo_ready_date', leg: 'cargoReadyDate' },
  // CFS cut-off was editable on the detail page but absent here, so the one form meant to capture a
  // booking the pipeline missed could not record the deadline that booking is about.
  { dto: 'cfsCutoff', parser: 'cfs_cutoff', leg: 'cfsCutoff' },
  { dto: 'warehouseStartDate', parser: 'warehouse_start_date', leg: 'warehouseStartDate' },
  { dto: 'warehouseEndDate', parser: 'warehouse_end_date', leg: 'warehouseEndDate' },
  { dto: 'etd', parser: 'etd', leg: 'etd' },
  { dto: 'atd', parser: 'atd', leg: 'atd' },
  { dto: 'eta', parser: 'eta', leg: 'eta' },
  { dto: 'ata', parser: 'ata', leg: 'ata' },
  { dto: 'inDcDate', parser: 'in_dc_date', leg: 'inDcDate' },
]
const STRONG_DTO = new Set(['bookingNo', 'soNo', 'hblAwbFcrNo', 'mbl', 'containerNo'])

// parser field (email-extraction vocabulary, e.g. `booking_no`) → editable leg column (`bookingNo`). Built
// from CREATE_FIELD_MAP's non-null legs, so master-resolved fields (customer/vendor/forwarder/ports — leg=null)
// are intentionally absent: they need resolution, not a direct column write, and are skipped by apply-back.
const PARSER_TO_LEG: Record<string, string> = Object.fromEntries(
  CREATE_FIELD_MAP.filter((m) => m.leg).map((m) => [m.parser, m.leg as string]),
)

// Human-editable leg columns (DB names). The master FK columns (customerId/vendorId/forwarderId/portId)
// stay out — those are set by resolution, never a direct write. But the *raw* twins are editable free
// text: mode + polRaw/podRaw/forwarderRaw/customerRaw/vendorRaw let operators fix extraction without a
// Mesh write (#183). customer/vendorRaw are the stand-in when no master resolves — Mesh syncs ~every 2
// months, so the raw column holds the correct party until then (a resolved master still wins display).
const EDITABLE_FIELDS = new Set([
  'bookingNo', 'soNo', 'warehouseSo', 'hblAwbFcrNo', 'mbl', 'containerNo', 'scacCode',
  'qty', 'qtyUnit', 'grossWeight', 'measurement', 'itemStyleNo', 'htsCode',
  'mode', 'polRaw', 'podRaw', 'forwarderRaw', 'customerRaw', 'vendorRaw',
  'consigneeName', 'consigneeAddress', 'vesselName', 'voyageNo', 'flightNo', 'mawb',
  ...DATE_FIELDS,
])
const asStr = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v))

/**
 * #236 P3 — identity-class columns from the Order Details edit form that feed the queue learning loop.
 * Dates / qty / free-text parties stay out until an explicit intent marker (noise firewall).
 * Must stay a subset of EDITABLE_FIELDS.
 */
const LEARNING_IDENTITY_FIELDS = new Set([
  'bookingNo',
  'soNo',
  'warehouseSo',
  'hblAwbFcrNo',
  'mbl',
  'containerNo',
  'mawb',
  'scacCode',
])

/** Leg camelCase → queue parse-field snake_case (same as ReviewService.toQueueField). */
const toQueueField = (col: string): string => col.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()

@Injectable()
export class ShipmentsService {
  private readonly logger = new Logger(ShipmentsService.name)

  constructor(
    private readonly shipments: ShipmentRepository,
    private readonly bookings: BookingRepository,
    private readonly fieldLocks: FieldLockRepository,
    private readonly audit: AuditRepository,
    private readonly committer: CommitterService,
    private readonly queueLearning: QueueLearningClient,
    private readonly masters: MastersRepository,
  ) {}

  /**
   * Create a shipment a human entered by hand (the pipeline never saw it — e.g. the original booking email
   * / attachment was never ingested). It is minted THROUGH the deterministic committer so it gains match-keys
   * (a later agent email upserts into it by booking/SO/HBL/… instead of spawning a duplicate), audit, and the
   * same shape as pipeline legs. Every field the human actually supplied is then LOCKED — which RECORDS the
   * entered value, it does not fence the agent off it (latest-email-wins since PR #232): a later email that
   * disagrees writes the column and the field surfaces as CONTESTED. Lands `provisional` → the Review queue.
   */
  async createManual(input: ManualShipmentInput, actorId: string | null) {
    const d = input as Record<string, unknown>
    const val = (k: string): unknown => {
      const v = d[k]
      return v == null || v === '' ? null : v
    }

    const matchKeys: Record<string, unknown> = {}
    const fields: Record<string, unknown> = {}
    for (const m of CREATE_FIELD_MAP) {
      const v = val(m.dto)
      if (v == null) continue
      // Same human-input gate as editFields (numeric + SCAC/container format). createManual is human-only
      // (POST /shipments), so this rejects a person's typo before the committer — the agent's write path
      // never comes through here, so gating it does not violate the de-correction principle.
      coerceLegField(m.dto, v)
      fields[m.parser] = v
      if (STRONG_DTO.has(m.dto)) matchKeys[m.parser] = String(v)
    }
    const pos = Array.isArray(d.pos) ? (d.pos as unknown[]).map((p) => String(p).trim()).filter(Boolean) : []
    if (!Object.keys(matchKeys).length && !pos.length) {
      throw new BadRequestException('a manual shipment needs at least one identity (booking / SO / HBL / MBL / container) or a PO')
    }

    const group: ReconGroup = {
      fields,
      pos,
      matchKeys,
      emailTypes: [],
      events: [],
      mode: (val('mode') as string | null) ?? null,
      conversationId: null,
      conflicts: [],
      evidenceIds: [],
      reviewStatus: 'provisional',
      fromPlatform: false,
      // 0028 — stamp the leg as hand-typed. Two committer rules read it and stop acting automatically:
      // a later email sharing this leg's PO but naming a different id no longer mints a silent duplicate
      // (it reports one), and a conflicting re-key no longer dismisses this row out from under the
      // operator's field locks. See findPoOnlyDuplicateRisk / findManualIdentityClash.
      createdManually: true,
    }
    const res = await this.committer.apply(group)

    // Record each field the human actually supplied. NOT a write barrier — a later email may overwrite the
    // column, and this surviving row is exactly what makes that divergence visible as contested.
    const leg = (await this.shipments.findById(res.shipmentId)) as Record<string, unknown> | null
    for (const m of CREATE_FIELD_MAP) {
      if (m.leg && val(m.dto) != null && leg && leg[m.leg] != null) {
        await this.fieldLocks.lock('shipment', res.shipmentId, m.leg, asStr(leg[m.leg]), actorId)
      }
    }
    await this.audit.write({
      entityType: 'shipment', entityId: res.shipmentId, field: 'created', oldValue: null, newValue: 'manual',
      changeType: 'create', sourceType: 'manual', actorUserId: actorId,
      note: String(d.note ?? '').trim() || 'shipment manually created',
    })
    return { id: res.shipmentId, jobNo: res.jobNo, state: res.state, action: res.action }
  }

  /**
   * Human edit of shipment fields from the detail page. Each edited field is written, LOCKED (the lock keeps
   * the human's value on record; the parser/committer may still overwrite the COLUMN, which is what makes the
   * field contested — see FieldLockRepository), and audited to Change History — the same guarantees the
   * review flow gives, but for any shipment and without changing its review status. Unknown/non-editable
   * fields are ignored (whitelist). `actorId` is the acting user for the lock + audit trail.
   */
  async editFields(id: string, fields: Record<string, unknown>, actorId: string | null, note?: string | null) {
    const leg = await this.shipments.findById(id)
    if (!leg) throw new NotFoundException(`shipment ${id} not found`)
    const current = leg as Record<string, unknown>
    // The human's note is REQUIRED by the edit UI and harvested for agent-soul iteration — persist it on
    // every audited change so each correction carries the "why". Falls back to the generic marker only for
    // legacy/no-note callers (the UI blocks a note-less save).
    const feedback = (note ?? '').trim() || 'edited on shipment detail'
    const edited: string[] = []
    const editedValues: Record<string, unknown> = {}
    // Coerce + sanity-gate EVERY field up front, so one bad value (e.g. a negative quantity) rejects the
    // whole edit with a 400 before anything is written — no partial save, no orphaned lock/audit row.
    const coerced = Object.entries(fields ?? {})
      .filter(([field]) => EDITABLE_FIELDS.has(field))
      .map(([field, raw]) => [field, coerceLegField(field, raw)] as const)
    for (const [field, value] of coerced) {
      if (asStr(current[field]) === asStr(value)) continue // no-op edit — skip lock/audit noise
      const patch: Record<string, unknown> = { [field]: value }
      // A human port edit must carry the master FK with it: route (and the port label) derive from
      // polCode ?? polRaw, so a stale pol_id would keep winning over the operator's new port. The
      // picker emits UN/LOCODEs (strict lookup); free text or no match unlinks the master and the
      // raw value drives display until resolution catches up.
      if (field === 'polRaw' || field === 'podRaw') {
        const fk = field === 'polRaw' ? 'polId' : 'podId'
        patch[fk] = value == null ? null : await this.masters.portIdByUnlocode(String(value))
      }
      // Same stale-FK class for the forwarder: display prefers the resolved master, so the human's
      // raw edit re-links it (code or exact name) or unlinks it — never leaves the old master winning.
      if (field === 'forwarderRaw') {
        patch.forwarderId = value == null ? null : await this.masters.forwarderIdExact(String(value))
      }
      await this.shipments.updateLeg(id, patch)
      // Customer/Vendor masters hang off the BOOKING, not the leg — re-point (or unlink) there.
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
      await this.fieldLocks.lock('shipment', id, field, asStr(value), actorId)
      await this.audit.write({
        entityType: 'shipment', entityId: id, field,
        oldValue: asStr(current[field]), newValue: asStr(value), changeType: 'update',
        sourceType: 'manual', actorUserId: actorId, note: feedback,
      })
      edited.push(field)
      editedValues[field] = value
    }
    await syncIdentityMatchKeys(this.shipments, id, editedValues)
    // #236 P3: feed identity-class detail edits to the queue Iterator (best-effort). Dates/qty excluded.
    await this.emitIdentityLearning(id, current, editedValues, feedback)
    return { id, edited }
  }

  /**
   * Push identity-class Order Details edits to queue POST /review/correction.
   * Skips when no source graph message id (never ship UUID — #236 P2) or field not identity-class.
   */
  private async emitIdentityLearning(
    shipmentId: string,
    before: Record<string, unknown>,
    editedValues: Record<string, unknown>,
    note: string,
  ): Promise<void> {
    const identityEdits = Object.entries(editedValues).filter(([f]) => LEARNING_IDENTITY_FIELDS.has(f))
    if (!identityEdits.length) return
    const messageId = await this.shipments.sourceGraphIdFor(shipmentId)
    if (!messageId) {
      this.logger.error(
        `QUEUE LEARNING SKIPPED (detail edit) — no source graph message id for shipment=${shipmentId}; identity fields=[${identityEdits.map(([f]) => f).join(',')}]`,
      )
      return
    }
    const forwarder = (before.forwarderRaw as string | null | undefined) ?? null
    for (const [field, value] of identityEdits) {
      await this.queueLearning.postCorrection({
        messageId,
        field: toQueueField(field),
        // queueLearningValue, not asStr: LEARNING_IDENTITY_FIELDS carries no date today, but the day it
        // does, asStr would post an ISO string the parser can never reproduce (see queue-field-value).
        agentSaid: queueLearningValue(field, before[field]),
        humanCorrected: queueLearningValue(field, value),
        forwarder,
        note: note || 'edited on shipment detail',
        kind: 'correction',
      })
    }
  }

  /**
   * Fields where a NEWER email overrode a human edit: the lock still holds the human value but the leg
   * column now differs (the committer applied the fresher value). Surfaced on the detail page so the user
   * can keep the new value or restore theirs. Derived from persisted state — no transient signal needed.
   */
  async contestedLocks(
    id: string,
  ): Promise<{ field: string; yourValue: string | null; newValue: string | null }[]> {
    const leg = await this.shipments.findById(id)
    if (!leg) return []
    const row = leg as Record<string, unknown>
    const locks = await this.fieldLocks.forEntity(id)
    return locks
      .filter((l) => l.entityType === 'shipment')
      .map((l) => ({ field: l.field, yourValue: l.lockedValue, newValue: asStr(row[l.field]) }))
      .filter((c) => c.newValue !== c.yourValue)
  }

  /** Human-locked leg columns (manual/review edits). The detail page treats these as settled —
   *  the unconfirmed-answer mask never applies to them. */
  async lockedFields(id: string): Promise<string[]> {
    const locks = await this.fieldLocks.forEntity(id)
    return locks.filter((l) => l.entityType === 'shipment').map((l) => l.field)
  }

  /**
   * Resolve a contested lock by KEEPING the newer email value: relock the field to the current column
   * value so `column === lock` again (no longer contested), and audit the acceptance.
   */
  async keepNewLockValue(id: string, field: string, actorId: string | null) {
    if (!EDITABLE_FIELDS.has(field)) throw new BadRequestException(`field ${field} is not editable`)
    const leg = await this.shipments.findById(id)
    if (!leg) throw new NotFoundException(`shipment ${id} not found`)
    const locks = await this.fieldLocks.forEntity(id)
    const lock = locks.find((l) => l.entityType === 'shipment' && l.field === field)
    if (!lock) throw new NotFoundException(`no lock on field ${field}`)
    const current = asStr((leg as Record<string, unknown>)[field])
    await this.fieldLocks.lock('shipment', id, field, current, actorId)
    await this.audit.write({
      entityType: 'shipment', entityId: id, field,
      oldValue: lock.lockedValue, newValue: current, changeType: 'update',
      sourceType: 'manual', actorUserId: actorId, note: 'accepted the newer email value over your edit',
    })
    return { id, field, resolved: 'keep-new' as const }
  }

  /**
   * Resolve a contested lock by RESTORING the human edit: write the locked value back to the column so
   * `column === lock` again (no longer contested), and audit the restore. The lock row is unchanged.
   */
  async restoreLockValue(id: string, field: string, actorId: string | null) {
    if (!EDITABLE_FIELDS.has(field)) throw new BadRequestException(`field ${field} is not editable`)
    const leg = await this.shipments.findById(id)
    if (!leg) throw new NotFoundException(`shipment ${id} not found`)
    const locks = await this.fieldLocks.forEntity(id)
    const lock = locks.find((l) => l.entityType === 'shipment' && l.field === field)
    if (!lock) throw new NotFoundException(`no lock on field ${field}`)
    const current = asStr((leg as Record<string, unknown>)[field])
    await this.shipments.updateLeg(id, { [field]: coerceLegField(field, lock.lockedValue) })
    await this.audit.write({
      entityType: 'shipment', entityId: id, field,
      oldValue: current, newValue: lock.lockedValue, changeType: 'update',
      sourceType: 'manual', actorUserId: actorId, note: 'restored your edit over a newer email value',
    })
    return { id, field, resolved: 'restore' as const }
  }

  /**
   * Apply a reviewer's CORRECTED email extraction back onto its shipment. The review queue stored the
   * correction but never reached tracking — this closes that loop. Parser-vocabulary fields (`booking_no`)
   * are mapped to leg columns (`bookingNo`) and routed through editFields, so the correction is written,
   * LOCKED (the reviewer's value is kept on record; a later email may still overwrite the column and the
   * field then reads as contested), and audited with the
   * reviewer's note (the agent-soul iteration signal). Master-resolved fields (customer/forwarder/ports) are
   * skipped — they need resolution, not a direct write. Returns the edited leg columns.
   */
  applyExtractionCorrection(shipmentId: string, extraction: Record<string, unknown>, actorId: string | null, note?: string | null) {
    const legFields: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(extraction ?? {})) {
      const leg = PARSER_TO_LEG[k]
      if (leg) legFields[leg] = v
    }
    return this.editFields(shipmentId, legFields, actorId, note)
  }

  /** A single leg, enriched like the tracker list (customer / forwarder / route / linked POs) + timeline. */
  async getOne(id: string) {
    const leg = await this.shipments.legDetailById(id)
    if (!leg) throw new NotFoundException(`shipment ${id} not found`)
    const [milestones, legPos, identifiers, siblings] = await Promise.all([
      this.shipments.milestonesFor(id),
      this.shipments.linkedPosForShipment(id),
      this.shipments.identifiersFor(id),
      this.shipments.legsForBooking(leg.bookingId),
    ])
    // #151: prefer per-leg shipment_pos; fall back to booking_pos only when the leg has no PO links (legacy).
    const pos =
      legPos.length > 0 ? legPos : await this.shipments.linkedPosForBooking(leg.bookingId)
    const legNo = (leg as { legNo?: number | null }).legNo ?? 1
    const legCount = siblings.length
    return {
      id: leg.id,
      bookingId: leg.bookingId,
      legNo,
      legCount,
      jobNo: leg.jobNo,
      bookingNo: leg.bookingNo ?? leg.containerNo ?? leg.hblAwbFcrNo ?? leg.soNo ?? leg.jobNo,
      soNo: leg.soNo,
      hblAwbFcrNo: leg.hblAwbFcrNo,
      mbl: leg.mbl,
      containerNo: leg.containerNo,
      mode: leg.mode,
      state: leg.state,
      legStatus: leg.legStatus,
      riskLevel: leg.riskLevel,
      reviewStatus: leg.reviewStatus,
      confidence: leg.confidence,
      reviewReasons: leg.reviewReasons,
      etd: leg.etd,
      atd: leg.atd,
      eta: leg.eta,
      updatedAt: leg.updatedAt,
      route: deriveRoute(leg.polCode ?? leg.polRaw, leg.podCode ?? leg.podRaw),
      customer: leg.customerId ? { id: leg.customerId, name: leg.customerName, code: leg.customerCode } : null,
      forwarder: leg.forwarderId ? { id: leg.forwarderId, name: leg.forwarderName } : leg.forwarderRaw ? { id: '', name: leg.forwarderRaw } : null,
      pos: pos.map((p) => ({
        id: p.id,
        poNumber: p.poNumber,
        totalQuantity: p.totalQuantity,
        quantityUnit: p.quantityUnit,
        vendor: p.vendorName ? { name: p.vendorName } : null,
      })),
      milestones,
      // every value each identity field ever held (current + superseded/conflict alternates)
      identifiers: identifiers.map((x) => ({
        type: x.type,
        value: x.value,
        docType: x.docType,
        isCurrent: x.isCurrent,
        sourceEmailId: x.sourceEmailId,
      })),
    }
  }

  /** Shipment Tracker list — active legs enriched with customer / forwarder / route / POs / risk. */
  async listForTracker(status?: string) {
    const rows = await this.shipments.legsForTracker(status && status !== 'ALL' ? status : undefined)
    const shipments = await Promise.all(
      rows.map(async (r) => {
        const pos = await this.shipments.linkedPosForBooking(r.bookingId)
        return {
          id: r.id,
          bookingId: r.bookingId,
          // the durable, human-quoted job/process number (stable across rotating forwarder IDs)
          jobNo: r.jobNo,
          // "Shipment ID" display — the most specific identifier carried by this leg
          bookingNo: r.bookingNo ?? r.containerNo ?? r.hblAwbFcrNo ?? r.soNo ?? r.jobNo,
          soNumber: r.soNo,
          hblNumber: r.hblAwbFcrNo,
          containerNo: r.containerNo,
          mblNumber: r.mbl,
          mode: r.mode,
          status: r.status,
          riskLevel: r.riskLevel,
          reviewStatus: r.reviewStatus,
          confidence: r.confidence,
          etd: r.etd,
          eta: r.eta,
          updatedAt: r.updatedAt,
          route: deriveRoute(r.polCode ?? r.polRaw, r.podCode ?? r.podRaw),
          customer: r.customerId ? { id: r.customerId, name: r.customerName, code: r.customerCode } : null,
          forwarder: r.forwarderId ? { id: r.forwarderId, name: r.forwarderName } : r.forwarderRaw ? { id: '', name: r.forwarderRaw } : null,
          linkedPOs: pos.map((p) => ({
            id: p.id,
            poNumber: p.poNumber,
            quantity: null as number | null,
            totalQuantity: p.totalQuantity,
            quantityUnit: p.quantityUnit,
            vendor: p.vendorName ? { name: p.vendorName } : null,
          })),
        }
      }),
    )
    return { shipments }
  }

  /**
   * Matcher read-API: given a strong-key bag (so_no / booking_no / hbl_awb_fcr_no / mbl /
   * container_no + optional customer_po), return candidate legs so the Agent VM can decide
   * update-vs-create and see which fields are human-locked (it must not try to overwrite those).
   * Mirrors the committer's match rule: strong-key overlap OR a shared PO.
   *
   * INCREMENT 3 (Ingest N+1): candidate SUPERSET from the indexed `shipment_match_keys` (0003) ∪
   * `purchase_orders.po_number_norm` (0004) — same path as committer.apply — instead of an allLegs()
   * full-scan. Pure filter over that set is unchanged (strongKeys / shared PO).
   */
  async lookupByMatchKey(q: Record<string, unknown>) {
    const keys = {
      so_no: str(q.so_no),
      booking_no: str(q.booking_no),
      hbl_awb_fcr_no: str(q.hbl_awb_fcr_no),
      mbl: str(q.mbl),
      container_no: str(q.container_no),
      customer_po: str(q.customer_po),
    }
    const gk = strongKeys(keys)
    const poNorm = keys.customer_po ? normKey(keys.customer_po) : null
    if (gk.size === 0 && !poNorm) return { query: keys, candidates: [] as unknown[] }

    // Same strongPairs parse as committer.apply (type:value tokens from strongKeys).
    const strongPairs = [...gk].map((k) => {
      const i = k.indexOf(':')
      return { type: k.slice(0, i), value: k.slice(i + 1) }
    })
    const legs = await this.shipments.candidateLegs(strongPairs, poNorm ? [poNorm] : [])
    // ONE bulk load of every candidate booking's PO numbers (bookingId -> [poNumber]) instead of a per-leg
    // query inside the loop — the old O(N) poNumbersFor round-trips were the dominant cost as shipments grow.
    // Mirrors the committer's match loop; the PO list each leg sees is byte-identical to per-leg poNumbersFor.
    const posByBooking = await this.bookings.poNumbersByBooking(legs.map((l) => l.bookingId))
    const candidates: unknown[] = []
    for (const leg of legs) {
      const pos = posByBooking.get(leg.bookingId) ?? []
      const byKey = gk.size > 0 && keysOverlap(strongKeys(leg.matchKeys as Record<string, unknown>), gk)
      const byPo = !!poNorm && pos.map(normKey).includes(poNorm)
      if (!byKey && !byPo) continue
      const booking = await this.bookings.findById(leg.bookingId)
      const locks = await this.fieldLocks.forEntity(leg.id)
      const lockedFields = locks.filter((l) => l.entityType === 'shipment').map((l) => l.field)
      candidates.push({ ...leg, jobNo: booking?.jobNo ?? null, pos, lockedFields, matchedBy: byKey ? 'strong_key' : 'po' })
    }
    return { query: keys, candidates }
  }
}
