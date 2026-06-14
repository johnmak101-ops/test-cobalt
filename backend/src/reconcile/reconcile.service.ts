import { Injectable } from '@nestjs/common'
import { mergeShipment } from './merge'
import { strongKeys, mergeKeys, normKey } from './match-keys'
import { CommitterService, type ReconGroup, type CommitResult } from './committer.service'
import { EvidenceRepository, type EvidenceRow } from '../db/repositories/evidence.repository'

@Injectable()
export class ReconcileService {
  constructor(
    private readonly evidence: EvidenceRepository,
    private readonly committer: CommitterService,
  ) {}

  /** Read all evidence, group into shipments, merge, and commit to tracking. Idempotent. */
  async run(): Promise<{ evidence: number; groups: number; results: CommitResult[] }> {
    const rows = await this.evidence.allWithMessage()
    const groups = this.group(rows)
    const results: CommitResult[] = []
    for (const grp of groups) {
      const emails = grp.map((r) => ({
        receivedAt: iso(r.receivedAt),
        emailType: r.emailType ?? 'Other',
        fields: r.fields ?? {},
        pos: posOf(r),
      }))
      const merged = mergeShipment(emails)
      const g: ReconGroup = {
        fields: merged.fields,
        pos: merged.pos,
        conflicts: merged.conflicts,
        matchKeys: mergeKeys(grp),
        emailTypes: [...new Set(grp.map((r) => r.emailType).filter((t): t is string => !!t))],
        events: grp.map((r) => ({ emailType: r.emailType ?? 'Other', receivedAt: iso(r.receivedAt) })),
        mode: grp.map((r) => r.mode).find((m): m is string => !!m) ?? null,
        conversationId: grp[0].conversationId,
        evidenceIds: grp.map((r) => r.id),
      }
      results.push(await this.committer.apply(g))
    }
    return { evidence: rows.length, groups: groups.length, results }
  }

  /** Connected components over shared conversationId, strong match-key, OR PO. */
  private group(rows: EvidenceRow[]): EvidenceRow[][] {
    const parent = rows.map((_, i) => i)
    const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])))
    const union = (a: number, b: number) => {
      parent[find(a)] = find(b)
    }
    const byConv = new Map<string, number[]>()
    const byKey = new Map<string, number[]>()
    const byPo = new Map<string, number[]>()
    rows.forEach((r, i) => {
      if (r.conversationId) push(byConv, r.conversationId, i)
      for (const k of strongKeys(r.matchKeys)) push(byKey, k, i)
      for (const po of posOf(r)) {
        const n = normKey(po)
        if (n) push(byPo, n, i)
      }
    })
    for (const arr of [...byConv.values(), ...byKey.values(), ...byPo.values()])
      for (let j = 1; j < arr.length; j++) union(arr[0], arr[j])
    const groups = new Map<number, EvidenceRow[]>()
    rows.forEach((r, i) => push2(groups, find(i), r))
    return [...groups.values()]
  }
}

const push = (m: Map<string, number[]>, k: string, v: number) => {
  const a = m.get(k) ?? []
  a.push(v)
  m.set(k, a)
}
const push2 = (m: Map<number, EvidenceRow[]>, k: number, v: EvidenceRow) => {
  const a = m.get(k) ?? []
  a.push(v)
  m.set(k, a)
}
const iso = (d: Date | null): string => (d ? d.toISOString() : '1970-01-01T00:00:00.000Z')

function posOf(r: EvidenceRow): string[] {
  const out = new Set<string>()
  if (r.poNo) out.add(String(r.poNo).trim())
  const cpo = r.fields?.customer_po
  if (cpo) for (const p of String(cpo).split(/[,;/]+/)) if (normKey(p)) out.add(p.trim())
  return [...out]
}
