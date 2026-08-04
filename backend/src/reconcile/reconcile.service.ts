import { ConflictException, Injectable } from '@nestjs/common'
import { mergeShipment } from './merge'
import { scoreReconGroup } from './score'
import { strongKeys, mergeKeys, normKey } from './match-keys'
import { CommitterService, type ReconGroup, type CommitResult } from './committer.service'
import { EvidenceRepository, type EvidenceRow } from '../db/repositories/evidence.repository'
import { DecisionLogRepository } from '../db/repositories/decision-log.repository'
import { SettingsService } from '../settings/settings.service'
import { isNotificationPlatformSender } from './vendor-forwarder-guard'

@Injectable()
export class ReconcileService {
  constructor(
    private readonly evidence: EvidenceRepository,
    private readonly committer: CommitterService,
    private readonly settings: SettingsService,
    private readonly decisionLog: DecisionLogRepository,
  ) {}

  /**
   * Rebuild tracking from what the pipeline already decided. Idempotent.
   *
   * REPLAY FIRST (0032): when the decision log has rows, re-apply them through the committer in
   * arrival order. There is no second grouper or merge in that path — a rebuild reproduces the agent
   * path by construction, divisions included (candrholdings#51's cure).
   *
   * The legacy re-derive below survives ONLY as the fallback for data predating the log — and it is
   * division-blind by design of its era: it unions evidence by shared PO, so a PO that legitimately
   * moved bookings would re-fuse the two shipments it crossed, and its merge twin would resurrect the
   * moved record's stale pod. The guard refuses that combination loudly instead of rebuilding wrong.
   */
  async run(): Promise<{ evidence: number; groups: number; results: CommitResult[]; mode: 'replay' | 'derive' }> {
    const logged = await this.decisionLog.allInOrder()
    if (logged.length) {
      const results: CommitResult[] = []
      for (const row of logged) {
        // ParseJSONResultsPlugin may hand the payload back already parsed — accept both shapes.
        const p = row.payload as unknown
        const group = (typeof p === 'string' ? JSON.parse(p) : p) as ReconGroup
        results.push(await this.committer.apply(group))
      }
      return { evidence: logged.length, groups: logged.length, results, mode: 'replay' }
    }

    const rows = await this.evidence.allWithMessage()
    // 🔴 THE FUSE. Pre-log evidence carrying a division statement means cargo moved bookings — the one
    // shape this grouper is guaranteed to rebuild wrong. Refusing is strictly better than fusing.
    const divided = rows.filter((r) => (r.fields as { division?: unknown } | null)?.division)
    if (divided.length) {
      throw new ConflictException(
        `reconcile refused: ${divided.length} evidence record(s) carry a division statement (cargo moved ` +
          `between bookings) and the decision log is empty. The legacy re-derive would re-fuse the moved ` +
          `PO's old and new shipments. These shipments were already committed correctly by the agent path; ` +
          `future decisions land in decision_log (0032), which rebuilds by replay instead.`,
      )
    }
    const groups = this.group(rows)
    const threshold = await this.settings.confidenceThreshold()
    const results: CommitResult[] = []
    for (const grp of groups) {
      const emails = grp.map((r) => ({
        receivedAt: iso(r.receivedAt),
        emailType: r.emailType ?? 'Other',
        fields: r.fields ?? {},
        pos: posOf(r),
      }))
      const merged = mergeShipment(emails)
      const matchKeys = mergeKeys(grp)
      const { confidence } = scoreReconGroup({ conflicts: merged.conflicts, pos: merged.pos, fields: merged.fields, matchKeys })
      const g: ReconGroup = {
        fields: merged.fields,
        pos: merged.pos,
        conflicts: merged.conflicts,
        matchKeys,
        emailTypes: [...new Set(grp.map((r) => r.emailType).filter((t): t is string => !!t))],
        // graphId = email_message.graph_message_id (RFC Message-ID) so Related Emails link correctly.
        // Previously omitted → deriveEmailRows dropped every event → empty Related Emails after rebuild.
        events: grp.map((r) => ({
          emailType: r.emailType ?? 'Other',
          receivedAt: iso(r.receivedAt),
          graphId: r.graphMessageId ?? null,
        })),
        // every source email sent by the notification platform → a vendor/PO notification, not a shipment (rule c)
        fromPlatform: grp.length > 0 && grp.every((r) => isNotificationPlatformSender(r.sender)),
        // journey chain: latest evidence record CARRYING one wins — the same lift the queue's
        // groupJourney performs, recomputed here so a rebuild does not lose the routing.
        journey: (() => {
          const carrying = grp
            .filter((r) => Array.isArray((r.fields as Record<string, unknown> | null)?.legs) && ((r.fields as Record<string, unknown>).legs as unknown[]).length >= 2)
            .sort((a, b) => iso(a.receivedAt).localeCompare(iso(b.receivedAt)))
          const latest = carrying[carrying.length - 1]
          return latest ? ((latest.fields as Record<string, unknown>).legs as { seq: number; mode: string; pol: string; pod: string; doc: string | null }[]) : null
        })(),
        mode: grp.map((r) => r.mode).find((m): m is string => !!m) ?? null,
        conversationId: grp[0].conversationId,
        evidenceIds: grp.map((r) => r.graphMessageId).filter((x): x is string => !!x),
        confidence,
        reviewStatus: confidence >= threshold ? 'confirmed' : 'provisional',
      }
      results.push(await this.committer.apply(g))
    }
    return { evidence: rows.length, groups: groups.length, results, mode: 'derive' }
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
