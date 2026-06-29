/**
 * UI presentation/adapter service: orchestrates the existing (DB-verified) repositories and the
 * pure mappers to produce the flat shapes the new UI expects. Read-only. Adds no new model concepts —
 * one UI "shipment" = one ACTIVE leg + its booking, projected flat.
 */
import { Injectable, NotFoundException } from '@nestjs/common'
import { ShipmentRepository } from '../db/repositories/shipment.repository'
import { BookingRepository } from '../db/repositories/booking.repository'
import { MastersRepository } from '../db/repositories/masters.repository'
import { AlertRepository } from '../db/repositories/alert.repository'
import { AuditRepository } from '../db/repositories/audit.repository'
import { EmailRepository } from '../db/repositories/email.repository'
import { toUiShipment, type ShipmentMapperInput, type ShipmentLegRow } from './mappers/shipment.mapper'
import { toUiAlert } from './mappers/alert.mapper'
import { toUiAlertRule } from './mappers/alert-rule.mapper'
import { toUiHistoryEntry } from './mappers/history.mapper'
import { toUiPurchaseOrder, toUiPurchaseOrderDetail } from './mappers/po.mapper'
import { toUiEmail } from './mappers/email.mapper'
import { deriveRoute, poNumbersJson, isoOrNull } from './adapters/derive'
import { stateToUiStatus } from './adapters/enums'

type Ref = { id: string; code?: string | null; name: string }
type PortRow = { id: string; unlocode?: string | null; country?: string | null }
type BookingRow = { id: string; customerId: string | null; vendorId: string | null }
type LinkedPoRow = { id: string; poNumber: string; totalQuantity: number | null; quantityUnit: string | null; vendorName: string | null }

interface MasterMaps {
  customers: Map<string, Ref>
  vendors: Map<string, Ref>
  forwarders: Map<string, Ref>
  ports: Map<string, PortRow>
}

const AT_RISK = new Set(['AT_RISK', 'DELAYED'])

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
export class PresentationService {
  constructor(
    private readonly shipmentRepo: ShipmentRepository,
    private readonly bookingRepo: BookingRepository,
    private readonly mastersRepo: MastersRepository,
    private readonly alertRepo: AlertRepository,
    private readonly auditRepo: AuditRepository,
    private readonly emailRepo: EmailRepository,
  ) {}

  // ---- shared assembly ----

  private async masterMaps(): Promise<MasterMaps> {
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
  }

  private assembleInput(
    leg: ShipmentLegRow & { bookingId: string; polId?: string | null; podId?: string | null },
    booking: BookingRow | null,
    maps: MasterMaps,
    linkedPos: LinkedPoRow[],
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
      linkedPOs: linkedPos.map((p) => ({
        id: p.id,
        poNumber: p.poNumber,
        totalQuantity: p.totalQuantity ?? null,
        quantityUnit: p.quantityUnit ?? null,
        quantity: null, // per-leg split (shipment_pos) is not surfaced on the flat shipment row
        vendor: p.vendorName ? { name: p.vendorName } : null,
      })),
    }
  }

  private async shipmentSummary(shipmentId: string, maps: MasterMaps) {
    const leg = await this.shipmentRepo.findById(shipmentId)
    if (!leg) return null
    const [booking, poNumbers] = await Promise.all([
      this.bookingRepo.findById(leg.bookingId),
      this.bookingRepo.poNumbersFor(leg.bookingId),
    ])
    const customer = booking?.customerId ? maps.customers.get(booking.customerId) : undefined
    const pol = leg.polId ? maps.ports.get(leg.polId) : undefined
    const pod = leg.podId ? maps.ports.get(leg.podId) : undefined
    return {
      id: leg.id,
      poNumbers: poNumbersJson(poNumbers),
      route: deriveRoute(pol?.unlocode, pod?.unlocode),
      customer: customer ? { name: customer.name } : null,
    }
  }

  // ---- shipments ----

  async shipments(filter?: { status?: string; customerId?: string; forwarderId?: string }) {
    const [legs, bookingRows, maps] = await Promise.all([
      this.shipmentRepo.activeLegs(),
      this.bookingRepo.listOrdered(),
      this.masterMaps(),
    ])
    const bookingsById = new Map<string, BookingRow>(bookingRows.map((b: BookingRow) => [b.id, b]))
    const poCache = new Map<string, LinkedPoRow[]>()
    const out: ReturnType<typeof toUiShipment>[] = []
    for (const leg of legs) {
      if (filter?.forwarderId && leg.forwarderId !== filter.forwarderId) continue
      const booking = bookingsById.get(leg.bookingId) ?? null
      if (filter?.customerId && booking?.customerId !== filter.customerId) continue
      let linkedPos = poCache.get(leg.bookingId)
      if (!linkedPos) {
        linkedPos = (await this.shipmentRepo.linkedPosForBooking(leg.bookingId)) as LinkedPoRow[]
        poCache.set(leg.bookingId, linkedPos)
      }
      const ui = toUiShipment(this.assembleInput(leg, booking, maps, linkedPos))
      if (filter?.status && ui.status !== filter.status) continue
      out.push(ui)
    }
    return { shipments: out }
  }

  async shipment(id: string) {
    const leg = await this.shipmentRepo.findById(id)
    if (!leg) throw new NotFoundException('shipment not found')
    const [booking, maps, milestones, alertRows, linkedPos, relatedEmails] = await Promise.all([
      this.bookingRepo.findById(leg.bookingId),
      this.masterMaps(),
      this.shipmentRepo.milestonesFor(id),
      this.alertRepo.list(),
      this.shipmentRepo.linkedPosForBooking(leg.bookingId) as Promise<LinkedPoRow[]>,
      this.emailRepo.emailsForShipment(id),
    ])
    const base = toUiShipment(this.assembleInput(leg, booking, maps, linkedPos))
    const legAlerts = alertRows.filter((a) => a.shipmentId === id).map((a) => toUiAlert({ alert: a, shipment: null }))
    const emails = relatedEmails.map((e) => ({
      id: e.id,
      subject: e.subject,
      sender: e.sender,
      receivedAt: isoOrNull(e.receivedAt),
      emailType: e.milestoneType ?? null,
    }))
    return { ...base, milestones, emails, alerts: legAlerts }
  }

  async shipmentHistory(id: string) {
    const rows = await this.auditRepo.listForEntity('shipment', id)
    return { history: rows.map(toUiHistoryEntry) }
  }

  // ---- purchase orders (app-owned) ----

  // PO → one linked-shipment row, in the shape the PO list/detail search over (container/SCAC/booking#/vessel).
  private toPoShipmentRow(s: {
    shipmentId: string
    bookingNo: string | null
    status: string | null
    containerNo: string | null
    hbl: string | null
    mbl: string | null
    scacCode: string | null
    vesselName: string | null
    polCode: string | null
    podCode: string | null
  }) {
    return {
      id: s.shipmentId,
      bookingNo: s.bookingNo ?? null,
      route: deriveRoute(s.polCode ?? undefined, s.podCode ?? undefined),
      containerNo: s.containerNo ?? null,
      hblNumber: s.hbl ?? null,
      mblNumber: s.mbl ?? null,
      scacCode: s.scacCode ?? null,
      vesselName: s.vesselName ?? null,
      status: stateToUiStatus(s.status),
    }
  }

  async purchaseOrders(filter?: { customerId?: string; open?: boolean }) {
    const [rows, summaryRows] = await Promise.all([
      this.bookingRepo.listPos(filter?.open ?? false),
      this.bookingRepo.shipmentSummariesByPo(),
    ])
    const summariesByPo = new Map<string, unknown[]>()
    for (const s of summaryRows) {
      const arr = summariesByPo.get(s.poId) ?? []
      arr.push(this.toPoShipmentRow(s))
      summariesByPo.set(s.poId, arr)
    }
    const out = rows
      .filter((r) => !filter?.customerId || r.customerId === filter.customerId)
      .map((r) =>
        toUiPurchaseOrder({
          po: {
            id: r.id, poNumber: r.poNumber, customerId: r.customerId ?? null, vendorId: r.vendorId ?? null,
            totalQuantity: r.totalQuantity ?? null, quantityUnit: r.quantityUnit ?? null, notes: r.notes ?? null,
            createdAt: r.createdAt, updatedAt: r.updatedAt,
          },
          customer: r.customerName || r.customerCode ? { id: r.customerId ?? '', name: r.customerName ?? '', code: r.customerCode ?? null } : null,
          vendor: r.vendorName || r.vendorCode ? { id: r.vendorId ?? '', name: r.vendorName ?? '', code: r.vendorCode ?? null } : null,
          shipmentCount: r.shipmentCount,
          shippedQuantity: r.shippedQuantity,
          shipmentSummary: summariesByPo.get(r.id) ?? [],
        }),
      )
    return { purchaseOrders: out }
  }

  async purchaseOrder(id: string) {
    const detail = await this.bookingRepo.poDetail(id)
    if (!detail) throw new NotFoundException('purchase order not found')
    const { po, links } = detail
    return toUiPurchaseOrderDetail({
      po: {
        id: po.id, poNumber: po.poNumber, customerId: po.customerId ?? null, vendorId: po.vendorId ?? null,
        totalQuantity: po.totalQuantity ?? null, quantityUnit: po.quantityUnit ?? null, notes: po.notes ?? null,
        createdAt: po.createdAt, updatedAt: po.updatedAt,
      },
      customer: po.customerName || po.customerCode ? { id: po.customerId ?? '', name: po.customerName ?? '', code: po.customerCode ?? null } : null,
      vendor: po.vendorName || po.vendorCode ? { id: po.vendorId ?? '', name: po.vendorName ?? '', code: po.vendorCode ?? null } : null,
      shipmentCount: links.length,
      shippedQuantity: links.reduce((s, l) => s + (l.linkedQuantity ?? 0), 0),
      shipmentSummary: links.map((l) =>
        this.toPoShipmentRow({
          shipmentId: l.shipmentId, bookingNo: l.bookingNo, status: l.status, containerNo: l.containerNo,
          hbl: l.hbl, mbl: l.mbl, scacCode: l.scacCode, vesselName: l.vesselName, polCode: l.polCode, podCode: l.podCode,
        }),
      ),
      linkedShipments: links.map((l) => ({
        shipment: {
          leg: {
            id: l.shipmentId, state: l.status, bookingNo: l.bookingNo, soNo: l.so, hblAwbFcrNo: l.hbl,
            etd: l.etd, eta: l.eta, containerNo: l.containerNo, mbl: l.mbl, scacCode: l.scacCode, vesselName: l.vesselName,
          } as unknown as ShipmentLegRow,
          booking: null,
          polPort: l.polCode ? { unlocode: l.polCode } : null,
          podPort: l.podCode ? { unlocode: l.podCode } : null,
          poNumbers: [po.poNumber],
        } as ShipmentMapperInput,
        linkedQuantity: l.linkedQuantity,
        linkId: l.linkId,
        linkedAt: l.linkedAt,
      })),
    })
  }

  // ---- emails / inbox ----

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

  // ---- masters (read-only search) ----

  private static search<T extends { name: string; code?: string | null }>(rows: T[], q?: string): T[] {
    if (!q) return rows
    const needle = q.toLowerCase()
    return rows.filter(
      (r) => r.name?.toLowerCase().includes(needle) || (r.code ?? '').toLowerCase().includes(needle),
    )
  }

  async vendors(q?: string, type?: string) {
    let rows = (await this.mastersRepo.listVendors()) as Array<
      Ref & {
        type?: string | null
        location?: string | null
        contactEmail?: string | null
        contactPhone?: string | null
        notes?: string | null
        createdAt?: Date | string | null
        updatedAt?: Date | string | null
      }
    >
    if (type) rows = rows.filter((r) => r.type === type)
    return {
      vendors: PresentationService.search(rows, q).map((v) => ({
        id: v.id,
        name: v.name,
        code: v.code ?? null, // kept for the type-ahead consumer; the UI Vendor type ignores it
        type: v.type ?? 'factory',
        location: v.location ?? null,
        contactEmail: v.contactEmail ?? null,
        contactPhone: v.contactPhone ?? null,
        notes: v.notes ?? null,
        createdAt: isoOrNull(v.createdAt),
        updatedAt: isoOrNull(v.updatedAt),
      })),
    }
  }

  async forwarders(q?: string) {
    const rows = (await this.mastersRepo.listForwarders()) as Ref[]
    return { forwarders: PresentationService.search(rows, q).map((f) => ({ id: f.id, name: f.name, code: f.code ?? null })) }
  }

  async customers(q?: string) {
    const rows = (await this.mastersRepo.listCustomers()) as Ref[]
    return { customers: PresentationService.search(rows, q).map((c) => ({ id: c.id, name: c.name, code: c.code ?? null })) }
  }

  async consignees(q?: string) {
    const rows = (await this.mastersRepo.listConsignees()) as Array<{ id: string; name: string; address: string | null }>
    return { consignees: PresentationService.search(rows, q).map((c) => ({ id: c.id, name: c.name, address: c.address ?? null })) }
  }

  // ---- alerts ----

  async alerts(status?: string) {
    const [rows, maps] = await Promise.all([this.alertRepo.list(status), this.masterMaps()])
    const out: ReturnType<typeof toUiAlert>[] = []
    for (const a of rows) {
      const shipment = a.shipmentId ? await this.shipmentSummary(a.shipmentId, maps) : null
      out.push(toUiAlert({ alert: a, shipment }))
    }
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
    const [legs, activeAlerts, maps, bookingRows, pendingReview] = await Promise.all([
      this.shipmentRepo.activeLegs(),
      this.alertRepo.list('ACTIVE'),
      this.masterMaps(),
      this.bookingRepo.listOrdered(),
      this.emailRepo.countPendingReview(),
    ])
    const nonDelivered = legs.filter((l) => l.state !== 'DELIVERED')
    const stats = {
      activeShipments: nonDelivered.length,
      atRiskShipments: nonDelivered.filter((l) => l.riskLevel != null && AT_RISK.has(l.riskLevel)).length,
      criticalAlerts: activeAlerts.filter((a) => a.severity === 'CRITICAL').length,
      newEmails: pendingReview, // emails awaiting human review — the actionable "new" count
    }

    const recentAlerts: ReturnType<typeof toUiAlert>[] = []
    for (const a of activeAlerts.slice(0, 5)) {
      const shipment = a.shipmentId ? await this.shipmentSummary(a.shipmentId, maps) : null
      recentAlerts.push(toUiAlert({ alert: a, shipment }))
    }

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
