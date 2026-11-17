import type { BlockProps, Shape } from '@repo/catalog'
import { cn } from '../../primitives/cn.ts'
import { TONE_COLOR } from '../tones.ts'

const SIZE = { icon: 'w-12', figure: 'w-full max-w-sm', wide: 'w-full' } as const

/** One shape, in the drawing's coordinates and the app's colours. Every value was checked by the catalogue. */
function ShapeElement({ shape }: { shape: Shape }) {
  if (shape.shape === 'text') {
    return (
      <text x={shape.x} y={shape.y} fontSize={shape.size} textAnchor={shape.anchor} fill={TONE_COLOR[shape.tone]} className="font-sans">
        {shape.text}
      </text>
    )
  }
  const paint = {
    stroke: TONE_COLOR[shape.stroke],
    strokeWidth: shape.strokeWidth,
    opacity: shape.opacity,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const
  }
  switch (shape.shape) {
    case 'line':
      return <line x1={shape.x1} y1={shape.y1} x2={shape.x2} y2={shape.y2} {...paint} strokeDasharray={shape.dashed ? '4 4' : undefined} />
    case 'circle':
      return <circle cx={shape.cx} cy={shape.cy} r={shape.r} fill={TONE_COLOR[shape.fill]} {...paint} />
    case 'rect':
      return <rect x={shape.x} y={shape.y} width={shape.width} height={shape.height} rx={shape.radius} fill={TONE_COLOR[shape.fill]} {...paint} />
    case 'polyline': {
      const points = shape.points.map(([x, y]) => `${x},${y}`).join(' ')
      return shape.closed ? (
        <polygon points={points} fill={TONE_COLOR[shape.fill]} {...paint} />
      ) : (
        <polyline points={points} fill={TONE_COLOR[shape.fill]} {...paint} />
      )
    }
    case 'path':
      return <path d={shape.d} fill={TONE_COLOR[shape.fill]} {...paint} />
  }
}

export function Drawing({ props }: { props: BlockProps<'Drawing'> }) {
  return (
    <svg
      viewBox={`0 0 ${props.width} ${props.height}`}
      role="img"
      aria-label={props.label}
      className={cn('h-auto shrink-0 overflow-visible', SIZE[props.size])}
    >
      <title>{props.label}</title>
      {props.shapes.map((shape, index) => (
        <ShapeElement key={index} shape={shape} />
      ))}
    </svg>
  )
}

export function Image({ props }: { props: BlockProps<'Image'> }) {
  return (
    <figure className="grid gap-2">
      <img src={props.url} alt={props.alt} referrerPolicy="no-referrer" className="max-h-96 w-full rounded-lg border border-line object-cover" />
      {props.caption && <figcaption className="text-text-soft text-xs">{props.caption}</figcaption>}
    </figure>
  )
}
