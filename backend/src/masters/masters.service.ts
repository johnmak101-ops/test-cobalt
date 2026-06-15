import { Injectable } from '@nestjs/common'
import { MastersRepository } from '../db/repositories/masters.repository'
import {
  CreateForwarderDto,
  UpdateForwarderDto,
  CreatePortDto,
  UpdatePortDto,
  CreateConsigneeDto,
  UpdateConsigneeDto,
} from './dto'

/** trim → null for empty strings, so a blank form field clears a column instead of storing ''. */
const nn = (s?: string | null): string | null => {
  const t = s?.trim()
  return t ? t : null
}

@Injectable()
export class MastersService {
  constructor(private readonly repo: MastersRepository) {}

  customers() {
    return this.repo.listCustomers()
  }
  vendors() {
    return this.repo.listVendors()
  }
  forwarders() {
    return this.repo.listForwarders()
  }
  ports() {
    return this.repo.listPorts()
  }
  consignees() {
    return this.repo.listConsignees()
  }

  // --- writes (Ops-maintained masters only) ---
  createForwarder(dto: CreateForwarderDto) {
    return this.repo.createForwarder({ code: nn(dto.code), name: dto.name.trim() })
  }
  updateForwarder(id: string, dto: UpdateForwarderDto) {
    const patch: Record<string, unknown> = {}
    if (dto.code !== undefined) patch.code = nn(dto.code)
    if (dto.name !== undefined) patch.name = dto.name.trim()
    return this.repo.updateForwarder(id, patch)
  }

  createPort(dto: CreatePortDto) {
    return this.repo.createPort({
      unlocode: dto.unlocode.trim().toUpperCase(),
      name: dto.name.trim(),
      country: nn(dto.country),
      mode: dto.mode,
    })
  }
  updatePort(id: string, dto: UpdatePortDto) {
    const patch: Record<string, unknown> = {}
    if (dto.name !== undefined) patch.name = dto.name.trim()
    if (dto.country !== undefined) patch.country = nn(dto.country)
    if (dto.mode !== undefined) patch.mode = dto.mode
    return this.repo.updatePort(id, patch)
  }

  createConsignee(dto: CreateConsigneeDto) {
    return this.repo.createConsignee({
      name: dto.name.trim(),
      address: nn(dto.address),
      mapsToCustomerId: nn(dto.mapsToCustomerId),
    })
  }
  updateConsignee(id: string, dto: UpdateConsigneeDto) {
    const patch: Record<string, unknown> = {}
    if (dto.name !== undefined) patch.name = dto.name.trim()
    if (dto.address !== undefined) patch.address = nn(dto.address)
    if (dto.mapsToCustomerId !== undefined) patch.mapsToCustomerId = nn(dto.mapsToCustomerId)
    return this.repo.updateConsignee(id, patch)
  }

  // --- master resolution: curated facts + proposals (the loop) ---
  resolution() {
    return this.repo.listResolution('approved')
  }
  proposals() {
    return this.repo.listResolution('proposed')
  }
  approveProposal(id: string, actorId: string) {
    return this.repo.setProposalStatus(id, 'approved', actorId)
  }
  rejectProposal(id: string, actorId: string) {
    return this.repo.setProposalStatus(id, 'rejected', actorId)
  }

  /**
   * Curator: review the evidence in the loop and PROPOSE master facts (never auto-write the live set).
   * Deterministic baseline — per customer, the dominant consignee + vendor by majority vote; an LLM
   * curator can later replace this behind the same proposals contract. Settled facts aren't re-proposed.
   */
  async curate() {
    const maj = await this.repo.evidenceMajorities()
    const approved = await this.repo.approvedKeys()
    const byCust = new Map<string, { consignee: Map<string, number>; vendor: Map<string, number> }>()
    for (const r of maj) {
      const agg = byCust.get(r.cust) ?? { consignee: new Map<string, number>(), vendor: new Map<string, number>() }
      if (r.consignee) agg.consignee.set(r.consignee, (agg.consignee.get(r.consignee) ?? 0) + r.n)
      if (r.vendor) agg.vendor.set(r.vendor, (agg.vendor.get(r.vendor) ?? 0) + r.n)
      byCust.set(r.cust, agg)
    }
    const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]
    const items: unknown[] = []
    for (const [cust, agg] of byCust) {
      const con = top(agg.consignee)
      if (con && con[1] >= 3 && !approved.has(`consignee_for_customer:${cust.toUpperCase()}`)) {
        const p = await this.repo.createProposal({ kind: 'consignee_for_customer', lhs: cust, rhs: con[0], reason: `dominant consignee across ${con[1]} emails`, evidence: { count: con[1] } })
        if (p) items.push(p)
      }
      const ven = top(agg.vendor)
      if (ven && ven[1] >= 3 && !approved.has(`customer_vendor:${cust.toUpperCase()}`)) {
        const p = await this.repo.createProposal({ kind: 'customer_vendor', lhs: cust, rhs: ven[0], reason: `dominant vendor across ${ven[1]} emails`, evidence: { count: ven[1] } })
        if (p) items.push(p)
      }
    }
    return { proposed: items.length, items }
  }
}
