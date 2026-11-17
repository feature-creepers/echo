import type { BlockProps } from '@repo/catalog'
import { cn } from '../../primitives/cn.ts'
import { Eyebrow } from '../../primitives/eyebrow.tsx'
import { TONE_COLOR, TONE_TEXT } from '../tones.ts'

const TREND = { up: '↑', down: '↓', flat: '→' } as const

export function Metric({ props }: { props: BlockProps<'Metric'> }) {
  return (
    <div className="grid min-w-0 content-start gap-1.5 rounded-lg border border-line bg-surface/70 px-5 py-4">
      <Eyebrow>{props.label}</Eyebrow>
      <div className="flex items-baseline gap-1.5">
        <span className={cn('font-medium text-4xl tabular-nums tracking-tight', TONE_TEXT[props.tone])}>{props.value}</span>
        {props.unit && <span className="text-lg text-text-soft">{props.unit}</span>}
        {props.trend && (
          <span className={cn('ml-1 font-mono text-sm', props.trend === 'up' ? 'text-ok' : props.trend === 'down' ? 'text-danger' : 'text-text-faint')}>
            {TREND[props.trend]}
          </span>
        )}
      </div>
      {props.detail && <span className="text-sm text-text-soft">{props.detail}</span>}
    </div>
  )
}

export function Table({ props }: { props: BlockProps<'Table'> }) {
  return (
    <div className="scroll-quiet min-w-0 overflow-x-auto rounded-lg border border-line">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-line border-b bg-surface/80">
            {props.columns.map((column) => (
              <th
                key={column.key}
                className={cn('px-4 py-2.5 font-mono font-normal text-label text-text-faint uppercase', column.align === 'end' ? 'text-right' : 'text-left')}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row, index) => (
            <tr key={index} className="border-line border-b last:border-b-0 hover:bg-raised/50">
              {props.columns.map((column) => (
                <td key={column.key} className={cn('px-4 py-2.5', column.align === 'end' ? 'text-right tabular-nums' : 'text-left')}>
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
    <ol className="grid grid-cols-[max-content_1rem_1fr] gap-x-3">
      {props.items.map((item, index) => (
        <li key={index} className="contents">
          <span className="pt-0.5 text-right font-mono text-text-soft text-xs tabular-nums">{item.time}</span>
          <div className="flex flex-col items-center">
            <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: item.tone === 'normal' ? 'var(--accent)' : TONE_COLOR[item.tone] }} />
            {index < props.items.length - 1 && <span className="my-1 w-px flex-1 bg-line-strong" />}
          </div>
          <div className="grid content-start gap-0.5 pb-4">
            <span className="font-medium text-[0.9375rem]">{item.title}</span>
            {item.detail && <span className="text-sm text-text-soft">{item.detail}</span>}
          </div>
        </li>
      ))}
    </ol>
  )
}

export function Progress({ props }: { props: BlockProps<'Progress'> }) {
  return (
    <div className="grid gap-2">
      {(props.label || props.detail) && (
        <div className="flex items-baseline justify-between gap-4">
          {props.label && <span className="text-sm">{props.label}</span>}
          <span className="font-mono text-text-soft text-xs tabular-nums">{props.detail ?? `${Math.round(props.value * 100)} %`}</span>
        </div>
      )}
      <div className="h-1.5 overflow-hidden rounded-full bg-raised">
        <div
          className="h-full rounded-full transition-[width] duration-700 ease-soft"
          style={{ width: `${props.value * 100}%`, background: TONE_COLOR[props.tone] }}
        />
      </div>
    </div>
  )
}

const HEIGHT = { short: 120, normal: 190, tall: 280 } as const

/** Round numbers for an axis: a step of 1, 2 or 5 times a power of ten, so the scale reads at a glance. */
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
    <figure className="grid min-w-0 gap-2">
      {props.series.length > 1 && (
        <figcaption className="flex flex-wrap gap-4">
          {props.series.map((series) => (
            <span key={series.name} className="flex items-center gap-2 text-text-soft text-xs">
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
            <text x={pad.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" className="fill-text-faint font-mono text-[10px]">
              {tick}
              {props.unit && tick === ticks.at(-1) ? ` ${props.unit}` : ''}
            </text>
          </g>
        ))}
        {labels.map((label, index) =>
          index % everyNth === 0 ? (
            <text key={label + String(index)} x={x(index)} y={height - 6} textAnchor="middle" className="fill-text-faint font-mono text-[10px]">
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
                  rx={3}
                  fill={stroke}
                  opacity={0.85}
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
                      <stop offset="0" stopColor={stroke} stopOpacity={0.3} />
                      <stop offset="1" stopColor={stroke} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <path d={`${path} L${x(series.points.length - 1).toFixed(1)},${y(low)} L${x(0).toFixed(1)},${y(low)} Z`} fill={`url(#${gradient})`} />
                </>
              )}
              <path d={path} fill="none" stroke={stroke} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {series.points.map((point, index) => (
                <circle key={point.x} cx={x(index)} cy={y(point.y)} r={3} fill="var(--color-ground)" stroke={stroke} strokeWidth={1.5} />
              ))}
            </g>
          )
        })}
      </svg>
    </figure>
  )
}
