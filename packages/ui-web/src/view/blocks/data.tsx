import type { BlockProps } from '@repo/catalog'
import { cn } from '../../primitives/cn.ts'
import { Eyebrow } from '../../primitives/eyebrow.tsx'
import { TONE_COLOR, TONE_TEXT } from '../tones.ts'

const TREND = { up: '↑', down: '↓', flat: '→' } as const

export function Metric({ props }: { props: BlockProps<'Metric'> }) {
  // Its figure is sized by its own width, so it measures nothing from its content: in a row it would shrink to
  // nothing. It keeps a width a figure reads at, a row that has no room for it puts it on the next line, and the
  // figures of a line share it.
  return (
    <div className="@container grid min-w-[min(7.5rem,100%)] grow content-start gap-1 overflow-hidden rounded-md border border-line bg-white/[0.018] px-3.5 py-3">
      <Eyebrow>{props.label}</Eyebrow>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-1">
        <span
          className={cn(
            'min-w-0 break-words font-medium text-[clamp(1.25rem,14cqi,1.75rem)] tabular-nums leading-tight tracking-[-0.02em]',
            TONE_TEXT[props.tone]
          )}
        >
          {props.value}
        </span>
        {props.unit && <span className="text-sm text-text-soft">{props.unit}</span>}
        {props.trend && (
          <span className={cn('ml-0.5 text-xs', props.trend === 'up' ? 'text-ok' : props.trend === 'down' ? 'text-danger' : 'text-text-faint')}>
            {TREND[props.trend]}
          </span>
        )}
      </div>
      {props.detail && <span className="text-pretty text-text-soft text-xs leading-snug">{props.detail}</span>}
    </div>
  )
}

export function Table({ props }: { props: BlockProps<'Table'> }) {
  return (
    <div className="scroll-quiet min-w-0 overflow-x-auto rounded-md border border-line">
      <table className="w-full border-collapse text-[0.8125rem]">
        <thead>
          <tr className="border-line border-b bg-white/[0.02]">
            {props.columns.map((column) => (
              <th key={column.key} className={cn('h-8 px-3 font-normal text-[0.6875rem] text-text-faint', column.align === 'end' ? 'text-right' : 'text-left')}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row, index) => (
            <tr key={index} className="border-line border-b transition-colors duration-(--duration-quick) last:border-b-0 hover:bg-white/[0.02]">
              {props.columns.map((column) => (
                <td key={column.key} className={cn('px-3 py-2', column.align === 'end' ? 'text-right tabular-nums' : 'text-left')}>
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
    <ol className="grid grid-cols-[fit-content(35%)_0.75rem_minmax(0,1fr)] gap-x-2.5">
      {props.items.map((item, index) => (
        <li key={index} className="contents">
          <span className="text-right text-[0.6875rem] text-text-faint tabular-nums leading-5">{item.time}</span>
          <div className="flex flex-col items-center">
            <span
              className="mt-[0.4375rem] size-1.5 shrink-0 rounded-full"
              style={{ background: item.tone === 'normal' ? 'var(--accent)' : TONE_COLOR[item.tone] }}
            />
            {index < props.items.length - 1 && <span className="my-1 w-px flex-1 bg-line-strong" />}
          </div>
          <div className="grid content-start gap-0.5 pb-3 last:pb-0">
            <span className="font-medium text-sm leading-5">{item.title}</span>
            {item.detail && <span className="text-[0.8125rem] text-text-soft leading-snug">{item.detail}</span>}
          </div>
        </li>
      ))}
    </ol>
  )
}

export function Progress({ props }: { props: BlockProps<'Progress'> }) {
  return (
    <div className="grid gap-1.5">
      {(props.label || props.detail) && (
        <div className="flex items-baseline justify-between gap-4">
          {props.label && <span className="text-[0.8125rem]">{props.label}</span>}
          <span className="font-mono text-[0.6875rem] text-text-soft tabular-nums">{props.detail ?? `${Math.round(props.value * 100)} %`}</span>
        </div>
      )}
      <div className="h-1 overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className="h-full origin-left rounded-full transition-[width] duration-700 ease-soft"
          style={{ width: `${props.value * 100}%`, background: TONE_COLOR[props.tone] }}
        />
      </div>
    </div>
  )
}

const HEIGHT = { short: 110, normal: 170, tall: 250 } as const

/** Round numbers for an axis: a step of 1, 2 or 5 times a power of ten, so the scale reads at a glance. */
/** An axis's value as a person reads it: 2.5M rather than 2500000, 12,000 with its separator. */
const axisNumber = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })
const formatTick = (value: number) => (Math.abs(value) >= 10_000 ? axisNumber.format(value) : value.toLocaleString())

function niceScale(min: number, max: number, ticks = 4): { low: number; high: number; step: number } {
  const span = max - min || Math.abs(max) || 1
  const raw = span / ticks
  const power = 10 ** Math.floor(Math.log10(raw))
  const step = ([1, 2, 5, 10].find((factor) => factor * power >= raw) ?? 10) * power
  return { low: Math.floor(min / step) * step, high: Math.ceil(max / step) * step, step }
}

export function Chart({ props }: { props: BlockProps<'Chart'> }) {
  const width = 640
  const height = HEIGHT[props.height]
  const pad = { top: 12, right: 12, bottom: 26, left: 44 }
  const labels = props.series.reduce<string[]>(
    (longest, series) => (series.points.length > longest.length ? series.points.map((point) => point.x) : longest),
    []
  )
  const values = props.series.flatMap((series) => series.points.map((point) => point.y))
  const { low, high, step } = niceScale(props.kind === 'bar' ? Math.min(0, ...values) : Math.min(...values), Math.max(...values))
  const innerWidth = width - pad.left - pad.right
  const innerHeight = height - pad.top - pad.bottom
  const y = (value: number) => pad.top + innerHeight - ((value - low) / (high - low || 1)) * innerHeight
  const slot = innerWidth / Math.max(1, labels.length)
  const x = (index: number) =>
    props.kind === 'bar' ? pad.left + slot * index + slot / 2 : pad.left + (labels.length <= 1 ? innerWidth / 2 : (innerWidth / (labels.length - 1)) * index)
  const ticks: number[] = []
  for (let tick = low; tick <= high + step / 2; tick += step) ticks.push(Number(tick.toFixed(10)))
  const color = (tone: string) => (tone === 'normal' ? 'var(--accent)' : TONE_COLOR[tone as keyof typeof TONE_COLOR])
  const everyNth = Math.ceil(labels.length / 8)

  return (
    <figure className="grid min-w-0 gap-1.5">
      {(props.series.length > 1 || props.unit) && (
        <figcaption className="flex flex-wrap items-center gap-3">
          {/* The unit sits above the axis, where a long one has room: beside the top value it would spill out. */}
          {props.unit && <span className="text-[0.6875rem] text-text-faint">{props.unit}</span>}
          {props.series.length > 1 &&
            props.series.map((series) => (
              <span key={series.name} className="flex items-center gap-1.5 text-[0.6875rem] text-text-soft">
                <span className="h-0.5 w-3 rounded-full" style={{ background: color(series.tone) }} />
                {series.name}
              </span>
            ))}
        </figcaption>
      )}
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full overflow-visible"
        role="img"
        aria-label={props.series.map((series) => series.name).join(', ')}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} stroke="var(--color-line)" />
            <text x={pad.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" className="fill-text-faint text-[10px]">
              {formatTick(tick)}
            </text>
          </g>
        ))}
        {labels.map((label, index) =>
          index % everyNth === 0 ? (
            <text key={label + String(index)} x={x(index)} y={height - 6} textAnchor="middle" className="fill-text-faint text-[10px]">
              {label}
            </text>
          ) : null
        )}
        {props.series.map((series, seriesIndex) => {
          const stroke = color(series.tone)
          if (props.kind === 'bar') {
            const barWidth = Math.min(36, (slot * 0.7) / props.series.length)
            return series.points.map((point, index) => {
              const left = x(index) - (barWidth * props.series.length) / 2 + barWidth * seriesIndex
              const top = y(Math.max(0, point.y))
              return (
                <rect
                  key={`${series.name}-${point.x}`}
                  x={left + 1}
                  y={top}
                  width={barWidth - 2}
                  height={Math.abs(y(point.y) - y(0))}
                  rx={1.5}
                  fill={stroke}
                  opacity={0.8}
                />
              )
            })
          }
          const path = series.points.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y(point.y).toFixed(1)}`).join(' ')
          const gradient = `fill-${seriesIndex}`
          return (
            <g key={series.name}>
              {props.kind === 'area' && (
                <>
                  <defs>
                    <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0" stopColor={stroke} stopOpacity={0.2} />
                      <stop offset="1" stopColor={stroke} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <path d={`${path} L${x(series.points.length - 1).toFixed(1)},${y(low)} L${x(0).toFixed(1)},${y(low)} Z`} fill={`url(#${gradient})`} />
                </>
              )}
              <path d={path} fill="none" stroke={stroke} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
              {series.points.map((point, index) => (
                <circle key={point.x} cx={x(index)} cy={y(point.y)} r={2.5} fill="var(--color-surface)" stroke={stroke} strokeWidth={1.5} />
              ))}
            </g>
          )
        })}
      </svg>
    </figure>
  )
}
