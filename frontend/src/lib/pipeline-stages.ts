import { statusLabels } from '../components/ui/Badge'

/**
 * The shipment ladder as the dashboard pipeline plots it — one entry per stage, in lifecycle order.
 *
 * VOCABULARY: these are UI statuses, not DB states. The backend translates on the way out
 * (presentation/adapters/enums.ts: RELEASED → DEPARTED, DELIVERED → ARRIVED), so everything the
 * frontend sees speaks this dialect and so do `statusLabels` / the status badges. Plotting raw DB
 * states here would silently drop the last two bars, since neither `RELEASED` nor `DELIVERED` has a
 * label or a colour in that map.
 *
 * COLOUR is deliberately the lifecycle tag colour, so a bar and the badge for the same stage are the
 * same colour on every screen. Held as CSS custom-property NAMES rather than hexes: the tokens are
 * theme-aware in index.css, and recharts renders SVG, where `fill="var(--…)"` resolves natively — so
 * the chart follows the light/dark toggle without this module knowing anything about themes.
 *
 * Order is the funnel and is load-bearing: it is what the x-axis means.
 */
export interface PipelineStage {
  /** UI status (post-translation), the key `statusLabels` and the status badges use. */
  status: string
  /** The lifecycle tag's CSS custom property — same token the badge for this stage wears. */
  colorVar: string
}

export const PIPELINE_STAGES: readonly PipelineStage[] = [
  { status: 'BOOKED', colorVar: '--color-state-booked' },
  { status: 'CONFIRMED', colorVar: '--color-state-confirmed' },
  { status: 'AT_WAREHOUSE', colorVar: '--color-state-warehouse' },
  { status: 'SAILED', colorVar: '--color-state-sailed' },
  { status: 'DEPARTED', colorVar: '--color-state-released' },
  { status: 'ARRIVED', colorVar: '--color-state-delivered' },
] as const

export interface PipelineBar {
  status: string
  /** Badge vocabulary — "Draft BOL", not "AT_WAREHOUSE". */
  label: string
  count: number
  colorVar: string
}

/** A leg, as little of it as this module needs. */
interface StagedShipment {
  status?: string | null
  legStatus?: string | null
}

/**
 * Count shipments per stage, in ladder order.
 *
 * CANCELLED legs are excluded. They still appear in the tracker list (shown as Cancelled) but a
 * cancelled booking is not moving through the pipeline, and counting it would inflate whichever
 * stage it died at — the same exclusion `presentation.service.dashboard()` applies to the Active
 * Shipments KPI, so the card and the chart cannot disagree about what counts.
 *
 * Every stage is returned even at zero: the pipeline is a fixed ladder, and a stage that vanishes
 * when empty makes the axis shift under the reader between refreshes.
 */
export function countByStage(shipments: StagedShipment[]): PipelineBar[] {
  const counts = new Map<string, number>()
  for (const s of shipments) {
    const status = String(s.status ?? '').trim()
    if (!status) continue
    if (status === 'CANCELLED' || s.legStatus === 'CANCELLED') continue
    counts.set(status, (counts.get(status) ?? 0) + 1)
  }
  return PIPELINE_STAGES.map((stage) => ({
    status: stage.status,
    label: statusLabels[stage.status] ?? stage.status,
    count: counts.get(stage.status) ?? 0,
    colorVar: stage.colorVar,
  }))
}
