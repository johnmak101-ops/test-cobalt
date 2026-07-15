import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common'
import { ShipmentRepository } from '../db/repositories/shipment.repository'
import { BookingRepository } from '../db/repositories/booking.repository'
import { FieldLockRepository } from '../db/repositories/field-lock.repository'
import { AuditRepository } from '../db/repositories/audit.repository'
import { CommitterService, type ReconGroup } from '../reconcile/committer.service'
import { strongKeys, keysOverlap, normKey, str } from '../reconcile/match-keys'
import { deriveRoute } from '../presentation/adapters/derive'
import { syncIdentityMatchKeys } from './identity-keys'

/** A human-entered new-shipment form. Every field optional; at least one identity OR a PO is required. */
export interface ManualShipmentInput {
  bookingNo?: string; soNo?: string; hblAwbFcrNo?: string; mbl?: string; containerNo?: string; scacCode?: string
  customerCode?: string; vendorCode?: string; forwarderName?: string; pol?: string; pod?: string; mode?: string
  qty?: number | string; qtyUnit?: string; grossWeight?: number | string; measurement?: number | string
  itemStyleNo?: string; htsCode?: string; consigneeName?: string; consigneeAddress?: string
  vesselName?: string; voyageNo?: string
  cargoReadyDate?: string; warehouseStartDate?: string; warehouseEndDate?: string
  etd?: string; atd?: string; eta?: string; ata?: string; inDcDate?: string
  pos?: string[]; note?: string
}

/** dto key → committer parser field → leg column (null = master-resolved, so committed but not lock-per-column). */
const CREATE_FIELD_MAP: { dto: keyof ManualShipmentInput; parser: string; leg: string | null }[] = [
  { dto: 'bookingNo', parser: 'booking_no', leg: 'bookingNo' },
  { dto: 'soNo', parser: 'so_no', leg: 'soNo' },
  { dto: 'hblAwbFcrNo', parser: 'hbl_awb_fcr_no', leg: 'hblAwbFcrNo' },
  { dto: 'mbl', parser: 'mbl', leg: 'mbl' },
  { dto: 'containerNo', parser: 'container_no', leg: 'containerNo' },
  { dto: 'scacCode', parser: 'scac_code', leg: 'scacCode' },
  { dto: 'customerCode', parser: 'customer_code', leg: null },
  { dto: 'vendorCode', parser: 'vendor_code', leg: null },
  { dto: 'forwarderName', parser: 'forwarder_name', leg: null },
  { dto: 'pol', parser: 'pol', leg: null },
  { dto: 'pod', parser: 'pod', leg: null },
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
  { dto: 'cargoReadyDate', parser: 'cargo_ready_date', leg: 'cargoReadyDate' },
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

// Human-editable leg columns (DB names). Excludes computed/master-resolved fields (customer/forwarder/route/
// ports) which need lookups, and identity plumbing. Same coercion the review flow uses.
const DATE_FIELDS = new Set(['cargoReadyDate', 'cfsCutoff', 'warehouseStartDate', 'warehouseEndDate', 'etd', 'atd', 'eta', 'ata', 'inDcDate'])
const NUMERIC_FIELDS = new Set(['qty', 'grossWeight', 'measurement'])
const EDITABLE_FIELDS = new Set([
  'bookingNo', 'soNo', 'hblAwbFcrNo', 'mbl', 'containerNo', 'scacCode',
  'qty', 'qtyUnit', 'grossWeight', 'measurement', 'itemStyleNo', 'htsCode',
  'consigneeName', 'consigneeAddress', 'vesselName', 'voyageNo',
  ...DATE_FIELDS,
])
function coerceField(field: string, value: unknown): unknown {
  if (value == null || value === '') return null
  if (DATE_FIELDS.has(field)) { const d = new Date(String(value)); return Number.isNaN(d.getTime()) ? null : d }
  if (NUMERIC_FIELDS.has(field)) { const n = Number(value); return Number.isFinite(n) ? n : null }
  return String(value)
}
const asStr = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v))

@Injectable()
export class ShipmentsService {
  constructor(
    private readonly shipments: ShipmentRepository,
    private readonly bookings: BookingRepository,
    private readonly fieldLocks: FieldLockRepository,
    private readonly audit: AuditRepository,
    private readonly committer: CommitterService,
  ) {}

  /**
   * Create a shipment a human entered by hand (the pipeline never saw it — e.g. the original booking email
   * / attachment was never ingested). It is minted THROUGH the deterministic committer so it gains match-keys
   * (a later agent email upserts into it by booking/SO/HBL/… instead of spawning a duplicate), audit, and the
   * same shape as pipeline legs. Every field the human actually supplied is then LOCKED (human-wins), so the
   * agent later FILLS gaps but never overwrites a human value. Lands `provisional` → the Review queue.
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
    }
    const res = await this.committer.apply(group)

    // human-wins: lock each field the human actually supplied (agent may fill NULLs later, never overwrite)
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
   * Human edit of shipment fields from the detail page. Each edited field is written, LOCKED (human-wins,
   * so the parser/committer can never overwrite it), and audited to Change History — the same guarantees the
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
    for (const [field, raw] of Object.entries(fields ?? {})) {
      if (!EDITABLE_FIELDS.has(field)) continue
      const value = coerceField(field, raw)
      if (asStr(current[field]) === asStr(value)) continue // no-op edit — skip lock/audit noise
      await this.shipments.updateLeg(id, { [field]: value })
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
    return { id, edited }
  }

  /**
   * Apply a reviewer's CORRECTED email extraction back onto its shipment. The review queue stored the
   * correction but never reached tracking — this closes that loop. Parser-vocabulary fields (`booking_no`)
   * are mapped to leg columns (`bookingNo`) and routed through editFields, so the correction is written,
   * LOCKED (human-wins — the agent can fill gaps later but never overwrites it), and audited with the
   * reviewer's note (the agent-soul iteration signal). Master-resolved fields (customer/forwarder/ports) are
   * skipped — they need resolution, not a direct write. Returns the edited leg columns.
   */
  async applyExtractionCorrection(shipmentId: string, extraction: Record<string, unknown>, actorId: string | null, note?: string | null) {
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
