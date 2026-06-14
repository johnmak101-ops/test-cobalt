import { Injectable } from '@nestjs/common'
import { MastersRepository } from '../db/repositories/masters.repository'

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
}
