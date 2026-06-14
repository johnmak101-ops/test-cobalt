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
}
