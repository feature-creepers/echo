/**
 * The icons of a sheet's icon sets (docs/SPEC.md, section 9.7), drawn as Excel and LibreOffice draw them, small and in
 * their own colours: arrows, triangles, traffic lights, signs, symbols, flags, stars, ratings, quarters and boxes. Each
 * set lists its icons from the one for the lowest values.
 */

import type { ReactNode } from 'react'

const RED = '#e04b3a'
const YELLOW = '#f2b51d'
const GREEN = '#3fa34d'
const GRAY = '#8c8c8c'
const BLACK = '#3a3a3a'
const PINK = '#f19a9a'
const GOLD = '#f2b51d'
const BLUE = '#3d79c5'
const PALE = '#d4d4d4'

type Icon =
  | { kind: 'arrow'; angle: number; color: string }
  | { kind: 'circle'; color: string; rim?: boolean }
  | { kind: 'flag'; color: string }
  | { kind: 'diamond'; color: string }
  | { kind: 'triangle'; up: boolean; color: string }
  | { kind: 'dash'; color: string }
  | { kind: 'symbol'; glyph: 'check' | 'cross' | 'mark'; color: string; circled: boolean }
  | { kind: 'star'; filled: 0 | 0.5 | 1 }
  | { kind: 'bars'; filled: number }
  | { kind: 'quarters'; filled: number }
  | { kind: 'boxes'; filled: number }
  | { kind: 'face'; mood: -1 | 0 | 1; color: string }

const arrows = (color: (index: number) => string, angles: readonly number[]): Icon[] =>
  angles.map((angle, index) => ({ kind: 'arrow', angle, color: color(index) }))

/** Each set's icons, from the lowest values' to the highest's. */
const SETS: Record<string, Icon[]> = {
  '3Arrows': arrows((index) => [RED, YELLOW, GREEN][index] ?? GRAY, [180, 90, 0]),
  '3ArrowsGray': arrows(() => GRAY, [180, 90, 0]),
  '4Arrows': arrows((index) => [RED, YELLOW, YELLOW, GREEN][index] ?? GRAY, [180, 135, 45, 0]),
  '4ArrowsGray': arrows(() => GRAY, [180, 135, 45, 0]),
  '5Arrows': arrows((index) => [RED, YELLOW, YELLOW, YELLOW, GREEN][index] ?? GRAY, [180, 135, 90, 45, 0]),
  '5ArrowsGray': arrows(() => GRAY, [180, 135, 90, 45, 0]),
  '3Flags': [RED, YELLOW, GREEN].map((color) => ({ kind: 'flag', color })),
  '3TrafficLights1': [RED, YELLOW, GREEN].map((color) => ({ kind: 'circle', color })),
  '3TrafficLights2': [RED, YELLOW, GREEN].map((color) => ({ kind: 'circle', color, rim: true })),
  '4TrafficLights': [BLACK, RED, YELLOW, GREEN].map((color) => ({ kind: 'circle', color })),
  '4RedToBlack': [BLACK, GRAY, PINK, RED].map((color) => ({ kind: 'circle', color })),
  '3Signs': [
    { kind: 'diamond', color: RED },
    { kind: 'triangle', up: true, color: YELLOW },
    { kind: 'circle', color: GREEN }
  ],
  '3Symbols': [
    { kind: 'symbol', glyph: 'cross', color: RED, circled: true },
    { kind: 'symbol', glyph: 'mark', color: YELLOW, circled: true },
    { kind: 'symbol', glyph: 'check', color: GREEN, circled: true }
  ],
  '3Symbols2': [
    { kind: 'symbol', glyph: 'cross', color: RED, circled: false },
    { kind: 'symbol', glyph: 'mark', color: YELLOW, circled: false },
    { kind: 'symbol', glyph: 'check', color: GREEN, circled: false }
  ],
  '3Stars': [
    { kind: 'star', filled: 0 },
    { kind: 'star', filled: 0.5 },
    { kind: 'star', filled: 1 }
  ],
  '3Triangles': [
    { kind: 'triangle', up: false, color: RED },
    { kind: 'dash', color: YELLOW },
    { kind: 'triangle', up: true, color: GREEN }
  ],
  '4Rating': [1, 2, 3, 4].map((filled) => ({ kind: 'bars', filled })),
  '5Rating': [0, 1, 2, 3, 4].map((filled) => ({ kind: 'bars', filled })),
  '5Quarters': [0, 1, 2, 3, 4].map((filled) => ({ kind: 'quarters', filled })),
  '5Boxes': [0, 1, 2, 3, 4].map((filled) => ({ kind: 'boxes', filled })),
  '3Smilies': ([-1, 0, 1] as const).map((mood) => ({ kind: 'face', mood, color: GOLD })),
  '3ColorSmilies': ([-1, 0, 1] as const).map((mood, index) => ({ kind: 'face', mood, color: [RED, YELLOW, GREEN][index] ?? GOLD }))
}

/** A five-pointed star's corners in a box of 16, and those of its left half. */
const STAR = Array.from({ length: 10 }, (_, index) => {
  const angle = (Math.PI / 5) * index - Math.PI / 2
  const radius = index % 2 === 0 ? 7.2 : 3
  return [8 + radius * Math.cos(angle), 8.6 + radius * Math.sin(angle)] as const
})
const points = (list: readonly (readonly [number, number])[]) => list.map(([x, y]) => `${Math.round(x * 100) / 100},${Math.round(y * 100) / 100}`).join(' ')

/** The shapes of an icon, in a box of 16 by 16. */
function shapes(icon: Icon): ReactNode {
  switch (icon.kind) {
    case 'arrow':
      return <polygon points="8,1 14.5,8 10.2,8 10.2,15 5.8,15 5.8,8 1.5,8" fill={icon.color} transform={`rotate(${icon.angle} 8 8)`} />
    case 'circle':
      return <circle cx={8} cy={8} r={6.5} fill={icon.color} stroke={icon.rim ? BLACK : 'none'} strokeWidth={1.2} />
    case 'flag':
      return (
        <>
          <line x1={3.5} y1={1.5} x2={3.5} y2={15} stroke={BLACK} strokeWidth={1.4} />
          <polygon points="4.2,2 14,5.2 4.2,8.4" fill={icon.color} />
        </>
      )
    case 'diamond':
      return <polygon points="8,1.5 14.5,8 8,14.5 1.5,8" fill={icon.color} />
    case 'triangle':
      return <polygon points={icon.up ? '8,2 14.5,13.5 1.5,13.5' : '8,14 14.5,2.5 1.5,2.5'} fill={icon.color} />
    case 'dash':
      return <rect x={2.5} y={6.2} width={11} height={3.6} fill={icon.color} />
    case 'symbol': {
      const ink = icon.circled ? '#ffffff' : icon.color
      const glyph =
        icon.glyph === 'check' ? (
          <polyline points="4.3,8.4 7,11 11.8,5.2" fill="none" stroke={ink} strokeWidth={2} />
        ) : icon.glyph === 'cross' ? (
          <path d="M5 5L11 11M11 5L5 11" stroke={ink} strokeWidth={2} />
        ) : (
          <path d="M8 3.6V9.4M8 11.2V12.8" stroke={ink} strokeWidth={2.2} />
        )
      return (
        <>
          {icon.circled && <circle cx={8} cy={8} r={7} fill={icon.color} />}
          {glyph}
        </>
      )
    }
    case 'star':
      return (
        <>
          <polygon points={points(STAR)} fill={icon.filled === 1 ? GOLD : '#ffffff'} stroke={GOLD} strokeWidth={1} />
          {icon.filled === 0.5 && <polygon points={points(STAR.map(([x, y]) => [Math.min(x, 8), y] as const))} fill={GOLD} />}
        </>
      )
    case 'bars':
      return [0, 1, 2, 3].map((bar) => (
        <rect key={bar} x={1.5 + bar * 3.5} y={12 - bar * 3} width={2.6} height={3 + bar * 3} fill={bar < icon.filled ? BLUE : PALE} />
      ))
    case 'quarters': {
      const angle = (icon.filled / 4) * 2 * Math.PI
      const end = [8 + 6.5 * Math.sin(angle), 8 - 6.5 * Math.cos(angle)].map((one) => Math.round(one * 100) / 100)
      return (
        <>
          <circle cx={8} cy={8} r={6.5} fill={icon.filled === 4 ? BLACK : '#ffffff'} stroke={BLACK} strokeWidth={1} />
          {icon.filled > 0 && icon.filled < 4 && <path d={`M8 8V1.5A6.5 6.5 0 ${icon.filled > 2 ? 1 : 0} 1 ${end[0]} ${end[1]}Z`} fill={BLACK} />}
        </>
      )
    }
    case 'boxes':
      return [0, 1, 3, 2].map((box, order) => (
        <rect key={box} x={1.5 + (box % 2) * 7} y={1.5 + Math.floor(box / 2) * 7} width={6} height={6} fill={order < icon.filled ? BLUE : PALE} />
      ))
    case 'face':
      return (
        <>
          <circle cx={8} cy={8} r={7} fill={icon.color} />
          <circle cx={5.6} cy={6.2} r={1} fill={BLACK} />
          <circle cx={10.4} cy={6.2} r={1} fill={BLACK} />
          <path
            d={icon.mood === 1 ? 'M4.6 9.4Q8 13 11.4 9.4' : icon.mood === -1 ? 'M4.6 11.8Q8 8.6 11.4 11.8' : 'M4.8 10.6H11.2'}
            fill="none"
            stroke={BLACK}
            strokeWidth={1.2}
          />
        </>
      )
  }
}

/** An icon of a set by its place in it, from the lowest values'; nothing for a set or a place not known. */
export function SheetIcon({ set, index, size }: { set: string; index: number; size: string }): ReactNode {
  const icon = SETS[set]?.[index]
  if (!icon) return null
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" focusable="false" style={{ display: 'block' }}>
      {shapes(icon)}
    </svg>
  )
}
