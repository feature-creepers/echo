import { type BlockProps, feedFigure, feedPoints } from '@repo/catalog'
import { motion, useReducedMotion } from 'motion/react'
import { useId } from 'react'
import { cn } from '../../primitives/cn.ts'
import { Eyebrow } from '../../primitives/eyebrow.tsx'
import { DURATION, EASE, settle } from '../../styles/motion.ts'
import { markColor, TONE_TEXT } from '../tones.ts'
import { useFeedDocument, useFeedDocuments } from '../use-feed.ts'
import { useWidth } from './use-width.ts'

const TREND = { up: '↑', down: '↓', flat: '→' } as const

/** How a mark arrives: growing from its start, or a line drawing itself, over the slow duration. */
const grow = { duration: DURATION.slow, ease: EASE } as const

/** The figure a fed block shows: the one its feed gives, once read, else the one it was given. */
function useFedFigure(feed: BlockProps<'Metric'>['feed']): { text: string; number?: number } | undefined {
  const document = useFeedDocument(feed)
  if (!feed || document === undefined) return undefined
  const taken = feedFigure(document, feed)
  return taken.ok ? taken.value : undefined
}

export function Metric({ props }: { props: BlockProps<'Metric'> }) {
  const fed = useFedFigure(props.feed)
  const still = useReducedMotion()
  // Its figure is sized by its own width, so it measures nothing from its content: in a row it would shrink to
  // nothing. It keeps a width a figure reads at, a row that has no room for it puts it on the next line, and the
  // figures of a line share it. Alone in a card, the figure is large; side by side, smaller.
  return (
    <div className="@container grid min-w-[min(7.5rem,100%)] grow content-start">
      <Eyebrow className="mb-2">{props.label}</Eyebrow>
      <motion.div
        initial={still ? false : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={settle}
        className={cn('flex min-w-0 flex-wrap items-baseline gap-x-1', TONE_TEXT[props.tone])}
      >
        <span className="display min-w-0 break-words text-[clamp(2rem,22cqi,3.75rem)] leading-[0.87]">{fed?.text ?? props.value}</span>
        {props.unit && <span className="display text-[clamp(1rem,9cqi,1.625rem)] leading-none">{props.unit}</span>}
      </motion.div>
      {(props.trend || props.detail) && (
        <p className="caps mt-2 text-pretty text-text-soft">
          {props.trend && (
            <span className={cn('mr-1.5', props.trend === 'down' ? 'text-danger' : props.trend === 'up' ? 'text-ok' : 'text-text-faint')}>
              {TREND[props.trend]}
            </span>
          )}
          {props.detail}
        </p>
      )}
    </div>
  )
}

export function Table({ props }: { props: BlockProps<'Table'> }) {
  return (
    <div className="scroll-quiet min-w-0 overflow-x-auto">
      <table className="w-full border-collapse text-[0.8125rem] tabular-nums">
        <thead>
          <tr className="border-text border-b-2">
            {props.columns.map((column) => (
              <th key={column.key} className={cn('caps h-7 pr-3 font-normal text-text-soft last:pr-0', column.align === 'end' ? 'text-right' : 'text-left')}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row, index) => (
            <tr key={index} className="border-line border-b transition-colors duration-(--duration-quick) last:border-b-0 hover:bg-text/[0.04]">
              {props.columns.map((column) => (
                <td key={column.key} className={cn('h-[2.125rem] py-1.5 pr-3 last:pr-0', column.align === 'end' ? 'text-right' : 'text-left')}>
                  {row[column.key] ?? ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Timeline({ props }: { props: BlockProps<'Timeline'> }) {
  // One grid for every moment, so the times line up in one column whatever their length.
  return (
    <ol className="grid grid-cols-[fit-content(35%)_0.5rem_minmax(0,1fr)] gap-x-3">
      {props.items.map((item, index) => (
        <li key={index} className="contents">
          <span className="caps pt-0.5 text-right text-text-soft tabular-nums">{item.time}</span>
          <div className="flex flex-col items-center">
            <span className="mt-1.5 size-2 shrink-0" style={{ background: markColor(item.tone) }} />
            {index < props.items.length - 1 && <span className="my-1 w-px flex-1 bg-line-strong" />}
          </div>
          <div className="grid content-start gap-0.5 pb-3 last:pb-0">
            <span className="font-medium text-[0.8125rem] leading-5">{item.title}</span>
            {item.detail && <span className="text-text-soft text-xs leading-snug">{item.detail}</span>}
          </div>
        </li>
      ))}
    </ol>
  )
}

export function Progress({ props }: { props: BlockProps<'Progress'> }) {
  const fed = useFedFigure(props.feed)?.number
  const value = fed === undefined ? props.value : Math.min(1, Math.max(0, fed))
  const still = useReducedMotion()
  return (
    <div className="grid gap-1.5">
      {(props.label || props.detail) && (
        <div className="flex items-baseline justify-between gap-4">
          {props.label && <span className="text-[0.8125rem]">{props.label}</span>}
          <span className="caps text-text-soft tabular-nums">{props.detail ?? `${Math.round(value * 100)} %`}</span>
        </div>
      )}
      {/* A square track on a hairline base; the fill grows from the start by its transform. */}
      <div className="h-1.5 shadow-[inset_0_-1px_0_var(--color-line-strong)]">
        <motion.div
          className="h-full origin-left"
          initial={still ? false : { scaleX: 0 }}
          animate={{ scaleX: value }}
          transition={grow}
          style={{ background: markColor(props.tone) }}
        />
      </div>
    </div>
  )
}

const HEIGHT = { short: 120, normal: 170, tall: 250 } as const

/** The colours of a chart's series in order. A tone that means something keeps its colour. */
const SERIES = ['var(--color-text)', 'var(--color-info)', 'var(--color-warn)', 'var(--color-danger)'] as const

const seriesColor = (tone: BlockProps<'Chart'>['series'][number]['tone'], index: number): string =>
  tone === 'normal' || tone === 'accent' ? (SERIES[index % SERIES.length] ?? SERIES[0]) : markColor(tone)

/** An axis's value as a person reads it: 2.5M rather than 2500000, 12,000 with its separator. */
const axisNumber = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })
const formatTick = (value: number) => (Math.abs(value) >= 10_000 ? axisNumber.format(value) : value.toLocaleString())

/** Round numbers for an axis: a step of 1, 2 or 5 times a power of ten, so the scale reads at a glance. */
function niceScale(min: number, max: number, ticks = 4): { low: number; high: number; step: number } {
  const span = max - min || Math.abs(max) || 1
  const raw = span / ticks
  const power = 10 ** Math.floor(Math.log10(raw))
  const step = ([1, 2, 5, 10].find((factor) => factor * power >= raw) ?? 10) * power
  return { low: Math.floor(min / step) * step, high: Math.ceil(max / step) * step, step }
}

/** Fine diagonal lines of a colour, as an SVG fill: what a hatched plane is in the page. */
function Hatch({ id, color }: { id: string; color: string }) {
  return (
    <pattern id={id} width={5} height={5} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <line x1={0} y1={0} x2={0} y2={5} stroke={color} strokeWidth={1} />
    </pattern>
  )
}

export function Chart({ props: given }: { props: BlockProps<'Chart'> }) {
  // Hatchings are named for this chart alone: a name shared by two charts on the page would fill both with the
  // first one's colour.
  const id = useId()
  const still = useReducedMotion()
  // Drawn at the width it is given, so its labels read at their own size rather than scaled with the drawing.
  const { ref, width } = useWidth(640)
  // A fed series draws the points its feed gives once read, and the ones it was given until then.
  const documents = useFeedDocuments(given.series.map((series) => series.feed))
  const props = {
    ...given,
    series: given.series.map((series, index) => {
      const document = documents[index]
      if (!series.feed || document === undefined) return series
      const taken = feedPoints(document, series.feed)
      return taken.ok ? { ...series, points: taken.value } : series
    })
  }
  const height = HEIGHT[props.height]
  const pad = { top: 8, right: 4, bottom: 24, left: 44 }
  const labels = props.series.reduce<string[]>(
    (longest, series) => (series.points.length > longest.length ? series.points.map((point) => point.x) : longest),
    []
  )
  const values = props.series.flatMap((series) => series.points.map((point) => point.y))
  const { low, high, step } = niceScale(props.kind === 'bar' ? Math.min(0, ...values) : Math.min(...values), Math.max(...values))
  const innerWidth = Math.max(1, width - pad.left - pad.right)
  const innerHeight = height - pad.top - pad.bottom
  const y = (value: number) => pad.top + innerHeight - ((value - low) / (high - low || 1)) * innerHeight
  const slot = innerWidth / Math.max(1, labels.length)
  const x = (index: number) =>
    props.kind === 'bar' ? pad.left + slot * index + slot / 2 : pad.left + (labels.length <= 1 ? innerWidth / 2 : (innerWidth / (labels.length - 1)) * index)
  const ticks: number[] = []
  for (let tick = low; tick <= high + step / 2; tick += step) ticks.push(Number(tick.toFixed(10)))
  // As many labels under the axis as fit side by side, about one every 64 px.
  const everyNth = Math.ceil(labels.length / Math.max(2, Math.floor(innerWidth / 64)))
  // A secondary series of bars, and the area under the first line, are hatched rather than filled.
  const hatched = (index: number) => (props.kind === 'bar' ? index > 0 : props.kind === 'area' && index === 0)
  const colors = props.series.map((series, index) => seriesColor(series.tone, index))

  return (
    <figure className="grid min-w-0 gap-2">
      {(props.series.length > 1 || props.unit) && (
        <figcaption className="caps flex flex-wrap items-center gap-x-4 gap-y-1 text-text-soft">
          {/* The unit sits above the axis, where a long one has room: beside the top value it would spill out. */}
          {props.unit && <span className="text-text-faint">{props.unit}</span>}
          {props.series.length > 1 &&
            props.series.map((series, index) => (
              <span key={series.name} className="flex items-center gap-1.5">
                <span
                  className={cn('size-2', hatched(index) && 'hatch shadow-[inset_0_0_0_1px_currentColor]')}
                  style={hatched(index) ? { color: colors[index] } : { background: colors[index] }}
                />
                {series.name}
              </span>
            ))}
        </figcaption>
      )}
      <div ref={ref} className="min-w-0">
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="block max-w-full overflow-visible"
          role="img"
          aria-label={props.series.map((series) => series.name).join(', ')}
        >
          <defs>
            {props.series.map((series, index) => hatched(index) && <Hatch key={series.name} id={`${id}-hatch-${index}`} color={colors[index] ?? SERIES[0]} />)}
          </defs>
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} stroke={tick === low ? 'var(--color-line-strong)' : 'var(--color-line)'} />
              <text x={pad.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" className="caps fill-text-faint">
                {formatTick(tick)}
              </text>
            </g>
          ))}
          {labels.map((label, index) =>
            index % everyNth === 0 ? (
              <text key={label + String(index)} x={x(index)} y={height - 6} textAnchor="middle" className="caps fill-text-faint">
                {label}
              </text>
            ) : null
          )}
          {props.series.map((series, seriesIndex) => {
            const color = colors[seriesIndex] ?? SERIES[0]
            const fill = hatched(seriesIndex) ? `url(#${id}-hatch-${seriesIndex})` : color
            if (props.kind === 'bar') {
              const barWidth = Math.min(28, (slot * 0.7) / props.series.length)
              return series.points.map((point, index) => {
                const left = x(index) - (barWidth * props.series.length) / 2 + barWidth * seriesIndex
                return (
                  <motion.rect
                    key={`${series.name}-${point.x}`}
                    x={left + 1.5}
                    y={y(Math.max(0, point.y))}
                    width={Math.max(1, barWidth - 3)}
                    height={Math.abs(y(point.y) - y(0))}
                    fill={fill}
                    stroke={hatched(seriesIndex) ? color : undefined}
                    strokeWidth={1}
                    // A bar grows from the axis, up or down.
                    style={{ originY: point.y >= 0 ? 1 : 0 }}
                    initial={still ? false : { scaleY: 0 }}
                    animate={{ scaleY: 1 }}
                    transition={{ ...grow, delay: still ? 0 : index * 0.02 }}
                  />
                )
              })
            }
            const path = series.points.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y(point.y).toFixed(1)}`).join(' ')
            return (
              <g key={series.name}>
                {hatched(seriesIndex) && (
                  <motion.path
                    d={`${path} L${x(series.points.length - 1).toFixed(1)},${y(low)} L${x(0).toFixed(1)},${y(low)} Z`}
                    fill={fill}
                    initial={still ? false : { opacity: 0 }}
                    animate={{ opacity: 0.5 }}
                    transition={{ ...grow, delay: still ? 0 : DURATION.calm }}
                  />
                )}
                <motion.path
                  d={path}
                  fill="none"
                  stroke={color}
                  strokeWidth={1.5}
                  strokeLinejoin="miter"
                  strokeLinecap="butt"
                  initial={still ? false : { pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={grow}
                />
                {series.points.length <= 32 &&
                  series.points.map((point, index) => (
                    <motion.rect
                      key={point.x + String(index)}
                      x={x(index) - 2.5}
                      y={y(point.y) - 2.5}
                      width={5}
                      height={5}
                      fill={color}
                      initial={still ? false : { opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ ...settle, delay: still ? 0 : DURATION.calm }}
                    />
                  ))}
              </g>
            )
          })}
        </svg>
      </div>
    </figure>
  )
}
