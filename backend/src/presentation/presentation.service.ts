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
import { toUiShipment, type ShipmentMapperInput, type ShipmentLegRow } from './mappers/shipment.mapper'
import { toUiAlert } from './mappers/alert.mapper'
import { toUiAlertRule } from './mappers/alert-rule.mapper'
import { toUiHistoryEntry } from './mappers/history.mapper'
import { deriveRoute, poNumbersJson } from './adapters/derive'

type Ref = { id: string; code?: string | null; name: string }
type PortRow = { id: string; unlocode?: string | null; country?: string | null }
type BookingRow = { id: string; customerId: string | null; vendorId: string | null }

interface MasterMaps {
  customers: Map<string, Ref>
  vendors: Map<string, Ref>
  forwarders: Map<string, Ref>
  ports: Map<string, PortRow>
}

const AT_RISK = new Set(['AT_RISK', 'DELAYED'])

@Injectable()
export class PresentationService {
  constructor(
    private readonly shipmentRepo: ShipmentRepository,
    private readonly bookingRepo: BookingRepository,
    private readonly mastersRepo: MastersRepository,
    private readonly alertRepo: AlertRepository,
    private readonly auditRepo: AuditRepository,
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
    poNumbers: string[],
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
      poNumbers,
      linkedPOs: poNumbers.map((poNumber) => ({ poNumber, quantity: null })),
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
    const poCache = new Map<string, string[]>()
    const out = []
    for (const leg of legs) {
      if (filter?.forwarderId && leg.forwarderId !== filter.forwarderId) continue
      const booking = bookingsById.get(leg.bookingId) ?? null
      if (filter?.customerId && booking?.customerId !== filter.customerId) continue
      let poNumbers = poCache.get(leg.bookingId)
      if (!poNumbers) {
        poNumbers = await this.bookingRepo.poNumbersFor(leg.bookingId)
        poCache.set(leg.bookingId, poNumbers)
      }
      const ui = toUiShipment(this.assembleInput(leg, booking, maps, poNumbers))
      if (filter?.status && ui.status !== filter.status) continue
      out.push(ui)
    }
    return { shipments: out }
  }

  async shipment(id: string) {
    const leg = await this.shipmentRepo.findById(id)
    if (!leg) throw new NotFoundException('shipment not found')
    const [booking, maps, milestones, alertRows, poNumbers] = await Promise.all([
      this.bookingRepo.findById(leg.bookingId),
      this.masterMaps(),
      this.shipmentRepo.milestonesFor(id),
      this.alertRepo.list(),
      this.bookingRepo.poNumbersFor(leg.bookingId),
    ])
    const base = toUiShipment(this.assembleInput(leg, booking, maps, poNumbers))
    const legAlerts = alertRows.filter((a) => a.shipmentId === id).map((a) => toUiAlert({ alert: a, shipment: null }))
    return { ...base, milestones, emails: [], alerts: legAlerts }
  }

  async shipmentHistory(id: string) {
    const rows = await this.auditRepo.listForEntity('shipment', id)
    return { history: rows.map(toUiHistoryEntry) }
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
    let rows = (await this.mastersRepo.listVendors()) as Array<Ref & { type?: string }>
    if (type) rows = rows.filter((r) => r.type === type)
    return { vendors: PresentationService.search(rows, q).map((v) => ({ id: v.id, name: v.name, code: v.code ?? null })) }
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
    const out = []
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

  // ---- dashboard ----

  async dashboard() {
    const [legs, activeAlerts, maps, bookingRows] = await Promise.all([
      this.shipmentRepo.activeLegs(),
      this.alertRepo.list('ACTIVE'),
      this.masterMaps(),
      this.bookingRepo.listOrdered(),
    ])
    const nonDelivered = legs.filter((l) => l.state !== 'DELIVERED')
    const stats = {
      activeShipments: nonDelivered.length,
      atRiskShipments: nonDelivered.filter((l) => l.riskLevel != null && AT_RISK.has(l.riskLevel)).length,
      criticalAlerts: activeAlerts.filter((a) => a.severity === 'CRITICAL').length,
      newEmails: 0, // Phase 3: queue-message read-state
    }

    const recentAlerts = []
    for (const a of activeAlerts.slice(0, 5)) {
      const shipment = a.shipmentId ? await this.shipmentSummary(a.shipmentId, maps) : null
      recentAlerts.push(toUiAlert({ alert: a, shipment }))
    }

    const bookingsById = new Map<string, BookingRow>(bookingRows.map((b: BookingRow) => [b.id, b]))
    const recentLegs = [...legs]
      .sort((a, b) => new Date(b.updatedAt as Date).getTime() - new Date(a.updatedAt as Date).getTime())
      .slice(0, 8)
    const recentActivity = []
    for (const leg of recentLegs) {
      const booking = bookingsById.get(leg.bookingId) ?? null
      const poNumbers = await this.bookingRepo.poNumbersFor(leg.bookingId)
      recentActivity.push(toUiShipment(this.assembleInput(leg, booking, maps, poNumbers)))
    }

    return { stats, recentAlerts, recentActivity }
  }
}
