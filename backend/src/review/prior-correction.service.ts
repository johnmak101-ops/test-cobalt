import { Injectable, Logger } from '@nestjs/common'
import { MastersRepository } from '../db/repositories/masters.repository'

/**
 * A human's raw-name → master-code answer, stored where the RETRIEVAL can use it.
 *
 * Design decision D (matcher Phase 3, 2026-07-09) and the reason this is not a resolver: the fact is
 * read by `POST /masters/candidates` as a top-rank BOOST, and the LLM still decides every time. There
 * is no deterministic fast-path. A stored (name → code) table that ANSWERS would be hard-coding: the
 * model never sees the name, so it can never disagree, and one wrong entry stays wrong on every future
 * email. As evidence, the same knowledge is safe — the model can weigh it against everything else and
 * override it when this email says otherwise.
 *
 * 🔴 Why this is a service and not a method on ReviewQueueService, where it started. Three surfaces let
 * an operator fix a mis-resolved party, and only ONE of them recorded anything:
 *
 *   · the email review queue verdict      (ReviewQueueService)     — recorded ✅
 *   · a review field edit                 (ReviewService)          — silent ❌
 *   · an Order Details edit               (ShipmentsService)       — silent ❌
 *
 * Order Details is the screen operators actually use all day, so in practice the loop was closed on
 * the path nobody takes. Copying the logic into two more places is how the merge-policy fixtures drifted
 * apart; there is one implementation and three call sites.
 */
export type PriorCorrectionKind = 'customer' | 'vendor' | 'forwarder' | 'pol' | 'pod'

/** Parser/extraction vocabulary (`extractedData` keys) → the party this correction is about. */
const FROM_EXTRACTION_FIELD: Readonly<Record<string, PriorCorrectionKind>> = {
  customer_code: 'customer',
  vendor_code: 'vendor',
  forwarder_name: 'forwarder',
  pol: 'pol',
  pod: 'pod',
}

/** Leg-column vocabulary (the `Raw` suffix the parser never had) → the same five. */
const FROM_LEG_COLUMN: Readonly<Record<string, PriorCorrectionKind>> = {
  customerRaw: 'customer',
  vendorRaw: 'vendor',
  forwarderRaw: 'forwarder',
  polRaw: 'pol',
  podRaw: 'pod',
}

const str = (v: unknown): string => (v == null ? '' : String(v).trim())

@Injectable()
export class PriorCorrectionService {
  private readonly log = new Logger(PriorCorrectionService.name)

  constructor(private readonly masters: MastersRepository) {}

  /** Is `value` already a master CODE for this party kind? (Not a name — a code.) */
  private async isMasterCode(kind: PriorCorrectionKind, value: string): Promise<boolean> {
    switch (kind) {
      case 'customer':
        return !!(await this.masters.customerByCode(value))
      case 'vendor':
        return !!(await this.masters.vendorIdByCode(value))
      case 'forwarder':
        return !!(await this.masters.forwarderIdByCode(value))
      default:
        return !!(await this.masters.portIdByUnlocode(value))
    }
  }

  /**
   * Record ONE raw→code replacement, or decide there is nothing to learn.
   *
   * Only a raw→code replacement qualifies, and both halves of that matter:
   *
   *   · the OLD value must NOT be a master code. If it is, the operator swapped one real party for
   *     another — that is the model reading the email wrong, not a name it could not look up. Storing
   *     `APPLE → BEN` would redirect every future email that legitimately says APPLE.
   *   · the NEW value MUST be a master code. Otherwise the operator typed a name the master does not
   *     have, and the answer is a master-data gap, not a retrieval hint.
   *
   * Supersedes any active fact for the same raw name — latest human word wins. Never throws: a facts
   * hiccup must not sink the edit that produced it.
   */
  private async record(
    kind: PriorCorrectionKind,
    label: string,
    oldRaw: unknown,
    newRaw: unknown,
    actorId: string | null,
  ): Promise<'recorded' | 'skipped'> {
    const oldVal = str(oldRaw)
    const newVal = str(newRaw)
    if (!oldVal || !newVal || oldVal.toUpperCase() === newVal.toUpperCase()) return 'skipped'
    try {
      const [oldIsCode, newIsCode] = await Promise.all([
        this.isMasterCode(kind, oldVal),
        this.isMasterCode(kind, newVal),
      ])
      if (oldIsCode || !newIsCode) return 'skipped'
      await this.masters.deactivateActiveFor('prior_correction', oldVal)
      await this.masters.insertOpsFact({
        kind: 'prior_correction',
        lhs: oldVal,
        rhs: newVal.toUpperCase(),
        reason: `review correction (${label})`,
        createdBy: actorId,
      })
      return 'recorded'
    } catch (e) {
      this.log.warn(`prior_correction write skipped for ${label} "${oldVal}": ${(e as Error).message}`)
      return 'skipped'
    }
  }

  /** The email review-queue verdict form: two `extractedData` maps in parser vocabulary. */
  async recordFromExtraction(
    original: Record<string, unknown>,
    corrected: Record<string, unknown>,
    actorId: string | null,
  ): Promise<void> {
    for (const [field, kind] of Object.entries(FROM_EXTRACTION_FIELD)) {
      await this.record(kind, field, original[field], corrected[field], actorId)
    }
  }

  /**
   * One edited LEG COLUMN (`forwarderRaw`, `customerRaw`, …) from a review field edit or an Order
   * Details save. A column this does not know is not an error — most edits are dates and quantities.
   */
  async recordFromLegEdit(
    column: string,
    oldValue: unknown,
    newValue: unknown,
    actorId: string | null,
  ): Promise<'recorded' | 'skipped'> {
    const kind = FROM_LEG_COLUMN[column]
    if (!kind) return 'skipped'
    return this.record(kind, column, oldValue, newValue, actorId)
  }
}
