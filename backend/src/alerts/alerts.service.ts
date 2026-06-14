import { Injectable, NotFoundException } from '@nestjs/common'
import { AlertRepository } from '../db/repositories/alert.repository'

@Injectable()
export class AlertsService {
  constructor(private readonly repo: AlertRepository) {}

  list(status?: string) {
    return this.repo.list(status)
  }
  rules() {
    return this.repo.allRules()
  }
  dismiss(id: string) {
    return this.setStatus(id, 'DISMISSED', { dismissedAt: new Date() })
  }
  resolve(id: string) {
    return this.setStatus(id, 'RESOLVED', { resolvedAt: new Date() })
  }
  snooze(id: string, until: Date) {
    return this.setStatus(id, 'SNOOZED', { snoozedUntil: until })
  }

  private async setStatus(id: string, status: string, extra: Record<string, unknown>) {
    const row = await this.repo.setStatus(id, status, extra)
    if (!row) throw new NotFoundException(`alert ${id} not found`)
    return row
  }
}
