/** Pure aggregate of routing_shadow rows for the admin shadow-diff report. */

export type RoutingShadowRow = {
  shipmentId: string | null
  ingestedAt: Date
  gateRouting: string
  bandRouting: string
  band: string | null
  differs: boolean
}

export type RoutingShadowSample = {
  shipmentId: string | null
  ingestedAt: string
  gateRouting: string
  bandRouting: string
  band: string | null
  differs: boolean
}

export type RoutingShadowReport = {
  windowDays: number
  total: number
  differs: number
  /** gate confirmed → band provisional */
  autoToReview: number
  /** gate provisional → band confirmed */
  reviewToAuto: number
  /** Up to 50 most recent differs; if none, up to 50 most recent rows. */
  samples: RoutingShadowSample[]
}

function toSample(row: RoutingShadowRow): RoutingShadowSample {
  return {
    shipmentId: row.shipmentId,
    ingestedAt: row.ingestedAt instanceof Date
      ? row.ingestedAt.toISOString()
      : new Date(row.ingestedAt).toISOString(),
    gateRouting: row.gateRouting,
    bandRouting: row.bandRouting,
    band: row.band,
    differs: row.differs,
  }
}

/**
 * Aggregate shadow rows (newest-first) into a report window.
 * Flip counts only look at confirmed↔provisional; skip and same-side diffs are totals only.
 */
export function aggregateRoutingShadow(
  rows: RoutingShadowRow[],
  windowDays: number,
): RoutingShadowReport {
  let differs = 0
  let autoToReview = 0
  let reviewToAuto = 0

  for (const row of rows) {
    if (row.differs) differs += 1
    if (row.gateRouting === 'confirmed' && row.bandRouting === 'provisional') {
      autoToReview += 1
    } else if (row.gateRouting === 'provisional' && row.bandRouting === 'confirmed') {
      reviewToAuto += 1
    }
  }

  const differSamples = rows.filter((r) => r.differs).slice(0, 50)
  const sampleRows = differSamples.length > 0 ? differSamples : rows.slice(0, 50)

  return {
    windowDays,
    total: rows.length,
    differs,
    autoToReview,
    reviewToAuto,
    samples: sampleRows.map(toSample),
  }
}
