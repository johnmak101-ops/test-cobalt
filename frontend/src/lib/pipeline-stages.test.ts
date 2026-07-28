import { describe, it, expect } from 'vitest'
import { PIPELINE_STAGES, countByStage } from './pipeline-stages'
import { statusLabels } from '../components/ui/Badge'

describe('countByStage', () => {
  it('returns every stage in ladder order, even the empty ones', () => {
    const bars = countByStage([{ status: 'BOOKED' }])
    expect(bars.map((b) => b.status)).toEqual([
      'BOOKED', 'CONFIRMED', 'AT_WAREHOUSE', 'SAILED', 'DEPARTED', 'ARRIVED',
    ])
    // A stage that disappears when empty makes the axis shift under the reader between refreshes.
    expect(bars.find((b) => b.status === 'SAILED')?.count).toBe(0)
  })

  it('counts each stage', () => {
    const bars = countByStage([
      { status: 'BOOKED' }, { status: 'BOOKED' }, { status: 'BOOKED' },
      { status: 'AT_WAREHOUSE' }, { status: 'AT_WAREHOUSE' },
      { status: 'ARRIVED' },
    ])
    const by = Object.fromEntries(bars.map((b) => [b.status, b.count]))
    expect(by).toMatchObject({ BOOKED: 3, CONFIRMED: 0, AT_WAREHOUSE: 2, ARRIVED: 1 })
  })

  /** Same exclusion presentation.service.dashboard() applies to the Active Shipments KPI — a
   *  cancelled booking is not moving through the pipeline, and counting it would inflate whichever
   *  stage it died at. If these two ever disagree the card and the chart contradict each other. */
  it('excludes cancelled legs, by state and by legStatus', () => {
    const bars = countByStage([
      { status: 'BOOKED' },
      { status: 'CANCELLED' },
      { status: 'BOOKED', legStatus: 'CANCELLED' },
    ])
    expect(bars.find((b) => b.status === 'BOOKED')?.count).toBe(1)
    expect(bars.reduce((n, b) => n + b.count, 0)).toBe(1)
  })

  it('ignores legs with no status rather than counting them somewhere', () => {
    const bars = countByStage([{ status: null }, { status: '  ' }, {}])
    expect(bars.reduce((n, b) => n + b.count, 0)).toBe(0)
  })

  /**
   * The ladder speaks the UI dialect, not the DB's. The backend translates on the way out
   * (presentation/adapters/enums.ts: RELEASED → DEPARTED, DELIVERED → ARRIVED). Keying on raw DB
   * states would silently drop the last two bars — neither has a label or a colour in statusLabels.
   */
  it('every stage has a badge label — no bar can render its raw enum key', () => {
    for (const stage of PIPELINE_STAGES) {
      expect(statusLabels[stage.status]).toBeTruthy()
    }
    const bars = countByStage([])
    expect(bars.map((b) => b.label)).toEqual([
      'Booking Request', 'SO Received', 'Draft BOL', 'Final BOL', 'Departure', 'Delivered',
    ])
  })

  /** Bars wear the lifecycle tag colour so a stage looks the same here as on its status badge. */
  it('carries the lifecycle token per stage, as a CSS custom property name', () => {
    const bars = countByStage([])
    expect(bars.map((b) => b.colorVar)).toEqual([
      '--color-state-booked', '--color-state-confirmed', '--color-state-warehouse',
      '--color-state-sailed', '--color-state-released', '--color-state-delivered',
    ])
  })
})
