/** Pure aggregate of critic calibration rows for the admin calibration report. */

export type CalibrationBandKey = 'high' | 'medium' | 'low' | 'unknown'

export type CalibrationBandStats = {
  total: number
  approved: number
  corrected: number
  dismissed: number
  /** corrected / total; 0 when total === 0 (never NaN) */
  correctionRate: number
}

export type CriticCalibrationRow = {
  shipmentId: string | null
  decidedAt: Date
  band: string | null
  outcome: string
  correctedFieldCount: number
  actorId: string | null
}

export type CriticCalibrationReport = {
  windowDays: number
  /** Rows ANALYSED — `byBand` and every rate below are computed over exactly these. */
  total: number
  /** True row count in the window. Exceeds `total` when the read was capped — see `truncated`. */
  windowTotal: number
  /** True when the window holds more rows than were analysed (the rates are over the newest `total`
   *  rows, not the whole window). Surfaced so the 2b flip decision is never read off a silently
   *  truncated denominator. */
  truncated: boolean
  byBand: Record<CalibrationBandKey, CalibrationBandStats>
  /** THE 2b gate: corrected / total among high-band rows */
  highBandCorrectionRate: number
  /** over-caution: approved / total among low+medium */
  lowMediumApprovedRate: number
  samples: Array<{
    shipmentId: string | null
    decidedAt: string
    band: string | null
    outcome: string
    correctedFieldCount: number
  }>
}

function emptyStats(): CalibrationBandStats {
  return { total: 0, approved: 0, corrected: 0, dismissed: 0, correctionRate: 0 }
}

function bandKey(band: string | null): CalibrationBandKey {
  if (band === 'high' || band === 'medium' || band === 'low') return band
  return 'unknown'
}

function rate(n: number, d: number): number {
  return d === 0 ? 0 : n / d
}

/**
 * Aggregate critic-calibration rows (newest-first assumed) into a report window.
 * highBandCorrectionRate / lowMediumApprovedRate are 0 when denominators are empty (never NaN).
 * Samples: high-band corrected first, then other rows, capped at 50.
 *
 * `windowTotal` is the TRUE row count in the window (the caller reads it with a count, since `rows`
 * may be capped). When it exceeds rows.length the report says so via `truncated` — the rates stay
 * meaningful (newest N) but the reader must not mistake `total` for the window's real volume.
 */
export function aggregateCriticCalibration(
  rows: CriticCalibrationRow[],
  windowDays: number,
  windowTotal?: number,
): CriticCalibrationReport {
  const byBand: Record<CalibrationBandKey, CalibrationBandStats> = {
    high: emptyStats(),
    medium: emptyStats(),
    low: emptyStats(),
    unknown: emptyStats(),
  }

  for (const row of rows) {
    const k = bandKey(row.band)
    const s = byBand[k]
    s.total += 1
    if (row.outcome === 'approved') s.approved += 1
    else if (row.outcome === 'corrected') s.corrected += 1
    else if (row.outcome === 'dismissed') s.dismissed += 1
  }
  for (const s of Object.values(byBand)) {
    s.correctionRate = rate(s.corrected, s.total)
  }

  const high = byBand.high
  const lmTotal = byBand.low.total + byBand.medium.total
  const lmApproved = byBand.low.approved + byBand.medium.approved

  // Samples: all high-band corrected first (newest-first input assumed), then fill to 50 with other recent
  const highMisses = rows.filter((r) => r.band === 'high' && r.outcome === 'corrected')
  const rest = rows.filter((r) => !(r.band === 'high' && r.outcome === 'corrected'))
  const sampleRows = [...highMisses, ...rest].slice(0, 50)

  const analysed = rows.length
  const inWindow = windowTotal ?? analysed

  return {
    windowDays,
    total: analysed,
    windowTotal: inWindow,
    truncated: inWindow > analysed,
    byBand,
    highBandCorrectionRate: rate(high.corrected, high.total),
    lowMediumApprovedRate: rate(lmApproved, lmTotal),
    samples: sampleRows.map((r) => ({
      shipmentId: r.shipmentId,
      decidedAt:
        r.decidedAt instanceof Date
          ? r.decidedAt.toISOString()
          : new Date(r.decidedAt).toISOString(),
      band: r.band,
      outcome: r.outcome,
      correctedFieldCount: r.correctedFieldCount,
    })),
  }
}
