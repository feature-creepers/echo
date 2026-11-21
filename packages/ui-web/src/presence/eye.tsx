import { useEffect, useId, useRef } from 'react'
import { cn } from '../primitives/cn.ts'
import { advanceEye, type EyePose, restingEye } from './eye-motion.ts'
import type { Mood } from './life.ts'
import { whileSeen } from './while-seen.ts'

interface EyeProps {
  mood: Mood
  /** The side of the square it is drawn in, in CSS pixels. */
  size: number
  /**
   * How loud the voice heard or spoken is right now, from 0 to 1. Asked for at every frame, so the sound can move
   * the pupil without the interface being drawn again.
   */
  level?: (() => number) | undefined
  className?: string | undefined
}

/** From this size up the eye is drawn whole; under it, it keeps only its ring, its wedge and its pupil. */
const WHOLE_FROM = 72
/** Under this size the inner ring is left out too. */
const INNER_FROM = 28

/** How far the square rides along its line, in the drawing's units. */
const RIDE = { x: 34, y: -15 } as const

const turned = (degrees: number) => `rotate(${degrees.toFixed(2)}deg)`

/**
 * The assistant's eye, in the accent around it (`--accent`): one drawing of lines and planes for every persona, which
 * differ by the colour of its wedge. Large, it is whole: a ring, a hatched half that turns, an inner ring, the wedge,
 * a line with a square riding it, the pupil. Small, it keeps what still reads. It is decoration for a screen reader:
 * the name and the state written beside it say the same in words.
 *
 * Its parts are placed on every frame from `eye-motion.ts`, as transforms and an opacity only. Frames stop while the
 * window is hidden or the eye is out of view; with less motion asked for it holds still, drawn as its mood rests.
 */
export function Eye({ mood, size, level, className }: EyeProps) {
  const hatch = useId()
  const root = useRef<SVGSVGElement>(null)
  const sweep = useRef<SVGGElement>(null)
  const iris = useRef<SVGCircleElement>(null)
  const wedge = useRef<SVGPathElement>(null)
  const square = useRef<SVGRectElement>(null)
  const pupil = useRef<SVGCircleElement>(null)
  const live = useRef({ mood, level })
  live.current = { mood, level }
  const whole = size >= WHOLE_FROM

  useEffect(() => {
    const element = root.current
    if (!element) return
    const place = (pose: EyePose) => {
      element.style.opacity = pose.strength.toFixed(3)
      if (sweep.current) sweep.current.style.transform = turned(pose.sweep)
      if (iris.current) iris.current.style.transform = `scale(${pose.iris.toFixed(3)})`
      if (wedge.current) wedge.current.style.transform = turned(pose.wedge)
      if (square.current) square.current.style.transform = `translate(${(pose.ride * RIDE.x).toFixed(2)}px,${(pose.ride * RIDE.y).toFixed(2)}px)`
      if (pupil.current) pupil.current.style.transform = `scale(${pose.pupil.toFixed(3)},${(pose.pupil * pose.lid).toFixed(3)})`
    }
    const still = window.matchMedia('(prefers-reduced-motion: reduce)')
    let eye = restingEye(live.current.mood)
    let previous = performance.now()
    place(eye)
    return whileSeen(
      element,
      (now) => {
        const delta = Math.min(0.1, (now - previous) / 1000)
        previous = now
        const heard = Math.max(0, Math.min(1, live.current.level?.() ?? 0))
        // Holding still, it is drawn as its mood rests, with nothing turning.
        eye = still.matches ? restingEye(live.current.mood) : advanceEye(eye, live.current.mood, heard, delta)
        place(eye)
      },
      () => {
        previous = performance.now()
      }
    )
  }, [])

  // Every part turns and grows about the middle of the drawing, and lines keep their weight at every size.
  const part = '[transform-origin:75px_75px] [vector-effect:non-scaling-stroke]'
  return (
    <svg
      ref={root}
      viewBox={whole ? '0 0 150 150' : '21 21 108 108'}
      width={size}
      height={size}
      fill="none"
      aria-hidden="true"
      className={cn('pointer-events-none block shrink-0 select-none overflow-visible text-text', className)}
    >
      {whole && (
        <>
          <defs>
            <pattern id={hatch} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="5" stroke="currentColor" strokeWidth="1" />
            </pattern>
          </defs>
          {/* The hatched half lies between the two rings, so nothing has to be painted over it. */}
          <g ref={sweep} className={part}>
            <path d="M75 25A50 50 0 0 1 75 125L75 98A23 23 0 0 0 75 52Z" fill={`url(#${hatch})`} opacity="0.9" />
          </g>
        </>
      )}
      <circle cx="75" cy="75" r="50" stroke="currentColor" strokeWidth={whole ? 1.5 : 1.25} className={part} />
      {size >= INNER_FROM && <circle ref={iris} cx="75" cy="75" r="23" stroke="currentColor" strokeWidth="1" className={part} />}
      <path ref={wedge} d="M75 52L98 75L75 75Z" fill="var(--accent)" className={part} />
      {whole && (
        <>
          <line x1="8" y1="104" x2="142" y2="46" stroke="currentColor" strokeWidth="1" className={part} />
          <rect ref={square} x="96" y="60" width="9" height="9" fill="var(--color-warn)" />
        </>
      )}
      <circle ref={pupil} cx="75" cy="75" r={whole ? 5 : size >= INNER_FROM ? 7 : 11} fill="currentColor" className={part} />
    </svg>
  )
}
