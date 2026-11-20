import { LOOKS, type Look } from '@repo/protocol'
import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { cn } from '../primitives/cn.ts'
import { readAccent } from './color.ts'
import { Eye } from './eye.tsx'
import { createGpuCore } from './gpu.ts'
import { type Around, createLife, type Mood, type Pose } from './life.ts'

interface OrbProps {
  mood: Mood
  /** The side of the square it is drawn in, in CSS pixels. */
  size: number
  /**
   * How loud the voice heard or spoken is right now, from 0 to 1. Asked for at every frame, so the sound
   * can drive the core without the interface being drawn again.
   */
  level?: () => number
  /** The voice's spectrum right now, `BANDS` numbers from 0 to 1 from the low notes to the high. Asked for at every frame. */
  bands?: () => ArrayLike<number> | undefined
  /**
   * Where the core looks, as a direction from its centre across the screen, up as up, each from -1 to 1; nothing
   * when it has nothing to look at. Asked for at every frame.
   */
  gaze?: () => readonly [number, number] | undefined
  /** How hard the computer works, from 0 to 1; nothing when it is not known. Asked for at every frame. */
  load?: () => number | undefined
  /**
   * What is round the core on the screen, which its glass reflects: the pointer, and the view it looks at, in the
   * core's own radii from its middle, up as up. Asked for at every frame.
   */
  around?: () => Around | undefined
  /** Told every pose drawn, so what moves with the core (the light it casts) can follow it in the same frame. */
  onFrame?: (pose: Pose) => void
  /**
   * How large the core is drawn inside its canvas, from 0 to 1 of `size`, read every frame after `onFrame`: a core
   * that changes size is drawn again at each size, sharp, rather than stretched.
   */
  scale?: () => number
  className?: string
}

/** What a core whose place and size follow its frames is asked on each frame, as its latest props say. */
interface Followed {
  onFrame: OrbProps['onFrame'] | undefined
  scale: OrbProps['scale'] | undefined
}

/** The look drawn before any persona is known: the instrument, which reads as something getting ready. */
const NEUTRAL_LOOK: Look = 'hud'

/**
 * A development switch: `?core=shader` in the page's address draws the core on the graphics card even where only
 * the processor would draw it, so the shaders can be seen on a machine without a graphics card. Nothing in the
 * product sets it.
 */
const forceShader = () => new URLSearchParams(window.location.search).get('core') === 'shader'

/** Reads the look the surrounding element asks for, as `--look`. */
function readLook(element: Element): Look {
  const value = getComputedStyle(element).getPropertyValue('--look').trim()
  return (LOOKS as readonly string[]).includes(value) ? (value as Look) : NEUTRAL_LOOK
}

/** How large the core is drawn in its square, as `scale` asks, from a twentieth of it to all of it. */
const sizeOf = (scale: (() => number) | undefined) => Math.min(1, Math.max(0.05, scale?.() ?? 1))

/**
 * Calls `frame` on every frame while the window is shown and the element is in view, and `resume` before the first
 * frame after a pause, so the time away is not lived through. Returns what stops it.
 */
function whileSeen(element: Element, frame: (now: number) => void, resume?: () => void): () => void {
  let id = 0
  let onScreen = true
  const run = () => {
    if (!id && onScreen && document.visibilityState === 'visible') id = requestAnimationFrame(tick)
  }
  const tick = (now: number) => {
    id = 0
    frame(now)
    run()
  }
  const pause = () => {
    cancelAnimationFrame(id)
    id = 0
  }
  const onVisibility = () => {
    if (document.visibilityState !== 'visible') return pause()
    resume?.()
    run()
  }
  // Several records can come at once for the one element; the last says where it is now.
  const watch = new IntersectionObserver((entries) => {
    onScreen = entries.at(-1)?.isIntersecting ?? true
    if (!onScreen) return pause()
    resume?.()
    run()
  })
  document.addEventListener('visibilitychange', onVisibility)
  watch.observe(element)
  run()
  return () => {
    pause()
    document.removeEventListener('visibilitychange', onVisibility)
    watch.disconnect()
  }
}

/**
 * The core, in whatever accent and look surround it (`--accent`, and `--look`, which `accentStyle` sets from the
 * persona). It is decoration for a screen reader: the name and the state written beside it say the same thing in
 * words.
 *
 * It is drawn on the graphics card (`gpu.ts`), moved by the life behind it (`life.ts`). Where the graphics card
 * cannot draw it, it is a still picture of its mark. Drawing stops while the window is hidden or the core is out of
 * view, and with less motion asked for, the core holds still and is only drawn again while a mood, a look or an
 * accent changes.
 */
export function Orb({ mood, size, level, bands, gaze, load, around, onFrame, scale, className }: OrbProps) {
  const box = useRef<HTMLSpanElement>(null)
  const live = useRef({ mood, level, size, bands, gaze, load, around, onFrame, scale })
  live.current = { mood, level, size, bands, gaze, load, around, onFrame, scale }
  const [refused, setRefused] = useState(false)

  useEffect(() => {
    const element = box.current
    if (!element) return

    // The canvas is put in the page only once the core can be drawn: where it cannot, there is none.
    const canvas = document.createElement('canvas')
    canvas.style.cssText = 'display:block;width:100%;height:100%'
    const gpu = createGpuCore(canvas, forceShader())
    if (!gpu) {
      setRefused(true)
      return
    }
    element.append(canvas)
    let look = readLook(element)
    const life = createLife(live.current.mood, look)
    const still = window.matchMedia('(prefers-reduced-motion: reduce)')
    // Each look keeps the accent it was last shown in, so while one gives way to the other, each fades in its own.
    let target = readAccent(element)
    const accents = Object.fromEntries(LOOKS.map((each) => [each, [...target]])) as Record<Look, [number, number, number]>
    const shown = Object.fromEntries(LOOKS.map((each) => [each, [...target]])) as Record<Look, [number, number, number]>
    let readAt = performance.now()
    let previous = readAt
    let fading = false
    let drawn = ''

    const draw = (now: number) => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      const pixels = Math.round(live.current.size * ratio)
      // A canvas starts 300 by 150 whatever its box is, so both sides are checked.
      if (canvas.width !== pixels || canvas.height !== pixels) {
        canvas.width = pixels
        canvas.height = pixels
        drawn = ''
      }
      const delta = Math.min(0.1, (now - previous) / 1000)
      previous = now
      // The accent and the look are whatever the surrounding element says. The look is a word, read every frame so a
      // change of persona morphs the core in the same frame as the rest of the window changes. The accent changes
      // rarely and costs more to read, so it is read a few times a second, and every frame while a look comes in;
      // the colour drawn eases towards each reading.
      const asked = readLook(element)
      if (asked !== look || now - readAt > 200 || fading) {
        target = readAccent(element)
        // A look coming in starts in the accent it comes with; the one giving way keeps its own.
        if (asked !== look) accents[asked] = [...target]
        look = asked
        readAt = now
      }
      const ease = 1 - Math.exp(-delta * 12)
      accents[look] = accents[look].map((value, channel) => value + ((target[channel] ?? value) - value) * ease) as [number, number, number]
      for (const each of LOOKS) shown[each] = accents[each].map(Math.round) as [number, number, number]

      const heard = Math.max(0, Math.min(1, live.current.level?.() ?? 0))
      const pose = life.step({
        mood: live.current.mood,
        look,
        level: heard,
        bands: live.current.bands?.(),
        gaze: live.current.gaze?.(),
        load: live.current.load?.(),
        around: live.current.around?.(),
        delta,
        still: still.matches
      })
      live.current.onFrame?.(pose)
      const drawnAt = sizeOf(live.current.scale)
      fading = pose.looks[look] < 1
      // Holding still, a frame is only drawn while something changes: the size, the accent, a mood or a look fading.
      const settled = Math.abs(pose.weights[live.current.mood] - 1) < 0.002 && Math.abs(pose.looks[look] - 1) < 0.002
      const state = `${pixels} ${drawnAt.toFixed(3)} ${shown[look].join()} ${live.current.mood} ${look}`
      if (!(still.matches && settled && drawn === state)) {
        gpu.paint(pose, shown, pixels, drawnAt)
        drawn = settled ? state : ''
      }
    }

    const stop = whileSeen(element, draw, () => {
      previous = performance.now()
    })
    return () => {
      stop()
      gpu.dispose()
      canvas.remove()
    }
  }, [])

  return (
    <span ref={box} aria-hidden="true" className={cn('pointer-events-none block select-none', className)} style={{ width: size, height: size }}>
      {refused && <StillCore live={live} />}
    </span>
  )
}

/**
 * The core where the graphics card cannot draw it: the composer's eye at the core's size, in the look and accent
 * around it, at rest and without animation, with no picture to make or keep. A core whose place and size follow
 * its frames (the stage's) is still told a pose at rest and asked its size on each frame, and draws nothing.
 */
function StillCore({ live }: { live: RefObject<Followed> }) {
  const box = useRef<HTMLSpanElement>(null)
  const [look, setLook] = useState<Look>(NEUTRAL_LOOK)
  // With no frames to read it on, the look is read after each render: a change of persona renders what is round
  // the core again.
  useLayoutEffect(() => {
    if (box.current) setLook(readLook(box.current))
  })
  const placed = Boolean(live.current.onFrame || live.current.scale)

  useEffect(() => {
    const element = box.current
    if (!element || !placed) return
    const rest = createLife('idle', look).step({ mood: 'idle', look, level: 0, delta: 0, still: true })
    let sized = ''
    return whileSeen(element, () => {
      live.current.onFrame?.(rest)
      const transform = `scale(${sizeOf(live.current.scale).toFixed(4)})`
      if (transform === sized) return
      element.style.transform = transform
      sized = transform
    })
  }, [live, look, placed])

  // The eye's ring is 85 % of its box and the core's edge about 72 % of its square: inset by 8 % on each side, the
  // ring falls where the core's edge would.
  return (
    <span ref={box} className="block size-full p-[8%]">
      <Eye mood="idle" look={look} still className="size-full" />
    </span>
  )
}
