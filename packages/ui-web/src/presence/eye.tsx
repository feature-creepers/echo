import { type AccentName, accents } from '@repo/tokens'
import { createContext, useContext, useEffect, useId, useRef } from 'react'
import { cn } from '../primitives/cn.ts'
import { advanceEye, type EyePose, type Mood, restingEye } from './eye-motion.ts'
import { whileSeen } from './while-seen.ts'

/**
 * The accent of the persona that answers, for every eye drawn under it: an eye is composed after its accent. A
 * screen that draws another persona's eye gives that one its accent itself.
 */
export const EyeAccentContext = createContext<AccentName | undefined>(undefined)

interface EyeProps {
  mood: Mood
  /** The side of the square it is drawn in, in CSS pixels. */
  size: number
  /** The accent it is composed after. Left out, that of the persona that answers. Its colour is the `--accent` around it. */
  accent?: AccentName | undefined
  /**
   * How loud the voice heard or spoken is right now, from 0 to 1. Asked for at every frame, so the sound can move
   * the pupil without the interface being drawn again.
   */
  level?: (() => number) | undefined
  /** Drawn as its mood rests, with nothing moving: a mark, in a list or beside a name. */
  still?: boolean | undefined
  className?: string | undefined
}

/** From this size up the eye is drawn whole; under it, it keeps only what still reads. */
const WHOLE_FROM = 72
/** Under this size the inner ring is left out too. */
const INNER_FROM = 28

/** How far the sight's square rides along its line, in the drawing's units. */
const RIDE = { x: 34, y: -15 } as const

/** How fast the orbit's two squares circle, as shares of its arc's pace: one ahead of it, one against it. */
const CIRCLING = { outer: 1.3, inner: -1.8 } as const

const turned = (degrees: number) => `rotate(${degrees.toFixed(2)}deg)`

/**
 * The assistant's eye, in the accent around it (`--accent`): a drawing of lines and planes, composed after the
 * persona's accent. The sight is a ring, a hatched half that turns, an inner ring, a triangle that steps round like a
 * clock's hand, a line with a square riding it, and the pupil. The orbit is the same rings with a hatched quarter, an
 * arc and two squares that circle the eye. Small, each keeps what tells it apart, drawn larger: the triangle in front
 * of the pupil, the arc round half the ring. It is decoration for a screen reader: the name and the state written
 * beside it say the same in words.
 *
 * Its parts are placed on every frame from `eye-motion.ts`, as transforms and an opacity only. Frames stop while the
 * window is hidden or the eye is out of view; with less motion asked for, or drawn still, it rests as its mood does.
 */
export function Eye({ mood, size, accent, level, still = false, className }: EyeProps) {
  const around = useContext(EyeAccentContext)
  const named = accent ?? around
  // An eye drawn before any persona is known is a sight.
  const composition = named === undefined ? 'sight' : accents[named].eye
  const hatch = useId()
  const root = useRef<SVGSVGElement>(null)
  const turning = useRef<SVGGElement>(null)
  const iris = useRef<SVGCircleElement>(null)
  const wedge = useRef<SVGPathElement>(null)
  const square = useRef<SVGRectElement>(null)
  const outer = useRef<SVGGElement>(null)
  const inner = useRef<SVGGElement>(null)
  const pupil = useRef<SVGCircleElement>(null)
  const live = useRef({ mood, level })
  live.current = { mood, level }
  const whole = size >= WHOLE_FROM
  const ringed = size >= INNER_FROM
  // A still eye is drawn again when its mood changes; a living one reads its mood on every frame.
  const rested = still ? mood : undefined

  useEffect(() => {
    const element = root.current
    if (!element) return
    const place = (pose: EyePose) => {
      element.style.opacity = pose.strength.toFixed(3)
      // The sight's hatched half and the orbit's arc turn with the eye.
      if (turning.current) turning.current.style.transform = turned(pose.turn)
      if (iris.current) iris.current.style.transform = `scale(${pose.iris.toFixed(3)})`
      if (wedge.current) wedge.current.style.transform = turned(pose.wedge)
      if (square.current) square.current.style.transform = `translate(${(pose.ride * RIDE.x).toFixed(2)}px,${(pose.ride * RIDE.y).toFixed(2)}px)`
      if (outer.current) outer.current.style.transform = turned(pose.turn * CIRCLING.outer)
      if (inner.current) inner.current.style.transform = turned(pose.turn * CIRCLING.inner)
      if (pupil.current) pupil.current.style.transform = `scale(${pose.pupil.toFixed(3)},${(pose.pupil * pose.lid).toFixed(3)})`
    }
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)')
    let eye = restingEye(rested ?? live.current.mood, composition)
    place(eye)
    if (rested !== undefined) return
    let previous = performance.now()
    return whileSeen(
      element,
      (now) => {
        const delta = Math.min(0.1, (now - previous) / 1000)
        previous = now
        const heard = Math.max(0, Math.min(1, live.current.level?.() ?? 0))
        // Holding still, it is drawn as its mood rests, with nothing turning.
        eye = calm.matches ? restingEye(live.current.mood, composition) : advanceEye(eye, live.current.mood, heard, delta, composition)
        place(eye)
      },
      () => {
        previous = performance.now()
      }
    )
  }, [composition, rested])

  // Every part turns and grows about the middle of the drawing, and lines keep their weight at every size.
  const part = '[transform-origin:75px_75px]'
  const line = cn(part, '[vector-effect:non-scaling-stroke]')
  const pupilRadius = whole ? 5 : ringed ? 7 : 11
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
        <defs>
          {composition === 'sight' ? (
            <pattern id={hatch} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="5" stroke="currentColor" strokeWidth="1" />
            </pattern>
          ) : (
            <pattern id={hatch} width="6" height="6" patternUnits="userSpaceOnUse">
              <path d="M0 0H6M0 0V6" stroke="currentColor" strokeWidth="1" />
            </pattern>
          )}
        </defs>
      )}
      {composition === 'sight' ? (
        <>
          {/* The hatched half lies between the two rings, so nothing has to be painted over it. */}
          {whole && (
            <g ref={turning} className={part}>
              <path d="M75 25A50 50 0 0 1 75 125L75 98A23 23 0 0 0 75 52Z" fill={`url(#${hatch})`} opacity="0.9" />
            </g>
          )}
          {/* Small, the triangle is drawn last, in front of the pupil: it is what the sight is known by. */}
          {!whole && <circle ref={pupil} cx="75" cy="75" r={pupilRadius} fill="currentColor" className={part} />}
          <path ref={wedge} d="M75 75L75 28L122 75Z" fill="var(--accent)" className={part} />
          <circle cx="75" cy="75" r="50" stroke="currentColor" strokeWidth={whole ? 1.5 : 1.25} className={line} />
          {ringed && <circle ref={iris} cx="75" cy="75" r="23" stroke="currentColor" strokeWidth="1" className={line} />}
          {whole && (
            <>
              <line x1="8" y1="104" x2="142" y2="46" stroke="currentColor" strokeWidth="1" className={line} />
              <rect ref={square} x="96" y="60" width="9" height="9" fill="var(--color-warn)" />
              <circle ref={pupil} cx="75" cy="75" r={pupilRadius} fill="currentColor" className={part} />
            </>
          )}
        </>
      ) : (
        <>
          {whole && <path d="M75 125A50 50 0 0 1 25 75L52 75A23 23 0 0 0 75 98Z" fill={`url(#${hatch})`} opacity="0.8" />}
          <circle cx="75" cy="75" r="50" stroke="currentColor" strokeWidth={whole ? 1.5 : 1.25} className={line} />
          {ringed && <circle ref={iris} cx="75" cy="75" r="23" stroke="currentColor" strokeWidth="1" className={line} />}
          {/* Whole, the arc is a quarter of the ring; small, it runs round half of it and is drawn thicker, so the colour still shows. */}
          <g ref={turning} className={part}>
            {whole ? (
              <path d="M75 25A50 50 0 0 1 125 75" stroke="var(--accent)" strokeWidth="6" />
            ) : (
              <path d="M75 25A50 50 0 0 1 75 125" stroke="var(--accent)" strokeWidth={ringed ? 12 : 17} />
            )}
          </g>
          {whole && (
            <>
              <g ref={outer} className={part}>
                <rect x="21" y="71" width="8" height="8" fill="var(--accent)" />
              </g>
              <g ref={inner} className={part}>
                <rect x="72" y="49" width="6" height="6" fill="var(--color-warn)" />
              </g>
            </>
          )}
          <circle ref={pupil} cx="75" cy="75" r={pupilRadius} fill="currentColor" className={part} />
        </>
      )}
    </svg>
  )
}
