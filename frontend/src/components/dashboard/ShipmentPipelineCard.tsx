import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { countByStage, type PipelineBar } from '../../lib/pipeline-stages'

/**
 * Shipments by lifecycle stage.
 *
 * Bars wear the LIFECYCLE TAG colour, so a stage is the same colour here as on its status badge in
 * the table below and on every other screen — one thing meaning one thing. Colour is never
 * load-bearing: every bar carries its stage name on the axis and its count above the bar, so the
 * chart reads correctly in greyscale, under colour-vision deficiency, and in print. That relief is
 * required, not decorative — several lifecycle tokens sit close together (Departure's teal and
 * Delivered's green nearest of all), so the labels are what carry identity when hue cannot.
 *
 * Fed from the SAME `useShipments` the Shipments page uses, counted client-side rather than from a
 * new dashboard field — the standing rule on this page is that it must not be able to disagree with
 * the page it links to.
 */
export function ShipmentPipelineCard({
  shipments,
}: {
  shipments: { status?: string | null; legStatus?: string | null }[]
}) {
  const navigate = useNavigate()
  const data = useMemo(() => countByStage(shipments), [shipments])
  const total = data.reduce((n, d) => n + d.count, 0)

  return (
    <div className="rounded-xl border border-border bg-surface-800 p-4" data-testid="shipment-pipeline">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h2 className="min-w-0 truncate text-sm font-semibold text-text-primary">
          Shipment Pipeline
          <span className="ml-2 text-xs font-normal text-text-muted">Shipments by stage</span>
        </h2>
        <button
          type="button"
          onClick={() => navigate('/shipments')}
          className="shrink-0 text-xs font-medium text-cobalt-primary-light hover:underline"
        >
          View All
        </button>
      </div>

      {total === 0 ? (
        <p className="py-8 text-center text-sm text-text-muted">No shipments in the pipeline.</p>
      ) : (
        /* ResponsiveContainer measures its parent, so the height is explicit here — inside a grid
           cell it would otherwise resolve to zero and the card would collapse to its header. */
        <div className="h-[210px] w-full min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 22, right: 4, bottom: 0, left: 4 }} barCategoryGap="22%">
              <XAxis
                dataKey="label"
                interval={0}
                tickLine={false}
                axisLine={{ stroke: 'var(--color-border)' }}
                tick={{ fill: 'var(--color-text-muted)', fontSize: 11 }}
                height={34}
              />
              {/* Hidden: every bar is directly labelled, so a value axis would only repeat it in a
                  fainter typeface. allowDecimals=false keeps a max of 3 from drawing 0.5 ticks. */}
              <YAxis hide allowDecimals={false} />
              <Tooltip
                cursor={{ fill: 'var(--color-surface-700)', opacity: 0.5 }}
                content={<StageTooltip />}
              />
              <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={54} isAnimationActive={false}>
                {data.map((d) => (
                  <Cell key={d.status} fill={`var(${d.colorVar})`} />
                ))}
                <LabelList
                  dataKey="count"
                  position="top"
                  offset={8}
                  fill="var(--color-text-primary)"
                  fontSize={13}
                  fontWeight={700}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

/** The app's own surface + tokens — recharts' default tooltip is a white box that ignores the theme. */
function StageTooltip({ active, payload }: { active?: boolean; payload?: { payload: PipelineBar }[] }) {
  const bar = payload?.[0]?.payload
  if (!active || !bar) return null
  return (
    <div className="rounded-lg border border-border bg-surface-700 px-3 py-2 text-xs shadow-xl">
      <span className="font-semibold text-text-primary">{bar.label}</span>
      <span className="ml-2 text-text-secondary">
        {bar.count} {bar.count === 1 ? 'shipment' : 'shipments'}
      </span>
    </div>
  )
}
