import type { Look } from '@repo/protocol'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { fieldOf } from '../presence/field.ts'
import { gazeAt, middleOf, type Point } from '../presence/gaze.ts'
import { type Around, MOODS, type Pose } from '../presence/life.ts'
import { useCoreLight } from '../presence/light.ts'
import { Orb } from '../presence/orb.tsx'
import type { Mood } from '../presence/painter.ts'
import { arrivedAt, restOn, travelTowards } from './travel.ts'

/** How strongly the light around the core shows in each mood: brighter while it hears or speaks, dim asleep. */
const HALO: Record<Mood, number> = { idle: 0.7, listening: 1, thinking: 0.85, working: 0.9, speaking: 1, asleep: 0.3 }

/**
 * How much of its light each look casts on the ground round it. The lens keeps its light inside its glass, as the
 * eye it is after does: a red cast on everything round it would read as a warning light.
 */
const CASTS: Record<Look, number> = { hud: 1, lens: 0.35 }

/** How far the core looks: at this many pixels away, its eye is turned about seven tenths of the way. */
const GAZE_REACH = 460

/** What the core looks at on the screen: the view it talks about, its box and the middle of it. */
export interface Sight {
  point: Point
  box: DOMRect
}

/**
 * The largest the core is drawn, in CSS pixels. Its canvas is always this size, and draws the core at the size it is
 * at, so it stays sharp at every size on its way from one place to another.
 */
export const LARGEST = 280

interface CoreProps {
  mood: Mood
  level: () => number
  bands: () => ArrayLike<number> | undefined
  load: () => number | undefined
  /** Where the core looks now, read on every frame; nothing when it has nothing to look at. */
  sight: () => Sight | undefined
  /** The place kept for the core on the screen now, read on every frame: it travels there, and rests there. */
  place: () => HTMLElement | null
  /** Told when the core arrives at its place, and when it leaves it: what is written under it waits for it. */
  onArrive(arrived: boolean): void
}

/**
 * The core, one for the whole stage, never drawn twice: it travels between the places the stage keeps for it (the
 * middle of an empty stage, home, the top of the column) on a spring, and is drawn again at each size on its way, so
 * nothing is stretched or swapped. With it goes the soft light it casts on the ground: the accent, faint, fading to
 * nothing well before any edge, leaning a little towards where the core looks, a little brighter as the computer
 * works harder. All of it is written on every frame the core draws, as a transform and an opacity only, so it costs
 * no layout and React draws nothing for it. The same frame tells the ground where the core is, how much light it
 * casts and where it looks, so the dots round it and round what it looks at light up with it.
 */
export function Core({ mood, level, bands, load, sight, place, onArrive }: CoreProps) {
  const box = useRef<HTMLDivElement>(null)
  const halo = useRef<HTMLSpanElement>(null)
  const light = useCoreLight()
  const seen = useRef<Sight | undefined>(undefined)
  // Where the core is, from the top left of the stage, and how large, with how fast each is changing; the place it
  // rests on, once it has arrived there; and where the stage itself is on the screen, as last read.
  const at = useRef({
    x: 0,
    y: 0,
    size: LARGEST,
    speedX: 0,
    speedY: 0,
    growth: 0,
    time: 0,
    placed: false,
    arrived: true,
    rested: null as HTMLElement | null,
    left: 0,
    top: 0
  })
  const arrive = useRef(onArrive)
  arrive.current = onArrive
  const still = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)'), [])
  // From what the last frame read, so that looking costs no reading of the layout.
  const middle = useCallback((): Point | undefined => {
    const here = at.current
    return here.placed ? { x: here.left + here.x, y: here.top + here.y } : undefined
  }, [])
  /**
   * Puts the core where it belongs now. On the place it rests on, it is simply there: when that place scrolls,
   * resizes or is pushed by what is laid out round it, the core moves with it and has nothing to chase. On its way
   * to another place, it goes one step further on its spring, when a frame is being drawn.
   */
  const settleCore = useCallback(
    (drawing: boolean) => {
      const element = box.current
      const slot = place()
      const stage = element?.offsetParent?.getBoundingClientRect()
      const here = at.current
      if (!element || !slot || !stage) return
      const kept = slot.getBoundingClientRect()
      const spot = { x: kept.left - stage.left + kept.width / 2, y: kept.top - stage.top + kept.height / 2, size: kept.width }
      const now = performance.now()
      if (!here.placed || still.matches) {
        restOn(here, slot, spot)
        here.placed = true
      } else if (!travelTowards(here, slot, spot, drawing ? (now - here.time) / 1000 : undefined)) {
        return
      }
      here.time = now
      here.left = stage.left
      here.top = stage.top
      const arrived = arrivedAt(here, slot, spot)
      if (arrived !== here.arrived) {
        here.arrived = arrived
        arrive.current(arrived)
      }
      // On whole device pixels, so its finest lines stay one pixel sharp.
      const ratio = window.devicePixelRatio || 1
      const left = Math.round((here.x - LARGEST / 2) * ratio) / ratio
      const top = Math.round((here.y - LARGEST / 2) * ratio) / ratio
      element.style.transform = `translate3d(${left}px,${top}px,0)`
    },
    [place, still]
  )
  // No frame is drawn while the core is out of sight. What scrolls or resizes still moves its place then, so the
  // core is kept on it there too, and is drawn again as soon as its place is back in sight.
  useEffect(() => {
    const keep = () => settleCore(false)
    window.addEventListener('scroll', keep, { capture: true, passive: true })
    window.addEventListener('resize', keep)
    return () => {
      window.removeEventListener('scroll', keep, { capture: true })
      window.removeEventListener('resize', keep)
    }
  }, [settleCore])
  const gaze = useCallback((): readonly [number, number] | undefined => {
    const now = sight()
    seen.current = now
    const from = middle()
    if (!now || !from) return undefined
    return gazeAt(from, now.point, GAZE_REACH)
  }, [sight, middle])
  const scale = useCallback(() => at.current.size / LARGEST, [])
  // What is round it, for its glass to reflect: the view it looks at, told from the core's middle in its own radii,
  // up as up.
  const around = useCallback((): Around | undefined => {
    const now = seen.current
    const from = middle()
    if (!now || !from) return undefined
    const radius = at.current.size / 2
    const told = (point: Point): [number, number] => [(point.x - from.x) / radius, (from.y - point.y) / radius]
    return { view: [...told(middleOf(now.box)), now.box.width / 2 / radius, now.box.height / 2 / radius] }
  }, [middle])
  const onFrame = useCallback(
    (pose: Pose) => {
      settleCore(true)
      const here = at.current
      const cast = (Object.keys(CASTS) as Look[]).reduce((sum, look) => sum + CASTS[look] * pose.looks[look], 0)
      const glow = MOODS.reduce((sum, each) => sum + HALO[each] * pose.weights[each], 0) * (0.85 + 0.3 * pose.power)
      const shown = here.size / LARGEST
      if (halo.current) {
        halo.current.style.opacity = (glow * cast).toFixed(3)
        halo.current.style.transform = `translate3d(${(pose.gaze[0] * here.size * 0.12).toFixed(1)}px,${(-pose.gaze[1] * here.size * 0.12).toFixed(1)}px,0) scale(${shown.toFixed(4)})`
      }
      const from = middle()
      if (!light || !from) return
      light.core = { x: from.x, y: from.y, radius: here.size / 2 }
      light.glow = glow * (0.4 + 0.6 * cast)
      light.power = pose.power
      // Its voice goes on through the ground round it.
      fieldOf(pose, light.field)
      light.voice = pose.echo
      light.voiceShift = pose.echoShift
      const target = seen.current?.box
      light.spot =
        target && pose.attention > 0.01
          ? {
              x: target.left + target.width / 2,
              y: target.top + target.height / 2,
              radius: Math.max(target.width, target.height) * 0.62,
              strength: pose.attention
            }
          : undefined
    },
    [light, settleCore, middle]
  )
  // When the core leaves the screen, it lights nothing round it any more.
  useEffect(
    () => () => {
      if (light) {
        light.core = undefined
        light.spot = undefined
      }
    },
    [light]
  )
  return (
    <div
      ref={box}
      aria-hidden="true"
      className="pointer-events-none absolute top-0 left-0 z-[5] will-change-transform"
      style={{ width: LARGEST, height: LARGEST }}
    >
      <span
        ref={halo}
        className="pointer-events-none absolute -inset-[42%] bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--accent)_15%,transparent),color-mix(in_oklab,var(--accent)_6%,transparent)_45%,transparent)] will-change-[transform,opacity]"
      />
      <Orb
        size={LARGEST}
        scale={scale}
        mood={mood}
        level={level}
        bands={bands}
        gaze={gaze}
        load={load}
        around={around}
        onFrame={onFrame}
        className="relative"
      />
    </div>
  )
}
